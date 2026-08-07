import { prisma } from "../../lib/prisma";
import type { CreateCategoryInput, UpdateCategoryInput } from "./categories.validators";

export function list(tenantId: string, skip: number, take: number, search?: string) {
  const where = {
    tenantId,
    ...(search && { name: { contains: search, mode: "insensitive" as const } }),
  };

  return Promise.all([
    prisma.category.findMany({ where, skip, take, orderBy: { name: "asc" } }),
    prisma.category.count({ where }),
  ]);
}

export function findByIdInTenant(tenantId: string, id: string) {
  return prisma.category.findFirst({ where: { id, tenantId } });
}

export function create(tenantId: string, input: CreateCategoryInput) {
  return prisma.category.create({ data: { tenantId, ...input } });
}

export function update(tenantId: string, id: string, input: UpdateCategoryInput) {
  return prisma.category.update({ where: { id, tenantId }, data: input });
}
