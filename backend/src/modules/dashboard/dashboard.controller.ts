import type { Request, Response } from "express";
import { ok } from "../../shared/api-response";
import * as dashboardService from "./dashboard.service";

export async function getDashboard(req: Request, res: Response) {
  ok(res, await dashboardService.getDashboard(req.auth!.tenantId, req.auth!.role));
}
