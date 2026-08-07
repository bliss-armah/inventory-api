import type { Request, Response } from "express";
import { created, ok } from "../../shared/api-response";
import { requireParam } from "../../shared/params";
import * as stockCountsService from "./stock-counts.service";
import { createStockCountSchema, updateCountItemsSchema } from "./stock-counts.validators";

export async function list(req: Request, res: Response) {
  ok(res, await stockCountsService.list(req.auth!.tenantId, req.query));
}

export async function getOne(req: Request, res: Response) {
  ok(res, await stockCountsService.findOne(req.auth!.tenantId, requireParam(req, "id")));
}

export async function create(req: Request, res: Response) {
  const input = createStockCountSchema.parse(req.body);
  created(res, await stockCountsService.create(req.auth!.tenantId, req.auth!.userId, input));
}

export async function updateItems(req: Request, res: Response) {
  const input = updateCountItemsSchema.parse(req.body);
  ok(
    res,
    await stockCountsService.updateItems(req.auth!.tenantId, requireParam(req, "id"), input),
  );
}

export async function complete(req: Request, res: Response) {
  ok(
    res,
    await stockCountsService.complete(
      req.auth!.tenantId,
      req.auth!.userId,
      requireParam(req, "id"),
    ),
  );
}
