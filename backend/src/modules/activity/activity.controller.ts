import type { Request, Response } from "express";
import { ok } from "../../shared/api-response";
import * as activityService from "./activity.service";

export async function list(req: Request, res: Response) {
  ok(res, await activityService.list(req.auth!.tenantId, req.query));
}
