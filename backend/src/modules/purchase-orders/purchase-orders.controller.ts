import type { Request, Response } from "express";
import { created, ok } from "../../shared/api-response";
import { logActivity } from "../../lib/activity-logger";
import { requireParam } from "../../shared/params";
import * as purchaseOrdersService from "./purchase-orders.service";
import { createPurchaseOrderSchema, receiveGoodsSchema } from "./purchase-orders.validators";

export async function list(req: Request, res: Response) {
  ok(res, await purchaseOrdersService.list(req.auth!.tenantId, req.query));
}

export async function getOne(req: Request, res: Response) {
  ok(res, await purchaseOrdersService.findOne(req.auth!.tenantId, requireParam(req, "id")));
}

export async function create(req: Request, res: Response) {
  const input = createPurchaseOrderSchema.parse(req.body);
  const order = await purchaseOrdersService.create(req.auth!.tenantId, req.auth!.userId, input);
  await logActivity({
    tenantId: req.auth!.tenantId,
    userId: req.auth!.userId,
    action: "PURCHASE_ORDER_CREATED",
    description: `Purchase order ${order.orderNumber} created`,
  });
  created(res, order);
}

export async function submit(req: Request, res: Response) {
  const order = await purchaseOrdersService.submit(req.auth!.tenantId, requireParam(req, "id"));
  await logActivity({
    tenantId: req.auth!.tenantId,
    userId: req.auth!.userId,
    action: "PURCHASE_ORDER_SUBMITTED",
    description: `Purchase order ${order.orderNumber} submitted for approval`,
  });
  ok(res, order);
}

export async function approve(req: Request, res: Response) {
  ok(
    res,
    await purchaseOrdersService.approve(
      req.auth!.tenantId,
      req.auth!.userId,
      requireParam(req, "id"),
    ),
  );
}

export async function cancel(req: Request, res: Response) {
  const order = await purchaseOrdersService.cancel(req.auth!.tenantId, requireParam(req, "id"));
  await logActivity({
    tenantId: req.auth!.tenantId,
    userId: req.auth!.userId,
    action: "PURCHASE_ORDER_CANCELED",
    description: `Purchase order ${order.orderNumber} canceled`,
  });
  ok(res, order);
}

export async function receiveGoods(req: Request, res: Response) {
  const input = receiveGoodsSchema.parse(req.body);
  const result = await purchaseOrdersService.receiveGoods(
    req.auth!.tenantId,
    req.auth!.userId,
    requireParam(req, "id"),
    input,
  );
  created(res, result);
}
