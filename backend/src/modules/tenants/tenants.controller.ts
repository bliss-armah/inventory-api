import type { Request, Response } from "express";
import { ok } from "../../shared/api-response";
import * as tenantsService from "./tenants.service";
import { updateSettingsSchema, updateTenantSchema } from "./tenants.validators";

export async function getCurrentTenant(req: Request, res: Response) {
  ok(res, await tenantsService.getCurrentTenant(req.auth!.tenantId));
}

export async function updateCurrentTenant(req: Request, res: Response) {
  const input = updateTenantSchema.parse(req.body);
  ok(
    res,
    await tenantsService.updateCurrentTenant(req.auth!.tenantId, req.auth!.userId, input),
  );
}

export async function getSettings(req: Request, res: Response) {
  ok(res, await tenantsService.getSettings(req.auth!.tenantId));
}

export async function updateSettings(req: Request, res: Response) {
  const input = updateSettingsSchema.parse(req.body);
  ok(res, await tenantsService.updateSettings(req.auth!.tenantId, req.auth!.userId, input));
}
