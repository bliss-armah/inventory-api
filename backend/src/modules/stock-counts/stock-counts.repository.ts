import { prisma } from "../../lib/prisma.ts";
import { Prisma } from "../../generated/prisma/client.ts";
import type { PrismaTransactionClient } from "../../lib/transaction.ts";
import { StockCountStatus } from "../../generated/prisma/enums.ts";

const include = {
  location: true,
  startedBy: { select: { id: true, name: true } },
  items: { include: { product: true } },
} as const;

export async function create(
  tenantId: string,
  userId: string,
  locationId: string,
  notes?: string,
) {
  const currentInventory = await prisma.inventory.findMany({
    where: { tenantId, locationId },
  });

  return prisma.stockCount.create({
    data: {
      tenantId,
      locationId,
      startedById: userId,
      notes,
      items: {
        create: currentInventory.map((row) => ({
          productId: row.productId,
          systemQuantity: row.quantity,
          physicalQuantity: row.quantity,
          difference: 0,
        })),
      },
    },
    include,
  });
}

export function list(
  tenantId: string,
  skip: number,
  take: number,
  locationId?: string,
) {
  const where = { tenantId, ...(locationId && { locationId }) };
  return Promise.all([
    prisma.stockCount.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: "desc" },
      include,
    }),
    prisma.stockCount.count({ where }),
  ]);
}

export function findByIdInTenant(tenantId: string, id: string) {
  return prisma.stockCount.findFirst({ where: { id, tenantId }, include });
}

export function updateItemPhysicalQuantityTx(
  tx: PrismaTransactionClient,
  itemId: string,
  physicalQuantity: number,
  difference: number,
) {
  return tx.stockCountItem.update({
    where: { id: itemId },
    data: { physicalQuantity, difference },
  });
}

export function updateStatusTx(
  tx: PrismaTransactionClient,
  tenantId: string,
  id: string,
  status: StockCountStatus,
) {
  return tx.stockCount.update({
    where: { id, tenantId },
    data: {
      status,
      ...(status === StockCountStatus.COMPLETED && { completedAt: new Date() }),
    },
  });
}

/**
 * Row-locks the count for the duration of the transaction so concurrent
 * item updates or a double `complete` call on the same count serialize.
 */
export async function lockForUpdateTx(
  tx: PrismaTransactionClient,
  tenantId: string,
  id: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT id FROM "stock_counts" WHERE id = ${id} AND "tenantId" = ${tenantId} FOR UPDATE`,
  );
  return rows.length > 0;
}
