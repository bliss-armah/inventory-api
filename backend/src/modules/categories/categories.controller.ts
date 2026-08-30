import type { Request, Response } from "express";
import { created, ok } from "../../shared/api-response";
import { logActivity } from "../../lib/activity-logger";
import { requireParam } from "../../shared/params";
import * as categoriesService from "./categories.service";
import { createCategorySchema, updateCategorySchema } from "./categories.validators";

export async function list(req: Request, res: Response) {
  ok(res, await categoriesService.list(req.auth!.tenantId, req.query));
}

export async function create(req: Request, res: Response) {
  const input = createCategorySchema.parse(req.body);
  const category = await categoriesService.create(req.auth!.tenantId, input);
  await logActivity({
    tenantId: req.auth!.tenantId,
    userId: req.auth!.userId,
    action: "CATEGORY_CREATED",
    description: `Category "${category.name}" created`,
  });
  created(res, category);
}

export async function update(req: Request, res: Response) {
  const input = updateCategorySchema.parse(req.body);
  const category = await categoriesService.update(
    req.auth!.tenantId,
    requireParam(req, "id"),
    input,
  );
  await logActivity({
    tenantId: req.auth!.tenantId,
    userId: req.auth!.userId,
    action: "CATEGORY_UPDATED",
    description: `Category "${category.name}" updated`,
  });
  ok(res, category);
}
