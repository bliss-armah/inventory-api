import { NotFoundError } from "../../shared/errors";
import { paginate } from "../../shared/pagination";
import { withUniqueConstraint } from "../../shared/prisma-errors";
import * as brandsRepository from "./brands.repository";
import type { CreateBrandInput, UpdateBrandInput } from "./brands.validators";

export function list(tenantId: string, rawQuery: unknown) {
  return paginate(rawQuery, (skip, take, search) =>
    brandsRepository.list(tenantId, skip, take, search),
  );
}

export function create(tenantId: string, input: CreateBrandInput) {
  return withUniqueConstraint(() => brandsRepository.create(tenantId, input), {
    field: "name",
    message: "A brand with this name already exists",
  });
}

export async function update(tenantId: string, id: string, input: UpdateBrandInput) {
  const existing = await brandsRepository.findByIdInTenant(tenantId, id);
  if (!existing) {
    throw new NotFoundError("Brand not found");
  }
  return withUniqueConstraint(() => brandsRepository.update(tenantId, id, input), {
    field: "name",
    message: "A brand with this name already exists",
  });
}
