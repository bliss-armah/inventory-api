import { NotFoundError } from "../../shared/errors";
import { paginate } from "../../shared/pagination";
import { withUniqueConstraint } from "../../shared/prisma-errors";
import * as categoriesRepository from "./categories.repository";
import type { CreateCategoryInput, UpdateCategoryInput } from "./categories.validators";

export function list(tenantId: string, rawQuery: unknown) {
  return paginate(rawQuery, (skip, take, search) =>
    categoriesRepository.list(tenantId, skip, take, search),
  );
}

export function create(tenantId: string, input: CreateCategoryInput) {
  return withUniqueConstraint(() => categoriesRepository.create(tenantId, input), {
    field: "name",
    message: "A category with this name already exists",
  });
}

export async function update(tenantId: string, id: string, input: UpdateCategoryInput) {
  const existing = await categoriesRepository.findByIdInTenant(tenantId, id);
  if (!existing) {
    throw new NotFoundError("Category not found");
  }
  return withUniqueConstraint(() => categoriesRepository.update(tenantId, id, input), {
    field: "name",
    message: "A category with this name already exists",
  });
}
