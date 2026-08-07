import type { Request, Response } from "express";
import { ok } from "../../shared/api-response";
import * as stockMovementsService from "./stock-movements.service";

export async function list(req: Request, res: Response) {
  ok(res, await stockMovementsService.list(req.auth!.tenantId, req.query));
}
