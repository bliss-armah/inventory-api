import type { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma.ts";
import { ForbiddenError, UnauthorizedError } from "../shared/errors.ts";

export async function requirePos(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) {
    throw new UnauthorizedError();
  }

  const settings = await prisma.businessSettings.findUnique({
    where: { tenantId: req.auth.tenantId },
    select: { enablePos: true },
  });

  if (!settings?.enablePos) {
    throw new ForbiddenError("Point of sale is not enabled for this business");
  }

  next();
}
