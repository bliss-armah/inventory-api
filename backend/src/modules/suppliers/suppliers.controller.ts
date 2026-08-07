import type { Request, Response } from "express";
import { created, ok } from "../../shared/api-response";
import { requireParam } from "../../shared/params";
import * as suppliersService from "./suppliers.service";
import { createSupplierSchema, updateSupplierSchema } from "./suppliers.validators";

export async function list(req: Request, res: Response) {
  ok(res, await suppliersService.list(req.auth!.tenantId, req.query));
}

export async function create(req: Request, res: Response) {
  const input = createSupplierSchema.parse(req.body);
  created(res, await suppliersService.create(req.auth!.tenantId, input));
}

export async function update(req: Request, res: Response) {
  const input = updateSupplierSchema.parse(req.body);
  ok(res, await suppliersService.update(req.auth!.tenantId, requireParam(req, "id"), input));
}
