import type { Request, Response } from "express";
import { created, ok } from "../../shared/api-response";
import { requireParam } from "../../shared/params";
import * as brandsService from "./brands.service";
import { createBrandSchema, updateBrandSchema } from "./brands.validators";

export async function list(req: Request, res: Response) {
  ok(res, await brandsService.list(req.auth!.tenantId, req.query));
}

export async function create(req: Request, res: Response) {
  const input = createBrandSchema.parse(req.body);
  created(res, await brandsService.create(req.auth!.tenantId, input));
}

export async function update(req: Request, res: Response) {
  const input = updateBrandSchema.parse(req.body);
  ok(res, await brandsService.update(req.auth!.tenantId, requireParam(req, "id"), input));
}
