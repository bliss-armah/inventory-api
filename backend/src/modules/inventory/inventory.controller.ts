import type { Request, Response } from "express";
import { ok } from "../../shared/api-response";
import * as inventoryService from "./inventory.service";

export async function list(req: Request, res: Response) {
  ok(res, await inventoryService.list(req.auth!.tenantId, req.query));
}
