import type { Request, Response } from "express";
import { created, ok } from "../../shared/api-response.ts";
import { requireParam } from "../../shared/params.ts";
import * as shiftsService from "./shifts.service.ts";
import { closeShiftSchema, openShiftSchema } from "./shifts.validators.ts";

export async function current(req: Request, res: Response) {
  ok(res, await shiftsService.getCurrent(req.auth!.tenantId, req.auth!.userId));
}

export async function open(req: Request, res: Response) {
  const input = openShiftSchema.parse(req.body);
  created(res, await shiftsService.open(req.auth!.tenantId, req.auth!.userId, input));
}

export async function close(req: Request, res: Response) {
  const input = closeShiftSchema.parse(req.body);
  ok(res, await shiftsService.close(req.auth!.tenantId, req.auth!.userId, requireParam(req, "id"), input));
}

export async function forceClose(req: Request, res: Response) {
  const input = closeShiftSchema.parse(req.body);
  ok(
    res,
    await shiftsService.forceClose(
      req.auth!.tenantId,
      req.auth!.userId,
      req.auth!.role,
      requireParam(req, "id"),
      input,
    ),
  );
}

export async function list(req: Request, res: Response) {
  ok(res, await shiftsService.list(req.auth!.tenantId, req.auth!.userId, req.auth!.role, req.query));
}
