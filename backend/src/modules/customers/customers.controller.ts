import type { Request, Response } from "express";
import { created, ok } from "../../shared/api-response.ts";
import { requireParam } from "../../shared/params.ts";
import * as customersService from "./customers.service.ts";
import { createCustomerSchema, updateCustomerSchema } from "./customers.validators.ts";

export async function list(req: Request, res: Response) {
  ok(res, await customersService.list(req.auth!.tenantId, req.query));
}

export async function get(req: Request, res: Response) {
  ok(res, await customersService.get(req.auth!.tenantId, requireParam(req, "id")));
}

export async function create(req: Request, res: Response) {
  const input = createCustomerSchema.parse(req.body);
  created(res, await customersService.create(req.auth!.tenantId, req.auth!.userId, input));
}

export async function update(req: Request, res: Response) {
  const input = updateCustomerSchema.parse(req.body);
  ok(
    res,
    await customersService.update(
      req.auth!.tenantId,
      req.auth!.userId,
      requireParam(req, "id"),
      input,
    ),
  );
}

export async function listSales(req: Request, res: Response) {
  ok(res, await customersService.listSales(req.auth!.tenantId, requireParam(req, "id"), req.query));
}
