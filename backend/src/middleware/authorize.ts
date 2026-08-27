import type { NextFunction, Request, Response } from "express";
import { ForbiddenError, UnauthorizedError } from "../shared/errors.ts";
import type { Role } from "../generated/prisma";

export function authorize(...allowedRoles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) {
      throw new UnauthorizedError();
    }
    if (!allowedRoles.includes(req.auth.role)) {
      throw new ForbiddenError(
        "You do not have permission to perform this action",
      );
    }
    next();
  };
}
