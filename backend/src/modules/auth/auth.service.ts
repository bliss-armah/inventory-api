import ms from "ms";
import { env } from "../../config/env.ts";
import { signAccessToken } from "../../lib/jwt.ts";
import { sendEmail } from "../../lib/email.ts";
import {
  hashPassword,
  verifyPassword,
  verifyPasswordTimingSafeNoop,
} from "../../lib/password.ts";
import { generateOpaqueToken, hashOpaqueToken } from "../../lib/tokens.ts";
import { classifyIdentifier, type Identifier } from "../../lib/identifier.ts";
import { logActivity } from "../../lib/activity-logger.ts";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  UnauthorizedError,
} from "../../shared/errors.ts";
import { Role, SubscriptionStatus } from "../../generated/prisma";
import { withUniqueConstraint } from "../../shared/prisma-errors.ts";
import * as authRepository from "./auth.repository.ts";
import * as membershipsRepository from "../memberships/memberships.repository.ts";
import * as staffInvitesRepository from "../users/staff-invites.repository.ts";
import * as twoFactorAuthService from "../two-factor-auth/two-factor-auth.service.ts";
import * as twoFactorAuthRepository from "../two-factor-auth/two-factor-auth.repository.ts";
import type {
  AcceptInviteInput,
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
} from "./auth.validators.ts";
import type {
  AuthResult,
  AuthenticatedUser,
  BusinessOption,
  LoginOutcome,
} from "./auth.types.ts";

/**
 * One message for every failure mode of a login attempt — unknown identifier,
 * malformed identifier, deactivated account, wrong password, an identity with
 * no membership anywhere. Naming which one it was would turn the login
 * endpoint into an account-enumeration oracle.
 */
const INVALID_CREDENTIALS = "Invalid credentials";
const PASSWORD_RESET_SUBJECT = "Reset your Inventory Manager password";
const SUSPENDED_MESSAGE =
  "This business account has been suspended. Contact support.";

/** The identity half of a session — everything that isn't per-business. */
type Identity = {
  id: string;
  name: string;
  email: string;
};

/** The business half — which tenant this session is for, and with what role. */
type SessionMembership = {
  tenantId: string;
  role: Role;
};

function toAuthenticatedUser(
  user: Identity,
  membership: SessionMembership,
): AuthenticatedUser {
  return {
    id: user.id,
    tenantId: membership.tenantId,
    name: user.name,
    email: user.email,
    role: membership.role,
  };
}

export async function issueSession(
  user: Identity,
  membership: SessionMembership,
): Promise<AuthResult> {
  const accessToken = signAccessToken({
    sub: user.id,
    tenantId: membership.tenantId,
    role: membership.role,
  });

  const refreshToken = generateOpaqueToken();
  await authRepository.createRefreshToken({
    tenantId: membership.tenantId,
    userId: user.id,
    tokenHash: hashOpaqueToken(refreshToken),
    expiresAt: new Date(
      Date.now() + ms(env.REFRESH_TOKEN_TTL as ms.StringValue),
    ),
  });

  return {
    user: toAuthenticatedUser(user, membership),
    accessToken,
    refreshToken,
  };
}

/**
 * The tail end of every successful login, whether that took one step (no
 * 2FA needed, one business) or three (password, then a code, then a business).
 * Only called once 2FA — if required — has actually been satisfied, so
 * `lastLoginAt` and the LOGIN activity entry never record an attempt that
 * stalled out mid-OTP.
 */
export async function completeLogin(
  user: Identity,
  membership: SessionMembership,
  ipAddress?: string,
): Promise<AuthResult> {
  await authRepository.updateLastLogin(user.id);
  await logActivity({
    tenantId: membership.tenantId,
    userId: user.id,
    action: "LOGIN",
    description: `${user.name} logged in`,
    ipAddress,
  });
  return issueSession(user, membership);
}

function toBusinessOption(membership: {
  tenantId: string;
  role: Role;
  tenant: { businessName: string };
}): BusinessOption {
  return {
    tenantId: membership.tenantId,
    businessName: membership.tenant.businessName,
    role: membership.role,
  };
}

type SignInableMembership = {
  tenantId: string;
  role: Role;
  tenant: { businessName: string };
};

