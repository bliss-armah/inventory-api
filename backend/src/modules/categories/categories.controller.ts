import type { Request, Response } from "express";
import { created, ok } from "../../shared/api-response";
import { requireParam } from "../../shared/params";
import * as categoriesService from "./categories.service";
import { createCategorySchema, updateCategorySchema } from "./categories.validators";

export async function list(req: Request, res: Response) {
  ok(res, await categoriesService.list(req.auth!.tenantId, req.query));
}

export async function create(req: Request, res: Response) {
  const input = createCategorySchema.parse(req.body);
  created(res, await categoriesService.create(req.auth!.tenantId, input));
}

export async function update(req: Request, res: Response) {
  const input = updateCategorySchema.parse(req.body);
  ok(res, await categoriesService.update(req.auth!.tenantId, requireParam(req, "id"), input));
}
