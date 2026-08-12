import ms from "ms";
import { env, isProduction } from "../../config/env.ts";
import { signAccessToken } from "../../lib/jwt.ts";
import {
  hashPassword,
  verifyPassword,
  verifyPasswordTimingSafeNoop,
} from "../../lib/password.ts";
import { generateOpaqueToken, hashOpaqueToken } from "../../lib/tokens.ts";
import { classifyIdentifier } from "../../lib/identifier.ts";
import { logActivity } from "../../lib/activity-logger.ts";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  UnauthorizedError,
} from "../../shared/errors.ts";
import { SubscriptionStatus } from "../../generated/prisma/enums.ts";
import { withUniqueConstraint } from "../../shared/prisma-errors.ts";
import * as authRepository from "./auth.repository.ts";
import * as twoFactorAuthService from "../two-factor-auth/two-factor-auth.service.ts";
import type {
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
} from "./auth.validators.ts";
import type {
  AuthResult,
  AuthenticatedUser,
  LoginOutcome,
} from "./auth.types.ts";

/**
 * One message for every failure mode of a login attempt — unknown identifier,
 * malformed identifier, deactivated account, wrong password. Naming which one
 * it was would turn the login endpoint into an account-enumeration oracle.
 */
const INVALID_CREDENTIALS = "Invalid credentials";

function toAuthenticatedUser(user: {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  role: AuthenticatedUser["role"];
}): AuthenticatedUser {
  return {
    id: user.id,
    tenantId: user.tenantId,
    name: user.name,
    email: user.email,
    role: user.role,
  };
}

export async function issueSession(user: {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  role: AuthenticatedUser["role"];
}): Promise<AuthResult> {
  const accessToken = signAccessToken({
    sub: user.id,
    tenantId: user.tenantId,
    role: user.role,
  });

  const refreshToken = generateOpaqueToken();
  await authRepository.createRefreshToken({
    tenantId: user.tenantId,
    userId: user.id,
    tokenHash: hashOpaqueToken(refreshToken),
    expiresAt: new Date(
      Date.now() + ms(env.REFRESH_TOKEN_TTL as ms.StringValue),
    ),
  });

  return { user: toAuthenticatedUser(user), accessToken, refreshToken };
}

/**
 * The tail end of every successful login, whether that took one step (no
 * 2FA needed, or a remembered device) or three (password, then a code).
 * Only called once 2FA — if required — has actually been satisfied, so
 * `lastLoginAt` and the LOGIN activity entry never record an attempt that
 * stalled out mid-OTP.
 */
export async function completeLogin(
  user: Parameters<typeof issueSession>[0],
  ipAddress?: string,
): Promise<AuthResult> {
  await authRepository.updateLastLogin(user.id);
  await logActivity({
    tenantId: user.tenantId,
    userId: user.id,
    action: "LOGIN",
    description: `${user.name} logged in`,
    ipAddress,
  });
  return issueSession(user);
}

export async function register(input: RegisterInput): Promise<LoginOutcome> {
  const existing = await authRepository.findUserByEmail(input.email);
  if (existing) {
    throw new ConflictError("An account with this email already exists", {
      email: ["An account with this email already exists"],
    });
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

  // A brand-new business's owner is exactly the "OWNER with no 2FA set up
  // yet" case — same forced-setup path as an existing owner encountering
  // the mandatory-2FA rule for the first time.
  const { mfaToken } = await twoFactorAuthService.beginTwoFactorFlow({
    id: owner.id,
    tenantId: owner.tenantId,
    role: owner.role,
    email: owner.email,
    phone: null,
    twoFactorEnabled: false,
    twoFactorConfirmedAt: null,
    twoFactorChannel: null,
  });
  return { status: "setup_required", mfaToken };
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

  if (!user || !user.isActive) {
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

  // Only revealed after credentials check out — a suspended tenant's email
  // is not something a failed-password attempt should be able to confirm.
  if (user.tenant.subscriptionStatus === SubscriptionStatus.SUSPENDED) {
    throw new ForbiddenError(
      "This business account has been suspended. Contact support.",
    );
  }

  let viaRememberedDevice = false;
  if (twoFactorAuthService.requiresTwoFactor(user)) {
    const rememberedDevice = rememberDeviceToken
      ? await twoFactorAuthService.findValidRememberedDevice(
          user.id,
          rememberDeviceToken,
        )
      : null;

    if (!rememberedDevice) {
      const outcome = await twoFactorAuthService.beginTwoFactorFlow(user);
      return outcome;
    }

    await twoFactorAuthService.slideRememberedDevice(rememberedDevice.id);
    viaRememberedDevice = true;
  }

  return {
    status: "success",
    viaRememberedDevice,
    ...(await completeLogin(user, ipAddress)),
  };
}

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
  if (
    !user ||
    !user.isActive ||
    user.tenant.subscriptionStatus === SubscriptionStatus.SUSPENDED
  ) {
    throw new UnauthorizedError("Invalid or expired refresh token");
  }

  // Rotate: the old refresh token is single-use.
  await authRepository.revokeRefreshToken(stored.id);
  return issueSession(user);
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
  await authRepository.createPasswordResetToken({
    tenantId: user.tenantId,
    userId: user.id,
    tokenHash: hashOpaqueToken(token),
    expiresAt: new Date(
      Date.now() + ms(env.PASSWORD_RESET_TOKEN_TTL as ms.StringValue),
    ),
  });

  // TODO: wire up an email/SMS provider. Until then, only log the raw token
  // outside production — logging it in prod would leak a live credential
  // into container logs/log aggregators, and the reset flow is unusable in
  // prod anyway without a real delivery channel.
  if (!isProduction) {
    console.info(`Password reset requested for ${user.email}. Token: ${token}`);
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

  await logActivity({
    tenantId: stored.tenantId,
    userId: stored.userId,
    action: "PASSWORD_RESET",
    description: "Password was reset",
  });
}
