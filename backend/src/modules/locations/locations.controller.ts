import type { Request, Response } from "express";
import { created, ok } from "../../shared/api-response";
import { logActivity } from "../../lib/activity-logger";
import { requireParam } from "../../shared/params";
import * as locationsService from "./locations.service";
import { createLocationSchema, updateLocationSchema } from "./locations.validators";

export async function list(req: Request, res: Response) {
  const result = await locationsService.list(req.auth!.tenantId, req.query);
  ok(res, result);
}

export async function create(req: Request, res: Response) {
  const input = createLocationSchema.parse(req.body);
  const location = await locationsService.create(req.auth!.tenantId, input);
  await logActivity({
    tenantId: req.auth!.tenantId,
    userId: req.auth!.userId,
    action: "LOCATION_CREATED",
    description: `Location "${location.name}" created`,
  });
  created(res, location);
}

export async function update(req: Request, res: Response) {
  const input = updateLocationSchema.parse(req.body);
  const location = await locationsService.update(
    req.auth!.tenantId,
    requireParam(req, "id"),
    input,
  );
  await logActivity({
    tenantId: req.auth!.tenantId,
    userId: req.auth!.userId,
    action: "LOCATION_UPDATED",
    description: `Location "${location.name}" updated`,
  });
  ok(res, location);
}
