import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../lib/jwt";
import { hashOpaqueToken } from "../lib/tokens";
import { UnauthorizedError } from "../shared/errors";
import * as authRepository from "../modules/auth/auth.repository";
import * as twoFactorAuthRepository from "../modules/two-factor-auth/two-factor-auth.repository";

async function resolvePendingAuth(req: Request): Promise<boolean> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return false;
  }
  const token = header.slice("Bearer ".length);
  const pending = await twoFactorAuthRepository.findPendingAuthByTokenHash(hashOpaqueToken(token));
  if (!pending || pending.expiresAt < new Date()) {
    return false;
  }

  const user = await authRepository.findUserById(pending.userId);
  if (!user || !user.isActive) {
    return false;
  }

  req.auth = {
    userId: user.id,
    tenantId: user.tenantId,
    role: user.role,
    mfaPending: true,
    pendingAuthId: pending.id,
  };
  return true;
}

/**
 * Accepts only the short-lived bearer token issued right after a password
 * check when 2FA still needs to be completed — never a normal access token.
 * This is what makes the isolation work: a token minted for "prove you have
 * the phone" can't be replayed against any regular API route, because
 * `authenticate` only accepts JWTs and this only accepts a PendingTwoFactorAuth
 * lookup hit.
 */
export async function authenticateMfaPending(req: Request, _res: Response, next: NextFunction) {
  if (await resolvePendingAuth(req)) {
    next();
    return;
  }
  throw new UnauthorizedError("Invalid or expired two-factor session");
}

/**
 * The 2FA setup endpoints are reachable from two different contexts: a
 * user who's already fully logged in opting in from Settings (normal access
 * token), and an OWNER forced through setup mid-login (pending-auth token
 * only, no full session yet). Try a normal token first since it's the more
 * common case, then fall back to the pending-auth lookup.
 */
export function authenticateAny(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    const token = header.slice("Bearer ".length);
    try {
      const payload = verifyAccessToken(token);
      req.auth = { userId: payload.sub, tenantId: payload.tenantId, role: payload.role };
      next();
      return;
    } catch {
      // Not a valid full access token — fall through to the pending-auth check.
    }
  }

  resolvePendingAuth(req).then((ok) => {
    if (ok) {
      next();
    } else {
      next(new UnauthorizedError("Invalid or expired access token"));
    }
  }, next);
}
