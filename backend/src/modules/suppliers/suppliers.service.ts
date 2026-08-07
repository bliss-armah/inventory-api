import { NotFoundError } from "../../shared/errors";
import { paginate } from "../../shared/pagination";
import { withUniqueConstraint } from "../../shared/prisma-errors";
import * as suppliersRepository from "./suppliers.repository";
import type { CreateSupplierInput, UpdateSupplierInput } from "./suppliers.validators";

export function list(tenantId: string, rawQuery: unknown) {
  return paginate(rawQuery, (skip, take, search) =>
    suppliersRepository.list(tenantId, skip, take, search),
  );
}

export function create(tenantId: string, input: CreateSupplierInput) {
  return withUniqueConstraint(() => suppliersRepository.create(tenantId, input), {
    field: "name",
    message: "A supplier with this name already exists",
  });
}

export async function update(tenantId: string, id: string, input: UpdateSupplierInput) {
  const existing = await suppliersRepository.findByIdInTenant(tenantId, id);
  if (!existing) {
    throw new NotFoundError("Supplier not found");
  }
  return withUniqueConstraint(() => suppliersRepository.update(tenantId, id, input), {
    field: "name",
    message: "A supplier with this name already exists",
  });
}
