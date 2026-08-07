import { prisma } from "../../lib/prisma";
import type { CreateLocationInput, UpdateLocationInput } from "./locations.validators";

export function list(tenantId: string, skip: number, take: number, search?: string) {
  const where = {
    tenantId,
    ...(search && { name: { contains: search, mode: "insensitive" as const } }),
  };

  return Promise.all([
    prisma.location.findMany({ where, skip, take, orderBy: { createdAt: "asc" } }),
    prisma.location.count({ where }),
  ]);
}

export function findByIdInTenant(tenantId: string, id: string) {
  return prisma.location.findFirst({ where: { id, tenantId } });
}

export function countForTenant(tenantId: string) {
  return prisma.location.count({ where: { tenantId } });
}

export function create(tenantId: string, input: CreateLocationInput) {
  return prisma.location.create({ data: { tenantId, ...input } });
}

export function update(tenantId: string, id: string, input: UpdateLocationInput) {
  return prisma.location.update({ where: { id, tenantId }, data: input });
}
