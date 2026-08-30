import type { Request, Response } from "express";
import { created, ok } from "../../shared/api-response";
import { logActivity } from "../../lib/activity-logger";
import { requireParam } from "../../shared/params";
import * as brandsService from "./brands.service";
import { createBrandSchema, updateBrandSchema } from "./brands.validators";

export async function list(req: Request, res: Response) {
  ok(res, await brandsService.list(req.auth!.tenantId, req.query));
}

export async function create(req: Request, res: Response) {
  const input = createBrandSchema.parse(req.body);
  const brand = await brandsService.create(req.auth!.tenantId, input);
  await logActivity({
    tenantId: req.auth!.tenantId,
    userId: req.auth!.userId,
    action: "BRAND_CREATED",
    description: `Brand "${brand.name}" created`,
  });
  created(res, brand);
}

export async function update(req: Request, res: Response) {
  const input = updateBrandSchema.parse(req.body);
  const brand = await brandsService.update(req.auth!.tenantId, requireParam(req, "id"), input);
  await logActivity({
    tenantId: req.auth!.tenantId,
    userId: req.auth!.userId,
    action: "BRAND_UPDATED",
    description: `Brand "${brand.name}" updated`,
  });
  ok(res, brand);
}
