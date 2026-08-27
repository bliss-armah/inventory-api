import type { Request, Response } from "express";
import { created, ok } from "../../shared/api-response.ts";
import { env } from "../../config/env.ts";
import { ForbiddenError, UnauthorizedError } from "../../shared/errors.ts";
import { Role } from "../../generated/prisma";
import { requireParam } from "../../shared/params.ts";
import {
  setRefreshCookie,
  clearRefreshCookie,
  setRememberDeviceCookie,
  clearRememberDeviceCookie,
  REFRESH_COOKIE_NAME,
  REMEMBER_DEVICE_COOKIE_NAME,
} from "../../lib/cookies.ts";
import * as authService from "./auth.service.ts";
import * as authRepository from "./auth.repository.ts";
import * as twoFactorAuthService from "../two-factor-auth/two-factor-auth.service.ts";
import type { LoginOutcome } from "./auth.types.ts";
import {
  acceptInviteSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  selectBusinessSchema,
} from "./auth.validators.ts";
import {
  sendSetupCodeSchema,
  confirmSetupSchema,
  verifyLoginSchema,
  disableTwoFactorSchema,
} from "../two-factor-auth/two-factor-auth.validators.ts";
import { verifyPassword } from "../../lib/password.ts";

/**
 * Every endpoint that can end a login shares one response shape, because the
 * client has to handle the same four outcomes from each of them: a session, an
 * OTP prompt, a forced 2FA setup, or a business to choose. Only the success
 * branch sets the refresh cookie — the other three hand back a pending token
 * that is useless against any regular route.
 */
function respondWithOutcome(
  res: Response,
  outcome: LoginOutcome,
  send: (res: Response, body: unknown) => void = ok,
) {
  if (outcome.status === "success") {
    setRefreshCookie(res, outcome.refreshToken);
    send(res, {
      status: "success",
      user: outcome.user,
      accessToken: outcome.accessToken,
    });
    return;
  }
  if (outcome.status === "select_business") {
    send(res, {
      status: outcome.status,
      mfaToken: outcome.mfaToken,
      businesses: outcome.businesses,
    });
    return;
  }
  send(
    res,
    outcome.status === "otp_required"
      ? {
          status: outcome.status,
          mfaToken: outcome.mfaToken,
          channel: outcome.channel,
        }
      : { status: outcome.status, mfaToken: outcome.mfaToken },
  );
}

export async function register(req: Request, res: Response) {
  // Checked before validation on purpose: when signup is closed the caller
  // should hear "not allowed", not a critique of the payload they sent.
  if (!env.ALLOW_PUBLIC_REGISTRATION) {
    throw new ForbiddenError(
      "Public registration is disabled. Businesses are created by the platform administrator.",
    );
  }

  const input = registerSchema.parse(req.body);
  respondWithOutcome(res, await authService.register(input), created);
}

export async function login(req: Request, res: Response) {
  const input = loginSchema.parse(req.body);
  const rememberDeviceToken = req.cookies?.[REMEMBER_DEVICE_COOKIE_NAME];
  const result = await authService.login(input, req.ip, rememberDeviceToken);
  if (result.status === "success" && result.viaRememberedDevice) {
    // The DB-side expiry already slid forward; refresh the cookie's own
    // maxAge too, or it would still self-expire 30 days after it was
    // first set regardless of continued use.
    setRememberDeviceCookie(res, rememberDeviceToken);
  }
  respondWithOutcome(res, result);
}

/**
 * The final step for someone who works in more than one business. Reached only
 * with a pending-login token that has already cleared any second factor — see
 * authenticateBusinessSelection.
 */
export async function selectBusiness(req: Request, res: Response) {
  const { tenantId } = selectBusinessSchema.parse(req.body);
  const result = await authService.selectBusiness(
    req.auth!.userId,
    tenantId,
    req.auth!.pendingAuthId!,
    req.ip,
  );
  setRefreshCookie(res, result.refreshToken);
  ok(res, {
    status: "success",
    user: result.user,
    accessToken: result.accessToken,
  });
}

/** Moves an existing session to another of the caller's businesses. */
export async function switchBusiness(req: Request, res: Response) {
  const { tenantId } = selectBusinessSchema.parse(req.body);
  const result = await authService.switchBusiness(req.auth!.userId, tenantId);
  setRefreshCookie(res, result.refreshToken);
  ok(res, { user: result.user, accessToken: result.accessToken });
}

// ---------------------------------------------------------------------------
// Staff invitations
// ---------------------------------------------------------------------------

/**
 * Unauthenticated on purpose: the token came from an email sent to the address
 * it describes, so holding it already establishes who the reader is.
 */
export async function describeInvite(req: Request, res: Response) {
  ok(res, await authService.describeInvite(requireParam(req, "token")));
}

export async function acceptInvite(req: Request, res: Response) {
  const input = acceptInviteSchema.parse(req.body);
  respondWithOutcome(res, await authService.acceptInvite(input, req.ip), created);
}

export async function refresh(req: Request, res: Response) {
  const token = req.cookies?.[REFRESH_COOKIE_NAME];
  if (!token) {
    throw new UnauthorizedError("Missing refresh token");
  }
  const result = await authService.refresh(token);
  setRefreshCookie(res, result.refreshToken);
  ok(res, { user: result.user, accessToken: result.accessToken });
}

export async function logout(req: Request, res: Response) {
  const token = req.cookies?.[REFRESH_COOKIE_NAME];
  if (token) {
    await authService.logout(token);
  }
  clearRefreshCookie(res);
  ok(res, null);
}

