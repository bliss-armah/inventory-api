import { prisma } from "../../lib/prisma";
import type { CreateSupplierInput, UpdateSupplierInput } from "./suppliers.validators";

export function list(tenantId: string, skip: number, take: number, search?: string) {
  const where = {
    tenantId,
    ...(search && { name: { contains: search, mode: "insensitive" as const } }),
  };

  return Promise.all([
    prisma.supplier.findMany({ where, skip, take, orderBy: { name: "asc" } }),
    prisma.supplier.count({ where }),
  ]);
}

export function findByIdInTenant(tenantId: string, id: string) {
  return prisma.supplier.findFirst({ where: { id, tenantId } });
}

export function create(tenantId: string, input: CreateSupplierInput) {
  return prisma.supplier.create({ data: { tenantId, ...input } });
}

export function update(tenantId: string, id: string, input: UpdateSupplierInput) {
  return prisma.supplier.update({ where: { id, tenantId }, data: input });
}
