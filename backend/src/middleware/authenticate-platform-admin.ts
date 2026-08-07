import type { NextFunction, Request, Response } from "express";
import { verifyPlatformAccessToken } from "../lib/jwt";
import { UnauthorizedError } from "../shared/errors";

export type PlatformAdminContext = {
  id: string;
};

// A separate field from `req.auth` (tenant users) so the two identity types
// can never be confused by a handler reading the wrong property.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      platformAdmin?: PlatformAdminContext;
    }
  }
}

/**
 * Verifies a platform-admin bearer token. Uses a different secret and a
 * `type` discriminator from tenant access tokens (see lib/jwt.ts), so this
 * can never accept a tenant user's token, however it might be crafted.
 */
export function authenticatePlatformAdmin(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new UnauthorizedError("Missing access token");
  }

  const token = header.slice("Bearer ".length);

  try {
    const payload = verifyPlatformAccessToken(token);
    req.platformAdmin = { id: payload.sub };
    next();
  } catch {
    throw new UnauthorizedError("Invalid or expired access token");
  }
}
