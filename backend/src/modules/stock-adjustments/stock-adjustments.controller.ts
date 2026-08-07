import type { Request, Response } from "express";
import { created, ok } from "../../shared/api-response";
import * as stockAdjustmentsService from "./stock-adjustments.service";
import { createAdjustmentSchema } from "./stock-adjustments.validators";

export async function list(req: Request, res: Response) {
  ok(res, await stockAdjustmentsService.list(req.auth!.tenantId, req.query));
}

export async function create(req: Request, res: Response) {
  const input = createAdjustmentSchema.parse(req.body);
  const result = await stockAdjustmentsService.create(
    req.auth!.tenantId,
    req.auth!.userId,
    input,
  );
  created(res, result);
}