/**
 * The last fork of every login path. With one business there is nothing to ask
 * and the session is issued outright; with several, a fresh short-lived token
 * carries the holder to /auth/select-business. It is minted here rather than
 * reusing whatever pending token got us this far so the credential rotates at
 * every step of the flow.
 *
 * `consumePendingId` is the pending-login row the caller arrived on, if any —
 * always spent, whichever branch is taken.
 */
async function finishLogin(
  user: Identity,
  memberships: SignInableMembership[],
  options: {
    ipAddress?: string;
    viaRememberedDevice?: boolean;
    consumePendingId?: string;
  } = {},
): Promise<LoginOutcome> {
  if (options.consumePendingId) {
    await twoFactorAuthRepository.deletePendingLogin(options.consumePendingId);
  }

  const only = memberships[0];
  if (memberships.length === 1 && only) {
    return {
      status: "success",
      viaRememberedDevice: options.viaRememberedDevice ?? false,
      ...(await completeLogin(user, only, options.ipAddress)),
    };
  }

  const mfaToken = generateOpaqueToken();
  await twoFactorAuthRepository.createPendingLogin({
    userId: user.id,
    tokenHash: hashOpaqueToken(mfaToken),
    expiresAt: new Date(
      Date.now() + ms(env.PENDING_TWO_FACTOR_AUTH_TTL as ms.StringValue),
    ),
    // Reaching here means every factor this account needs is already
    // satisfied; all that's left is choosing where to land.
    twoFactorAt: new Date(),
  });

  return {
    status: "select_business",
    mfaToken,
    businesses: memberships.map(toBusinessOption),
  };
}

/**
 * The second-factor gate every credential-proving path has to clear before a
 * session exists — password login and invitation acceptance alike. Factored
 * out because accepting an invitation is a login: holding an emailed token is
 * not a substitute for the factor the account actually requires, and a person
 * invited as an OWNER needs to be walked through setting one up rather than
 * handed a session that skips it.
 */
async function gateOnTwoFactor(
  user: Identity & twoFactorAuthService.TwoFactorUser,
  memberships: SignInableMembership[],
  via?: Identifier | null,
): Promise<LoginOutcome | null> {
  if (!twoFactorAuthService.requiresTwoFactor(user, memberships)) {
    return null;
  }
  return twoFactorAuthService.beginTwoFactorFlow(user, via);
}

/**
 * Every business this identity may sign into right now. Throws rather than
 * returning empty when the only thing standing in the way is suspension, so
 * the caller can say so — but only ever after credentials have checked out.
 */
async function resolveSignInableMemberships(userId: string) {
  const memberships = await membershipsRepository.listActiveForUser(userId);
  if (memberships.length === 0) {
    // An identity with no active membership anywhere has nothing to log into.
    // Indistinguishable from a wrong password, on purpose.
    throw new UnauthorizedError(INVALID_CREDENTIALS);
  }
  const signInable = membershipsRepository.selectSignInable(memberships);
  if (signInable.length === 0) {
    throw new ForbiddenError(SUSPENDED_MESSAGE);
  }
  return signInable;
}

export async function register(input: RegisterInput): Promise<LoginOutcome> {
  const existing = await authRepository.findUserByEmail(input.email);
  if (existing) {
    // Public registration deliberately refuses to attach a second business to
    // an address that already has an account — an unauthenticated stranger
    // must not be able to. The holder of that address can start another
    // business from inside their own session instead.
    throw new ConflictError(
      "An account with this email already exists. Log in to add another business.",
      {
        email: [
          "An account with this email already exists. Log in to add another business.",
        ],
      },
    );
  }

  const passwordHash = await hashPassword(input.password);
  const { tenant, owner } = await withUniqueConstraint(
    () => authRepository.createTenantWithOwner(input, passwordHash),
    { field: "email", message: "An account with this email already exists" },
  );

  await logActivity({
    tenantId: tenant.id,
    userId: owner.id,
    action: "TENANT_REGISTERED",
    description: `${owner.name} registered ${tenant.businessName}`,
  });

  // Registration is an email-identified act, so the first login code goes to
  // the address that was just used to register. The owner membership created
  // alongside the tenant always requires 2FA, so this never short-circuits
  // straight to a session.
  return twoFactorAuthService.beginTwoFactorFlow(
    {
      id: owner.id,
      email: owner.email,
      phone: owner.phone,
      twoFactorEnabled: false,
      twoFactorConfirmedAt: null,
      twoFactorChannel: null,
    },
    { kind: "email", email: owner.email },
  );
}