export async function forgotPassword(req: Request, res: Response) {
  const input = forgotPasswordSchema.parse(req.body);
  await authService.forgotPassword(input);
  ok(res, null, "If that email exists, a reset link has been sent");
}

export async function resetPassword(req: Request, res: Response) {
  const input = resetPasswordSchema.parse(req.body);
  await authService.resetPassword(input);
  ok(res, null, "Password reset successfully");
}

export async function me(req: Request, res: Response) {
  const user = await authRepository.findUserById(req.auth!.userId);
  if (!user) {
    throw new UnauthorizedError();
  }
  // tenantId and role describe *this session*, so they come from the token,
  // not the identity — the same person can be an OWNER in one business and a
  // CASHIER in another. `businesses` is what the in-app switcher renders.
  const businesses = await authService.listBusinesses(user.id);
  ok(res, {
    id: user.id,
    tenantId: req.auth!.tenantId,
    name: user.name,
    email: user.email,
    role: req.auth!.role,
    phone: user.phone,
    twoFactorEnabled: user.twoFactorEnabled,
    twoFactorChannel: user.twoFactorChannel,
    twoFactorRequired: businesses.some((b) => b.role === Role.OWNER),
    businesses,
  });
}

// ---------------------------------------------------------------------------
// Two-factor authentication
// ---------------------------------------------------------------------------

/** Completes a login that was paused for an OTP or backup code. */
export async function verifyTwoFactor(req: Request, res: Response) {
  const input = verifyLoginSchema.parse(req.body);
  await twoFactorAuthService.verifyLogin({
    userId: req.auth!.userId,
    code: input.code,
    backupCode: input.backupCode,
  });
  // The device is remembered as soon as the factor itself is satisfied, even
  // if a business still has to be picked — the point it attests to ("this
  // phone belongs to this person") is settled either way.
  if (input.rememberDevice) {
    const deviceToken = await twoFactorAuthService.createRememberedDevice(
      req.auth!.userId,
    );
    setRememberDeviceCookie(res, deviceToken);
  }

  respondWithOutcome(
    res,
    await authService.completeAfterTwoFactor(
      req.auth!.userId,
      req.auth!.pendingAuthId!,
      req.ip,
    ),
  );
}

/**
 * Sends a code to verify a second-factor destination, for both forced and
 * opt-in setup. An EMAIL setup needs the account's own address, so the user is
 * loaded here rather than trusting anything in the request body.
 */
export async function sendTwoFactorSetupCode(req: Request, res: Response) {
  const input = sendSetupCodeSchema.parse(req.body);
  const user = await authRepository.findUserById(req.auth!.userId);
  if (!user) {
    throw new UnauthorizedError();
  }
  await twoFactorAuthService.sendSetupCode(user, input);
  ok(res, null, "Verification code sent");
}

/**
 * Confirms setup. When this request came in mid-login (an OWNER forced
 * through setup with no session yet), completing setup also completes the
 * login — same response shape as a normal successful login, plus the
 * backup codes the user must save right now since they're never shown
 * again. When it came from an already-logged-in user opting in via
 * Settings, no new tokens are issued — they already have a session.
 */
export async function confirmTwoFactorSetup(req: Request, res: Response) {
  const { code } = confirmSetupSchema.parse(req.body);
  // Mid-login there is no tenant yet, so the activity entry fans out to every
  // business this person works in instead of naming one.
  const { backupCodes } = await twoFactorAuthService.confirmSetup(
    req.auth!.mfaPending ? null : req.auth!.tenantId,
    req.auth!.userId,
    code,
  );

  if (!req.auth!.mfaPending) {
    ok(res, { status: "enabled" as const, backupCodes });
    return;
  }

  const outcome = await authService.completeAfterTwoFactor(
    req.auth!.userId,
    req.auth!.pendingAuthId!,
    req.ip,
  );
  if (outcome.status === "success") {
    setRefreshCookie(res, outcome.refreshToken);
    ok(res, {
      status: "success" as const,
      user: outcome.user,
      accessToken: outcome.accessToken,
      backupCodes,
    });
    return;
  }
  // More than one business to choose from: hand back the codes now, since
  // they're never shown again, alongside the selection step.
  ok(res, {
    status: "select_business" as const,
    mfaToken: outcome.mfaToken,
    businesses:
      outcome.status === "select_business" ? outcome.businesses : [],
    backupCodes,
  });
}

export async function disableTwoFactor(req: Request, res: Response) {
  // Not `req.auth.role` — that is only this session's role. Someone who is a
  // cashier here but owns another business still can't turn 2FA off, because
  // 2FA belongs to the account, not the seat they happen to be sitting in.
  const businesses = await authService.listBusinesses(req.auth!.userId);
  if (businesses.some((business) => business.role === Role.OWNER)) {
    throw new ForbiddenError(
      "Two-factor authentication is required while you own a business",
    );
  }
  const { password } = disableTwoFactorSchema.parse(req.body);
  const user = await authRepository.findUserById(req.auth!.userId);
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw new UnauthorizedError("Incorrect password");
  }

  await twoFactorAuthService.disable(req.auth!.tenantId, req.auth!.userId);
  clearRememberDeviceCookie(res);
  ok(res, null, "Two-factor authentication disabled");
}

export async function regenerateBackupCodes(req: Request, res: Response) {
  const result = await twoFactorAuthService.regenerateBackupCodes(
    req.auth!.tenantId,
    req.auth!.userId,
  );
  ok(res, result);
}
