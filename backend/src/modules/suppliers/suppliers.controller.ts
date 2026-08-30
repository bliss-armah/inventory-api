import type { Request, Response } from "express";
import { created, ok } from "../../shared/api-response";
import { logActivity } from "../../lib/activity-logger";
import { requireParam } from "../../shared/params";
import * as suppliersService from "./suppliers.service";
import { createSupplierSchema, updateSupplierSchema } from "./suppliers.validators";

export async function list(req: Request, res: Response) {
  ok(res, await suppliersService.list(req.auth!.tenantId, req.query));
}

export async function create(req: Request, res: Response) {
  const input = createSupplierSchema.parse(req.body);
  const supplier = await suppliersService.create(req.auth!.tenantId, input);
  await logActivity({
    tenantId: req.auth!.tenantId,
    userId: req.auth!.userId,
    action: "SUPPLIER_CREATED",
    description: `Supplier "${supplier.name}" created`,
  });
  created(res, supplier);
}

export async function update(req: Request, res: Response) {
  const input = updateSupplierSchema.parse(req.body);
  const supplier = await suppliersService.update(
    req.auth!.tenantId,
    requireParam(req, "id"),
    input,
  );
  await logActivity({
    tenantId: req.auth!.tenantId,
    userId: req.auth!.userId,
    action: "SUPPLIER_UPDATED",
    description: `Supplier "${supplier.name}" updated`,
  });
  ok(res, supplier);
}
