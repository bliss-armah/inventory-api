import type { Request, Response } from "express";
import { created, ok } from "../../shared/api-response";
import { requireParam } from "../../shared/params";
import * as platformTenantsService from "./platform-tenants.service";
import {
  createTenantSchema,
  entitlementsSchema,
  suspendTenantSchema,
} from "./platform-tenants.validators";

export async function list(req: Request, res: Response) {
  ok(res, await platformTenantsService.list(req.query));
}

export async function getOne(req: Request, res: Response) {
  ok(res, await platformTenantsService.findOne(requireParam(req, "id")));
}

export async function suspend(req: Request, res: Response) {
  const input = suspendTenantSchema.parse(req.body);
  ok(res, await platformTenantsService.suspend(requireParam(req, "id"), input));
}

export async function reactivate(req: Request, res: Response) {
  ok(res, await platformTenantsService.reactivate(requireParam(req, "id")));
}

export async function create(req: Request, res: Response) {
  const input = createTenantSchema.parse(req.body);
  created(res, await platformTenantsService.createTenant(input));
}

export async function updateEntitlements(req: Request, res: Response) {
  const input = entitlementsSchema.parse(req.body);
  ok(
    res,
    await platformTenantsService.updateEntitlements(requireParam(req, "id"), input),
  );
}

export async function stats(_req: Request, res: Response) {
  ok(res, await platformTenantsService.stats());
}
