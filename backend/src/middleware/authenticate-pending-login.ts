import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../lib/jwt";
import { hashOpaqueToken } from "../lib/tokens";
import { UnauthorizedError } from "../shared/errors";
import * as authRepository from "../modules/auth/auth.repository";
import * as membershipsRepository from "../modules/memberships/memberships.repository";
import * as twoFactorAuthRepository from "../modules/two-factor-auth/two-factor-auth.repository";

/**
 * A pending login has no tenant yet — that's the whole point of the business
 * selection step — so `req.auth.tenantId` can't be filled from the token the
 * way `authenticate` fills it. It is left empty on the 2FA-only paths and
 * populated from the membership the caller picks.
 */
async function resolvePendingLogin(req: Request): Promise<boolean> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return false;
  }
  const token = header.slice("Bearer ".length);
  const pending = await twoFactorAuthRepository.findPendingLoginByTokenHash(
    hashOpaqueToken(token),
  );
  if (!pending || pending.expiresAt < new Date()) {
    return false;
  }

  const user = await authRepository.findUserById(pending.userId);
  if (!user) {
    return false;
  }

  // A pending login is worth nothing if every membership behind it has since
  // been deactivated — an owner who revokes access mid-OTP means it now.
  const memberships = await membershipsRepository.listActiveForUser(user.id);
  if (memberships.length === 0) {
    return false;
  }

  req.auth = {
    userId: user.id,
    tenantId: "",
    // Placeholder until a business is chosen. Nothing role-gated is reachable
    // with a pending-login token — the routes that accept one are listed in
    // auth.routes.ts and none of them call `authorize`.
    role: memberships[0]!.role,
    mfaPending: true,
    twoFactorSatisfied: pending.twoFactorAt !== null,
    pendingAuthId: pending.id,
  };
  return true;
}

/**
 * Accepts only the short-lived bearer token issued right after a password
 * check when the login still has steps to go — never a normal access token.
 * This is what makes the isolation work: a token minted for "prove you have
 * the phone" can't be replayed against any regular API route, because
 * `authenticate` only accepts JWTs and this only accepts a PendingLogin
 * lookup hit.
 */
export async function authenticatePendingLogin(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  if (await resolvePendingLogin(req)) {
    next();
    return;
  }
  throw new UnauthorizedError("Invalid or expired two-factor session");
}

/**
 * Business selection is the step *after* the second factor, so it demands a
 * pending login that has actually cleared one. Without this check a stolen
 * password alone would be enough to list — and enter — every business the
 * account belongs to, which is exactly what 2FA is there to prevent.
 */
export async function authenticateBusinessSelection(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  if (!(await resolvePendingLogin(req))) {
    throw new UnauthorizedError("Invalid or expired login session");
  }
  if (!req.auth?.twoFactorSatisfied) {
    throw new UnauthorizedError("Two-factor authentication is not complete");
  }
  next();
}

/**
 * The 2FA setup endpoints are reachable from two different contexts: a
 * user who's already fully logged in opting in from Settings (normal access
 * token), and an owner forced through setup mid-login (pending-login token
 * only, no full session yet). Try a normal token first since it's the more
 * common case, then fall back to the pending-login lookup.
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
      // Not a valid full access token — fall through to the pending-login check.
    }
  }

  resolvePendingLogin(req).then((ok) => {
    if (ok) {
      next();
    } else {
      next(new UnauthorizedError("Invalid or expired access token"));
    }
  }, next);
}
