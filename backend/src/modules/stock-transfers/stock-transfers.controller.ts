import type { Request, Response } from "express";
import { created, ok } from "../../shared/api-response";
import { requireParam } from "../../shared/params";
import * as stockTransfersService from "./stock-transfers.service";
import { createTransferSchema } from "./stock-transfers.validators";

export async function list(req: Request, res: Response) {
  ok(res, await stockTransfersService.list(req.auth!.tenantId, req.query));
}

export async function getOne(req: Request, res: Response) {
  ok(res, await stockTransfersService.findOne(req.auth!.tenantId, requireParam(req, "id")));
}

export async function create(req: Request, res: Response) {
  const input = createTransferSchema.parse(req.body);
  created(res, await stockTransfersService.create(req.auth!.tenantId, req.auth!.userId, input));
}

export async function approve(req: Request, res: Response) {
  ok(
    res,
    await stockTransfersService.approve(
      req.auth!.tenantId,
      req.auth!.userId,
      requireParam(req, "id"),
    ),
  );
}

export async function cancel(req: Request, res: Response) {
  ok(
    res,
    await stockTransfersService.cancel(
      req.auth!.tenantId,
      req.auth!.userId,
      requireParam(req, "id"),
    ),
  );
}

export async function dispatch(req: Request, res: Response) {
  ok(
    res,
    await stockTransfersService.dispatch(
      req.auth!.tenantId,
      req.auth!.userId,
      requireParam(req, "id"),
    ),
  );
}

export async function receive(req: Request, res: Response) {
  ok(
    res,
    await stockTransfersService.receive(
      req.auth!.tenantId,
      req.auth!.userId,
      requireParam(req, "id"),
    ),
  );
}