export async function login(
  input: LoginInput,
  ipAddress?: string,
  rememberDeviceToken?: string,
): Promise<LoginOutcome> {
  const identifier = classifyIdentifier(input.identifier);
  const user = identifier
    ? await authRepository.findUserByIdentifier(identifier)
    : null;

  if (!user) {
    // Still run a bcrypt compare so this branch takes as long as a real
    // mismatch — otherwise the timing difference reveals which identifiers
    // exist. Also covers a malformed identifier, so "not an email or phone"
    // is indistinguishable from "no such account".
    await verifyPasswordTimingSafeNoop(input.password);
    throw new UnauthorizedError(INVALID_CREDENTIALS);
  }

  const validPassword = await verifyPassword(input.password, user.passwordHash);
  if (!validPassword) {
    throw new UnauthorizedError(INVALID_CREDENTIALS);
  }

  // Only resolved after credentials check out — which businesses an address
  // belongs to, and whether any of them is suspended, are not things a failed
  // password attempt should be able to confirm.
  const memberships = await resolveSignInableMemberships(user.id);

  let viaRememberedDevice = false;
  if (twoFactorAuthService.requiresTwoFactor(user, memberships)) {
    const rememberedDevice = rememberDeviceToken
      ? await twoFactorAuthService.findValidRememberedDevice(
          user.id,
          rememberDeviceToken,
        )
      : null;

    if (!rememberedDevice) {
      const gated = await gateOnTwoFactor(user, memberships, identifier);
      if (gated) return gated;
    } else {
      await twoFactorAuthService.slideRememberedDevice(rememberedDevice.id);
      viaRememberedDevice = true;
    }
  }

  return finishLogin(user, memberships, { ipAddress, viaRememberedDevice });
}

/**
 * Called once the second factor is satisfied, to pick up where login() left
 * off. Memberships are re-read rather than carried across the OTP round-trip:
 * an owner could have deactivated this person while the code was in transit.
 */
export async function completeAfterTwoFactor(
  userId: string,
  pendingLoginId: string,
  ipAddress?: string,
): Promise<LoginOutcome> {
  const user = await authRepository.findUserById(userId);
  if (!user) {
    throw new UnauthorizedError();
  }
  const memberships = await resolveSignInableMemberships(user.id);
  return finishLogin(user, memberships, {
    ipAddress,
    consumePendingId: pendingLoginId,
  });
}

/**
 * The final step for someone who works in more than one business. The pending
 * token proves password *and* second factor; this only has to check that the
 * chosen business is genuinely one of theirs and still signable-into.
 */
export async function selectBusiness(
  userId: string,
  tenantId: string,
  pendingLoginId: string,
  ipAddress?: string,
): Promise<AuthResult> {
  const user = await authRepository.findUserById(userId);
  if (!user) {
    throw new UnauthorizedError();
  }

  const membership = await membershipsRepository.findForUserAndTenant(
    userId,
    tenantId,
  );
  if (!membership || !membership.isActive) {
    throw new ForbiddenError("You don't have access to that business");
  }
  if (membership.tenant.subscriptionStatus === SubscriptionStatus.SUSPENDED) {
    throw new ForbiddenError(SUSPENDED_MESSAGE);
  }

  await twoFactorAuthRepository.deletePendingLogin(pendingLoginId);
  return completeLogin(user, membership, ipAddress);
}

/**
 * Moving an existing session to another of the caller's businesses. No
 * re-authentication: the same human already proved who they are, and the
 * membership check below is the only thing that decides where they may go.
 */
export async function switchBusiness(
  userId: string,
  tenantId: string,
): Promise<AuthResult> {
  const user = await authRepository.findUserById(userId);
  if (!user) {
    throw new UnauthorizedError();
  }

  const membership = await membershipsRepository.findForUserAndTenant(
    userId,
    tenantId,
  );
  if (!membership || !membership.isActive) {
    throw new ForbiddenError("You don't have access to that business");
  }
  if (membership.tenant.subscriptionStatus === SubscriptionStatus.SUSPENDED) {
    throw new ForbiddenError(SUSPENDED_MESSAGE);
  }

  return issueSession(user, membership);
}

