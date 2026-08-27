import { prisma } from "../../lib/prisma.ts";
import type { PrismaTransactionClient } from "../../lib/transaction.ts";
import type { MovementType } from "../../generated/prisma";

export type CreateMovementRecord = {
  tenantId: string;
  productId: string;
  locationId: string;
  userId: string;
  type: MovementType;
  quantity: number;
  beforeQuantity: number;
  afterQuantity: number;
  reference?: string;
  notes?: string;
};

export function create(
  tx: PrismaTransactionClient,
  data: CreateMovementRecord,
) {
  return tx.stockMovement.create({ data });
}

export type MovementFilter = {
  productId?: string;
  locationId?: string;
  type?: MovementType;
  from?: Date;
  to?: Date;
};

export function list(
  tenantId: string,
  skip: number,
  take: number,
  filter: MovementFilter,
) {
  const where = {
    tenantId,
    ...(filter.productId && { productId: filter.productId }),
    ...(filter.locationId && { locationId: filter.locationId }),
    ...(filter.type && { type: filter.type }),
    ...((filter.from || filter.to) && {
      createdAt: {
        ...(filter.from && { gte: filter.from }),
        ...(filter.to && { lte: filter.to }),
      },
    }),
  };

  return Promise.all([
    prisma.stockMovement.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: "desc" },
      include: {
        product: true,
        location: true,
        user: { select: { id: true, name: true } },
      },
    }),
    prisma.stockMovement.count({ where }),
  ]);
}

/**
 * The dashboard is readable by every authenticated role, including CASHIER,
 * so it gets an explicit select carrying only what the summary card renders —
 * never `costPrice` on the product.
 */
export function listRecent(tenantId: string, take: number) {
  return prisma.stockMovement.findMany({
    where: { tenantId },
    take,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      type: true,
      product: { select: { id: true, name: true } },
      location: { select: { id: true, name: true } },
    },
  });
}
