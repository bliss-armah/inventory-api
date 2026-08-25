import type { Request, Response } from "express";
import ms from "ms";
import { env, isProduction } from "../../config/env";
import { created, ok } from "../../shared/api-response";
import { UnauthorizedError } from "../../shared/errors";
import * as platformAuthService from "./platform-auth.service";
import {
  createPlatformAdminSchema,
  platformForgotPasswordSchema,
  platformLoginSchema,
  platformResetPasswordSchema,
} from "./platform-auth.validators";

const REFRESH_COOKIE_NAME = "platformRefreshToken";
const REFRESH_COOKIE_PATH = "/api/platform/auth";

function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: REFRESH_COOKIE_PATH,
    maxAge: ms(env.PLATFORM_REFRESH_TOKEN_TTL as ms.StringValue),
  });
}

function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
}

export async function login(req: Request, res: Response) {
  const input = platformLoginSchema.parse(req.body);
  const result = await platformAuthService.login(input);
  setRefreshCookie(res, result.refreshToken);
  ok(res, { admin: result.admin, accessToken: result.accessToken });
}

export async function refresh(req: Request, res: Response) {
  const token = req.cookies?.[REFRESH_COOKIE_NAME];
  if (!token) {
    throw new UnauthorizedError("Missing refresh token");
  }
  const result = await platformAuthService.refresh(token);
  setRefreshCookie(res, result.refreshToken);
  ok(res, { admin: result.admin, accessToken: result.accessToken });
}

export async function logout(req: Request, res: Response) {
  const token = req.cookies?.[REFRESH_COOKIE_NAME];
  if (token) {
    await platformAuthService.logout(token);
  }
  clearRefreshCookie(res);
  ok(res, null);
}

export async function me(req: Request, res: Response) {
  ok(res, await platformAuthService.me(req.platformAdmin!.id));
}

export async function forgotPassword(req: Request, res: Response) {
  const input = platformForgotPasswordSchema.parse(req.body);
  await platformAuthService.forgotPassword(input);
  ok(res, null, "If that email has a platform account, a reset link is on its way.");
}

export async function resetPassword(req: Request, res: Response) {
  const input = platformResetPasswordSchema.parse(req.body);
  await platformAuthService.resetPassword(input);
  ok(res, null, "Password updated. Sign in with your new password.");
}

export async function createAdmin(req: Request, res: Response) {
  const input = createPlatformAdminSchema.parse(req.body);
  created(res, await platformAuthService.createAdmin(input));
}

export async function listAdmins(_req: Request, res: Response) {
  ok(res, await platformAuthService.listAdmins());
}
