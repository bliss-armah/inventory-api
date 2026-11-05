import type { NextFunction, Request, Response } from "express";
import { hashOpaqueToken } from "../lib/tokens";
import { UnauthorizedError } from "../shared/errors";
import * as authRepository from "../modules/auth/auth.repository";
import * as pendingLoginRepository from "../modules/auth/pending-login.repository";
import * as membershipsRepository from "../modules/memberships/memberships.repository";

async function resolvePendingLogin(req: Request): Promise<boolean> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return false;
  }
  const token = header.slice("Bearer ".length);
  const pending = await pendingLoginRepository.findPendingLoginByTokenHash(
    hashOpaqueToken(token),
  );
  if (!pending || pending.expiresAt < new Date()) {
    return false;
  }

  const user = await authRepository.findUserById(pending.userId);
  if (!user) {
    return false;
  }

  const memberships = await membershipsRepository.listActiveForUser(user.id);
  if (memberships.length === 0) {
    return false;
  }

  req.auth = {
    userId: user.id,
    tenantId: "",
    role: memberships[0]!.role,
    pendingAuthId: pending.id,
  };
  return true;
}

export async function authenticateBusinessSelection(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  if (!(await resolvePendingLogin(req))) {
    throw new UnauthorizedError("Invalid or expired login session");
  }
  next();
}
