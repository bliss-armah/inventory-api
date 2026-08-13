import { prisma } from "../../lib/prisma.ts";
import type { CreateCustomerInput, UpdateCustomerInput } from "./customers.validators.ts";

export function create(tenantId: string, input: CreateCustomerInput) {
  return prisma.customer.create({ data: { tenantId, ...input } });
}

export function findById(tenantId: string, id: string) {
  return prisma.customer.findFirst({ where: { tenantId, id } });
}

export function update(tenantId: string, id: string, input: UpdateCustomerInput) {
  return prisma.customer.updateMany({ where: { tenantId, id }, data: input });
}

export function list(tenantId: string, skip: number, take: number, search?: string) {
  const where = {
    tenantId,
    ...(search && {
      OR: [
        { name: { contains: search, mode: "insensitive" as const } },
        { phone: { contains: search } },
      ],
    }),
  };

  return Promise.all([
    prisma.customer.findMany({ where, skip, take, orderBy: { name: "asc" } }),
    prisma.customer.count({ where }),
  ]);
}

export function listSales(
  tenantId: string,
  customerId: string,
  skip: number,
  take: number,
  filters: { cashierId?: string },
) {
  const where = {
    tenantId,
    customerId,
    ...(filters.cashierId && { cashierId: filters.cashierId }),
  };

  return Promise.all([
    prisma.sale.findMany({
      where,
      skip,
      take,
      orderBy: { soldAt: "desc" },
      include: { items: { include: { product: { select: { id: true, name: true, sku: true } } } } },
    }),
    prisma.sale.count({ where }),
  ]);
}
