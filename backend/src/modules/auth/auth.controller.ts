import type { Request, Response } from "express";
import { created, ok } from "../../shared/api-response.ts";
import { ForbiddenError, UnauthorizedError } from "../../shared/errors.ts";
import { Role } from "../../generated/prisma/enums.ts";
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
import * as twoFactorAuthRepository from "../two-factor-auth/two-factor-auth.repository.ts";
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from "./auth.validators.ts";
import {
  sendSetupCodeSchema,
  confirmSetupSchema,
  verifyLoginSchema,
  disableTwoFactorSchema,
} from "../two-factor-auth/two-factor-auth.validators.ts";
import { verifyPassword } from "../../lib/password.ts";

export async function register(req: Request, res: Response) {
  const input = registerSchema.parse(req.body);
  const result = await authService.register(input);
  if (result.status === "success") {
    setRefreshCookie(res, result.refreshToken);
    created(res, {
      status: "success",
      user: result.user,
      accessToken: result.accessToken,
    });
    return;
  }
  created(res, { status: result.status, mfaToken: result.mfaToken });
}

export async function login(req: Request, res: Response) {
  const input = loginSchema.parse(req.body);
  const rememberDeviceToken = req.cookies?.[REMEMBER_DEVICE_COOKIE_NAME];
  const result = await authService.login(input, req.ip, rememberDeviceToken);
  if (result.status === "success") {
    setRefreshCookie(res, result.refreshToken);
    if (result.viaRememberedDevice) {
      // The DB-side expiry already slid forward; refresh the cookie's own
      // maxAge too, or it would still self-expire 30 days after it was
      // first set regardless of continued use.
      setRememberDeviceCookie(res, rememberDeviceToken);
    }
    ok(res, {
      status: "success",
      user: result.user,
      accessToken: result.accessToken,
    });
    return;
  }
  ok(
    res,
    result.status === "otp_required"
      ? {
          status: result.status,
          mfaToken: result.mfaToken,
          channel: result.channel,
        }
      : { status: result.status, mfaToken: result.mfaToken },
  );
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
  ok(res, {
    id: user.id,
    tenantId: user.tenantId,
    name: user.name,
    email: user.email,
    role: user.role,
    phone: user.phone,
    twoFactorEnabled: user.twoFactorEnabled,
    twoFactorChannel: user.twoFactorChannel,
    twoFactorRequired: user.role === Role.OWNER,
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
  await twoFactorAuthRepository.deletePendingAuth(req.auth!.pendingAuthId!);

  const user = await authRepository.findUserById(req.auth!.userId);
  if (!user) {
    throw new UnauthorizedError();
  }
  const result = await authService.completeLogin(user, req.ip);
  setRefreshCookie(res, result.refreshToken);

  if (input.rememberDevice) {
    const deviceToken = await twoFactorAuthService.createRememberedDevice(
      user.tenantId,
      user.id,
    );
    setRememberDeviceCookie(res, deviceToken);
  }

  ok(res, {
    status: "success",
    user: result.user,
    accessToken: result.accessToken,
  });
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
  const { backupCodes } = await twoFactorAuthService.confirmSetup(
    req.auth!.tenantId,
    req.auth!.userId,
    code,
  );

  if (!req.auth!.mfaPending) {
    ok(res, { status: "enabled" as const, backupCodes });
    return;
  }

  await twoFactorAuthRepository.deletePendingAuth(req.auth!.pendingAuthId!);
  const user = await authRepository.findUserById(req.auth!.userId);
  if (!user) {
    throw new UnauthorizedError();
  }
  const result = await authService.completeLogin(user, req.ip);
  setRefreshCookie(res, result.refreshToken);
  ok(res, {
    status: "success" as const,
    user: result.user,
    accessToken: result.accessToken,
    backupCodes,
  });
}

export async function disableTwoFactor(req: Request, res: Response) {
  if (req.auth!.role === Role.OWNER) {
    throw new ForbiddenError(
      "Two-factor authentication is required for the OWNER role",
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
