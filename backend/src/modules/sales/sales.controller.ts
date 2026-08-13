import type { Request, Response } from "express";
import { created, ok } from "../../shared/api-response.ts";
import { requireParam } from "../../shared/params.ts";
import * as salesService from "./sales.service.ts";
import * as returnsService from "./returns.service.ts";
import { catalogQuerySchema, createSaleSchema } from "./sales.validators.ts";
import { createReturnSchema } from "./returns.validators.ts";

export async function create(req: Request, res: Response) {
  const input = createSaleSchema.parse(req.body);
  const { sale, alreadyExisted } = await salesService.create(
    req.auth!.tenantId,
    req.auth!.userId,
    req.auth!.role,
    input,
  );
  if (alreadyExisted) {
    ok(res, sale, "Sale already recorded");
    return;
  }
  created(res, sale);
}

export async function get(req: Request, res: Response) {
  ok(
    res,
    await salesService.get(
      req.auth!.tenantId,
      req.auth!.userId,
      req.auth!.role,
      requireParam(req, "id"),
    ),
  );
}

export async function list(req: Request, res: Response) {
  ok(res, await salesService.list(req.auth!.tenantId, req.auth!.userId, req.auth!.role, req.query));
}

export async function catalog(req: Request, res: Response) {
  const { locationId } = catalogQuerySchema.parse(req.query);
  ok(res, await salesService.catalog(req.auth!.tenantId, locationId));
}

export async function createReturn(req: Request, res: Response) {
  const input = createReturnSchema.parse(req.body);
  created(
    res,
    await returnsService.create(req.auth!.tenantId, req.auth!.userId, requireParam(req, "id"), input),
  );
}
