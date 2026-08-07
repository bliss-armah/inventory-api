import { prisma } from "../../lib/prisma";
import type { CreateBrandInput, UpdateBrandInput } from "./brands.validators";

export function list(tenantId: string, skip: number, take: number, search?: string) {
  const where = {
    tenantId,
    ...(search && { name: { contains: search, mode: "insensitive" as const } }),
  };

  return Promise.all([
    prisma.brand.findMany({ where, skip, take, orderBy: { name: "asc" } }),
    prisma.brand.count({ where }),
  ]);
}

export function findByIdInTenant(tenantId: string, id: string) {
  return prisma.brand.findFirst({ where: { id, tenantId } });
}

export function create(tenantId: string, input: CreateBrandInput) {
  return prisma.brand.create({ data: { tenantId, ...input } });
}

export function update(tenantId: string, id: string, input: UpdateBrandInput) {
  return prisma.brand.update({ where: { id, tenantId }, data: input });
}
