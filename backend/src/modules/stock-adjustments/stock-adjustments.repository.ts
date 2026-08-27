import { prisma } from "../../lib/prisma";
import type { PrismaTransactionClient } from "../../lib/transaction";
import type { CreateAdjustmentInput } from "./stock-adjustments.validators";

export function create(
  tx: PrismaTransactionClient,
  tenantId: string,
  userId: string,
  input: CreateAdjustmentInput,
) {
  return tx.stockAdjustment.create({
    data: {
      ...(input.id ? { id: input.id } : {}),
      tenantId,
      userId,
      productId: input.productId,
      locationId: input.locationId,
      quantity: input.quantity,
      reason: input.reason,
      notes: input.notes,
    },
  });
}

export function findByIdInTenant(tenantId: string, id: string) {
  return prisma.stockAdjustment.findFirst({ where: { id, tenantId } });
}

export function list(tenantId: string, skip: number, take: number, locationId?: string) {
  const where = { tenantId, ...(locationId && { locationId }) };

  return Promise.all([
    prisma.stockAdjustment.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: "desc" },
      include: { product: true, location: true, user: { select: { id: true, name: true } } },
    }),
    prisma.stockAdjustment.count({ where }),
  ]);
}
