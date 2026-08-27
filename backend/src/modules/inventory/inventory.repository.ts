import { randomUUID } from "node:crypto";
import { Prisma } from "../../generated/prisma";
import { prisma } from "../../lib/prisma.ts";
import type { PrismaTransactionClient } from "../../lib/transaction.ts";

export function list(
  tenantId: string,
  skip: number,
  take: number,
  filter: { locationId?: string; productId?: string },
) {
  const where = {
    tenantId,
    ...(filter.locationId && { locationId: filter.locationId }),
    ...(filter.productId && { productId: filter.productId }),
  };

  return Promise.all([
    prisma.inventory.findMany({
      where,
      skip,
      take,
      orderBy: [{ locationId: "asc" }, { productId: "asc" }],
      include: { product: true, location: true },
    }),
    prisma.inventory.count({ where }),
  ]);
}

/**
 * Ensures an inventory row exists for this product/location, then locks it
 * with SELECT ... FOR UPDATE inside the caller's transaction so concurrent
 * stock movements against the same row serialize instead of racing.
 */
export async function lockForUpdate(
  tx: PrismaTransactionClient,
  tenantId: string,
  productId: string,
  locationId: string,
) {
  // A raw INSERT ... ON CONFLICT DO NOTHING instead of Prisma's upsert():
  // upsert reads then writes non-atomically, so two transactions racing to
  // create the same (productId, locationId) row for the first time can both
  // see "doesn't exist yet" and then have the loser's INSERT raise a raw
  // unique-constraint violation instead of silently becoming a no-op. The
  // ON CONFLICT clause pushes that race down into a single atomic statement
  // Postgres itself serializes.
  await tx.$executeRaw`
    INSERT INTO "inventory" (id, "tenantId", "productId", "locationId", quantity, "reservedQuantity", "updatedAt")
    VALUES (${randomUUID()}, ${tenantId}, ${productId}, ${locationId}, 0, 0, now())
    ON CONFLICT ("productId", "locationId") DO NOTHING
  `;

  // The tenantId filter here is defense in depth, not the primary guard —
  // callers must validate productId/locationId ownership (see shared/ownership.ts)
  // before ever reaching this point. If that's ever skipped, this still stops
  // the row from resolving to another tenant's inventory instead of locking it.
  const rows = await tx.$queryRaw<
    Array<{ id: string; quantity: number; reservedQuantity: number }>
  >(
    Prisma.sql`SELECT id, quantity, "reservedQuantity" FROM "inventory"
      WHERE "productId" = ${productId} AND "locationId" = ${locationId} AND "tenantId" = ${tenantId}
      FOR UPDATE`,
  );

  const row = rows[0];
  if (!row) {
    throw new Error(
      `Inventory row not found for tenant ${tenantId} (product ${productId}, location ${locationId})`,
    );
  }
  return row;
}

export function setQuantity(
  tx: PrismaTransactionClient,
  id: string,
  quantity: number,
) {
  return tx.inventory.update({ where: { id }, data: { quantity } });
}

export function adjustReservedQuantity(
  tx: PrismaTransactionClient,
  id: string,
  delta: number,
) {
  return tx.inventory.update({
    where: { id },
    data: { reservedQuantity: { increment: delta } },
  });
}
