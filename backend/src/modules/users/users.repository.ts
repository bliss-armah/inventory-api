import { prisma } from "../../lib/prisma.ts";
import { Role } from "../../generated/prisma/enums.ts";
import type { CreateUserInput, UpdateUserInput } from "./users.validators.ts";

const selectFields = {
  id: true,
  tenantId: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export function list(
  tenantId: string,
  skip: number,
  take: number,
  search?: string,
) {
  const where = {
    tenantId,
    ...(search && {
      OR: [
        { name: { contains: search, mode: "insensitive" as const } },
        { email: { contains: search, mode: "insensitive" as const } },
      ],
    }),
  };

  return Promise.all([
    prisma.user.findMany({
      where,
      select: selectFields,
      skip,
      take,
      orderBy: { createdAt: "desc" },
    }),
    prisma.user.count({ where }),
  ]);
}

export function findByEmail(email: string) {
  return prisma.user.findUnique({ where: { email } });
}

export function findByIdInTenant(tenantId: string, id: string) {
  return prisma.user.findFirst({
    where: { id, tenantId },
    select: selectFields,
  });
}

export function countActiveOwners(tenantId: string, excludingUserId: string) {
  return prisma.user.count({
    where: {
      tenantId,
      role: Role.OWNER,
      isActive: true,
      id: { not: excludingUserId },
    },
  });
}

export function create(
  tenantId: string,
  input: CreateUserInput,
  passwordHash: string,
) {
  return prisma.user.create({
    data: {
      tenantId,
      name: input.name,
      email: input.email,
      phone: input.phone,
      role: input.role,
      passwordHash,
    },
    select: selectFields,
  });
}

export function update(tenantId: string, id: string, input: UpdateUserInput) {
  return prisma.user.update({
    where: { id, tenantId },
    data: input,
    select: selectFields,
  });
}
