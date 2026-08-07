import type { Response } from "express";
import ms from "ms";
import { env, isProduction } from "../config/env";

const REFRESH_COOKIE_NAME = "refreshToken";
const REFRESH_COOKIE_PATH = "/api/auth";
const REMEMBER_DEVICE_COOKIE_NAME = "rememberDevice";
const REMEMBER_DEVICE_COOKIE_PATH = "/api/auth";

export function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: REFRESH_COOKIE_PATH,
    maxAge: ms(env.REFRESH_TOKEN_TTL as ms.StringValue),
  });
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
}

export { REFRESH_COOKIE_NAME };

/**
 * Deliberately a separate cookie from the refresh token, on its own path:
 * a "remembered device" is a weaker, longer-lived signal (skip the OTP
 * prompt) than the refresh token (an active session), and clearing one
 * should never imply clearing the other — logging out shouldn't forget the
 * device, and a device going untrusted shouldn't kill the active session.
 */
export function setRememberDeviceCookie(res: Response, token: string) {
  res.cookie(REMEMBER_DEVICE_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: REMEMBER_DEVICE_COOKIE_PATH,
    maxAge: ms(env.REMEMBERED_DEVICE_TTL as ms.StringValue),
  });
}

export function clearRememberDeviceCookie(res: Response) {
  res.clearCookie(REMEMBER_DEVICE_COOKIE_NAME, { path: REMEMBER_DEVICE_COOKIE_PATH });
}

export { REMEMBER_DEVICE_COOKIE_NAME };
