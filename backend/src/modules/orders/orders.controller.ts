import type { Request, Response } from "express";
import { created, ok } from "../../shared/api-response.ts";
import { requireParam } from "../../shared/params.ts";
import * as ordersService from "./orders.service.ts";
import { createOrderSchema, updatePickingSchema } from "./orders.validators.ts";

export async function create(req: Request, res: Response) {
  const input = createOrderSchema.parse(req.body);
  const { order, alreadyExisted } = await ordersService.create(
    req.auth!.tenantId,
    req.auth!.userId,
    input,
  );
  if (alreadyExisted) {
    ok(res, order, "Order already recorded");
    return;
  }
  created(res, order);
}

export async function list(req: Request, res: Response) {
  ok(res, await ordersService.list(req.auth!.tenantId, req.query));
}

export async function get(req: Request, res: Response) {
  ok(res, await ordersService.get(req.auth!.tenantId, requireParam(req, "id")));
}

export async function getByNumber(req: Request, res: Response) {
  ok(res, await ordersService.getByNumber(req.auth!.tenantId, requireParam(req, "orderNumber")));
}

export async function cancel(req: Request, res: Response) {
  ok(
    res,
    await ordersService.cancel(req.auth!.tenantId, req.auth!.userId, requireParam(req, "id")),
  );
}

export async function updatePicking(req: Request, res: Response) {
  const input = updatePickingSchema.parse(req.body);
  ok(
    res,
    await ordersService.updatePicking(
      req.auth!.tenantId,
      req.auth!.userId,
      requireParam(req, "id"),
      input,
    ),
  );
}