/** The businesses to offer a logged-in user in the switcher. */
export async function listBusinesses(userId: string) {
  const memberships = await membershipsRepository.listActiveForUser(userId);
  return membershipsRepository
    .selectSignInable(memberships)
    .map(toBusinessOption);
}

// ---------------------------------------------------------------------------
// Staff invitations
// ---------------------------------------------------------------------------

/**
 * What the accept-invitation page needs before it can render. Safe to serve
 * unauthenticated: the token was mailed to this address, so its holder is
 * already the person the details are about. `hasAccount` tells the page
 * whether to ask for a new password or the existing one.
 */
export async function describeInvite(token: string) {
  const invite = await staffInvitesRepository.findByTokenHash(
    hashOpaqueToken(token),
  );
  if (!invite || invite.expiresAt < new Date()) {
    throw new BadRequestError("This invitation is invalid or has expired");
  }
  const existing = await authRepository.findUserByEmail(invite.email);
  return {
    email: invite.email,
    name: existing?.name ?? invite.name,
    role: invite.role,
    businessName: invite.tenant.businessName,
    hasAccount: Boolean(existing),
  };
}

export async function acceptInvite(
  input: AcceptInviteInput,
  ipAddress?: string,
): Promise<LoginOutcome> {
  const invite = await staffInvitesRepository.findByTokenHash(
    hashOpaqueToken(input.token),
  );
  if (!invite || invite.expiresAt < new Date()) {
    throw new BadRequestError("This invitation is invalid or has expired");
  }
  if (invite.tenant.subscriptionStatus === SubscriptionStatus.SUSPENDED) {
    throw new ForbiddenError(SUSPENDED_MESSAGE);
  }

  const existing = await authRepository.findUserByEmail(invite.email);

  if (existing) {
    // The address already has an account, so accepting means proving it's
    // theirs — the invitation alone must not be enough to attach a business to
    // somebody else's identity, and the inviting owner never gets to set a
    // password on an account they don't own.
    const valid = await verifyPassword(input.password, existing.passwordHash);
    if (!valid) {
      throw new UnauthorizedError(
        "That password doesn't match the existing account for this email",
      );
    }
    const already = await membershipsRepository.findForUserAndTenant(
      existing.id,
      invite.tenantId,
    );
    if (!already) {
      await membershipsRepository.create({
        userId: existing.id,
        tenantId: invite.tenantId,
        role: invite.role,
      });
    }
    await staffInvitesRepository.remove(invite.id);
    await logActivity({
      tenantId: invite.tenantId,
      userId: existing.id,
      action: "STAFF_INVITE_ACCEPTED",
      description: `${existing.name} joined as ${invite.role}`,
    });
    const memberships = await resolveSignInableMemberships(existing.id);
    // An invitation proves the address, not the account's second factor. If
    // this identity needs one, it still has to produce it.
    const gated = await gateOnTwoFactor(existing, memberships, {
      kind: "email",
      email: existing.email,
    });
    return gated ?? finishLogin(existing, memberships, { ipAddress });
  }

  const passwordHash = await hashPassword(input.password);
  const { user } = await withUniqueConstraint(
    () =>
      authRepository.createUserWithMembership({
        name: input.name ?? invite.name,
        email: invite.email,
        passwordHash,
        tenantId: invite.tenantId,
        role: invite.role,
      }),
    { field: "email", message: "An account with this email already exists" },
  );
  await staffInvitesRepository.remove(invite.id);
  await logActivity({
    tenantId: invite.tenantId,
    userId: user.id,
    action: "STAFF_INVITE_ACCEPTED",
    description: `${user.name} joined as ${invite.role}`,
  });

  const memberships = await resolveSignInableMemberships(user.id);
  // Someone invited as an OWNER must set up a second factor before they get a
  // session, exactly as a self-registered owner does.
  const gated = await gateOnTwoFactor(user, memberships, {
    kind: "email",
    email: user.email,
  });
  return gated ?? finishLogin(user, memberships, { ipAddress });
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export async function refresh(refreshToken: string): Promise<AuthResult> {
  const tokenHash = hashOpaqueToken(refreshToken);
  const stored = await authRepository.findRefreshTokenByHash(tokenHash);

  if (!stored) {
    throw new UnauthorizedError("Invalid or expired refresh token");
  }

  if (stored.revokedAt) {
    // Rotated tokens are single-use. Seeing this one again means either a
    // client double-submit or a stolen copy being replayed — either way,
    // don't trust it. Revoke the whole session family and force re-login,
    // the standard mitigation for refresh-token reuse.
    await authRepository.revokeAllRefreshTokensForUser(stored.userId);
    throw new UnauthorizedError("Invalid or expired refresh token");
  }

  if (stored.expiresAt < new Date()) {
    throw new UnauthorizedError("Invalid or expired refresh token");
  }

  const user = await authRepository.findUserById(stored.userId);
  // A refresh token is scoped to one business, so it stays valid exactly as
  // long as the membership behind it does — losing access to this tenant ends
  // this session without touching the user's sessions elsewhere.
  const membership = user
    ? await membershipsRepository.findForUserAndTenant(
        user.id,
        stored.tenantId,
      )
    : null;
  if (
    !user ||
    !membership ||
    !membership.isActive ||
    membership.tenant.subscriptionStatus === SubscriptionStatus.SUSPENDED
  ) {
    throw new UnauthorizedError("Invalid or expired refresh token");
  }

  // Rotate: the old refresh token is single-use.
  await authRepository.revokeRefreshToken(stored.id);
  return issueSession(user, membership);
}

export async function logout(refreshToken: string): Promise<void> {
  const stored = await authRepository.findRefreshTokenByHash(
    hashOpaqueToken(refreshToken),
  );
  if (stored && !stored.revokedAt) {
    await authRepository.revokeRefreshToken(stored.id);
  }
}

export async function forgotPassword(
  input: ForgotPasswordInput,
): Promise<void> {
  const user = await authRepository.findUserByEmail(input.email);
  // Always resolve without revealing whether the email exists.
  if (!user) return;

  const token = generateOpaqueToken();
  const ttlMs = ms(env.PASSWORD_RESET_TOKEN_TTL as ms.StringValue);
  await authRepository.createPasswordResetToken({
    userId: user.id,
    tokenHash: hashOpaqueToken(token),
    expiresAt: new Date(Date.now() + ttlMs),
  });

  // Only the hash is stored, so this is the one moment the raw token exists.
  const link = `${env.FRONTEND_URL}/reset-password?token=${token}`;

  try {
    await sendEmail(
      user.email,
      PASSWORD_RESET_SUBJECT,
      `Someone asked to reset the password for your Inventory Manager account. Set a new one here: ${link}\n\nThis link expires in ${ms(ttlMs, { long: true })} and can only be used once. If this wasn't you, ignore this email — your password stays unchanged.`,
    );
  } catch (error) {
    console.error(
      `Failed to send password reset email to ${user.email}: ${(error as Error).message}`,
    );
  }
}

export async function resetPassword(input: ResetPasswordInput): Promise<void> {
  const tokenHash = hashOpaqueToken(input.token);
  const stored = await authRepository.findPasswordResetTokenByHash(tokenHash);

  if (!stored || stored.usedAt || stored.expiresAt < new Date()) {
    throw new BadRequestError("Invalid or expired reset token");
  }

  const passwordHash = await hashPassword(input.password);
  await authRepository.updatePassword(stored.userId, passwordHash);
  await authRepository.markPasswordResetTokenUsed(stored.id);
  await authRepository.revokeAllRefreshTokensForUser(stored.userId);

  // The password is one credential shared by every business this person works
  // in, and each of them has a legitimate interest in knowing it changed — so
  // the entry lands in all their activity logs, not an arbitrary one.
  const memberships = await membershipsRepository.listActiveForUser(
    stored.userId,
  );
  for (const membership of memberships) {
    await logActivity({
      tenantId: membership.tenantId,
      userId: stored.userId,
      action: "PASSWORD_RESET",
      description: "Password was reset",
    });
  }
}
