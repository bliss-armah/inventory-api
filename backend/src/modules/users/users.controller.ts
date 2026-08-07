import type { Request, Response } from "express";
import { created, ok } from "../../shared/api-response";
import { logActivity } from "../../lib/activity-logger";
import { requireParam } from "../../shared/params";
import * as usersService from "./users.service";
import { createUserSchema, updateUserSchema } from "./users.validators";

export async function list(req: Request, res: Response) {
  const result = await usersService.list(req.auth!.tenantId, req.query);
  ok(res, result);
}

export async function create(req: Request, res: Response) {
  const input = createUserSchema.parse(req.body);
  const user = await usersService.create(req.auth!.tenantId, input);
  await logActivity({
    tenantId: req.auth!.tenantId,
    userId: req.auth!.userId,
    action: "USER_CREATED",
    description: `Staff account created for ${user.email} (${user.role})`,
  });
  created(res, user);
}

export async function update(req: Request, res: Response) {
  const input = updateUserSchema.parse(req.body);
  const user = await usersService.update(req.auth!.tenantId, requireParam(req, "id"), input);
  await logActivity({
    tenantId: req.auth!.tenantId,
    userId: req.auth!.userId,
    action: "USER_UPDATED",
    description: `Staff account updated for ${user.email}`,
  });
  ok(res, user);
}
