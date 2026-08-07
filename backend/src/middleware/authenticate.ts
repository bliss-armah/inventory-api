import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../lib/jwt.ts";
import { UnauthorizedError } from "../shared/errors.ts";
import type { Role } from "../generated/prisma/enums.ts";

export type AuthContext = {
  userId: string;
  tenantId: string;
  role: Role;
  /**
   * True only for the short-lived, DB-backed session used mid-2FA-flow
   * (see modules/two-factor-auth). Never set by this middleware — normal
   * access tokens are always a full session.
   */
  mfaPending?: boolean;
  /** Set alongside mfaPending — the PendingTwoFactorAuth row id, so it can
   * be deleted once the 2FA flow completes. */
  pendingAuthId?: string;
};

// Augments Express's Request type so every downstream handler sees `req.auth`
// once this middleware has run, without needing a manual cast at each call site.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

/**
 * Verifies the bearer access token and attaches tenant-scoped identity to the
 * request. Tenant isolation always derives from this token — never from a
 * client-supplied tenantId in the body, params, or query string.
 */
export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new UnauthorizedError("Missing access token");
  }

  const token = header.slice("Bearer ".length);

  try {
    const payload = verifyAccessToken(token);
    req.auth = {
      userId: payload.sub,
      tenantId: payload.tenantId,
      role: payload.role,
    };
    next();
  } catch {
    throw new UnauthorizedError("Invalid or expired access token");
  }
}
