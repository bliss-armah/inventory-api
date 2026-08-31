import type { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma.ts";
import { ForbiddenError, UnauthorizedError } from "../shared/errors.ts";
import { SubscriptionStatus } from "../generated/prisma";

export async function requirePos(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) {
    throw new UnauthorizedError();
  }

  const membership = await prisma.membership.findUnique({
    where: {
      userId_tenantId: { userId: req.auth.userId, tenantId: req.auth.tenantId },
    },
    select: {
      isActive: true,
      tenant: {
        select: {
          subscriptionStatus: true,
          settings: { select: { enablePos: true } },
        },
      },
    },
  });

  if (!membership || !membership.isActive) {
    throw new UnauthorizedError("Your access to this business has been revoked");
  }

  if (membership.tenant.subscriptionStatus === SubscriptionStatus.SUSPENDED) {
    throw new UnauthorizedError("This business is suspended");
  }

  if (!membership.tenant.settings?.enablePos) {
    throw new ForbiddenError("Point of sale is not enabled for this business");
  }

  next();
}
