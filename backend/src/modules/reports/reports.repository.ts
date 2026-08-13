import { prisma } from "../../lib/prisma.ts";
import { Prisma } from "../../generated/prisma/client.ts";
import { MovementType } from "../../generated/prisma/enums.ts";

const OUTBOUND_TYPES = [
  MovementType.SALE,
  MovementType.TRANSFER_OUT,
  MovementType.DAMAGE,
  MovementType.EXPIRED,
];

/**
 * Shared engine for the inventory-table reports (current/low/out-of-stock):
 * the filter predicate runs in SQL against the whole table, only the
 * matching page's IDs come back, and Prisma re-hydrates just that page with
 * its normal `include` shape. Filtering in JS after loading everything would
 * mean a multi-hundred-MB response for a tenant with a large catalog.
 */
async function paginatedInventoryQuery(
  tenantId: string,
  skip: number,
  take: number,
  locationId: string | undefined,
  predicate: Prisma.Sql,
) {
  const locationFilter = locationId
    ? Prisma.sql`AND i."locationId" = ${locationId}`
    : Prisma.empty;

  const [idRows, countRows] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT i.id FROM "inventory" i
      JOIN "products" p ON p.id = i."productId"
      WHERE i."tenantId" = ${tenantId} ${locationFilter} AND ${predicate}
      ORDER BY p.name ASC
      LIMIT ${take} OFFSET ${skip}
    `),
    prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS count FROM "inventory" i
      JOIN "products" p ON p.id = i."productId"
      WHERE i."tenantId" = ${tenantId} ${locationFilter} AND ${predicate}
    `),
  ]);

  const ids = idRows.map((row) => row.id);
  const rows = await prisma.inventory.findMany({
    where: { id: { in: ids } },
    include: { product: true, location: true },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered = ids
    .map((id) => byId.get(id))
    .filter((row) => row !== undefined);

  return [ordered, Number(countRows[0]?.count ?? 0)] as const;
}

export function currentStock(
  tenantId: string,
  skip: number,
  take: number,
  locationId?: string,
) {
  return paginatedInventoryQuery(
    tenantId,
    skip,
    take,
    locationId,
    Prisma.sql`TRUE`,
  );
}

export function lowStock(
  tenantId: string,
  skip: number,
  take: number,
  locationId?: string,
) {
  return paginatedInventoryQuery(
    tenantId,
    skip,
    take,
    locationId,
    Prisma.sql`(i.quantity > 0 AND i.quantity <= p."minimumStock")`,
  );
}

export function outOfStock(
  tenantId: string,
  skip: number,
  take: number,
  locationId?: string,
) {
  return paginatedInventoryQuery(
    tenantId,
    skip,
    take,
    locationId,
    Prisma.sql`i.quantity <= 0`,
  );
}

export function inventoryValuation(tenantId: string, locationId?: string) {
  return prisma.$queryRaw<
    Array<{
      productId: string;
      locationId: string;
      quantity: number;
      costPrice: string;
      value: string;
    }>
  >(
    Prisma.sql`
      SELECT i."productId", i."locationId", i.quantity, p."costPrice",
             (i.quantity * p."costPrice") AS value
      FROM "inventory" i
      JOIN "products" p ON p.id = i."productId"
      WHERE i."tenantId" = ${tenantId}
      ${locationId ? Prisma.sql`AND i."locationId" = ${locationId}` : Prisma.empty}
      ORDER BY value DESC
    `,
  );
}

export function purchaseHistory(tenantId: string, skip: number, take: number) {
  const where = { tenantId };
  return Promise.all([
    prisma.goodsReceipt.findMany({
      where,
      skip,
      take,
      orderBy: { receivedAt: "desc" },
      include: {
        purchaseOrder: { include: { supplier: true } },
        location: true,
        receivedBy: { select: { id: true, name: true } },
        items: { include: { product: true } },
      },
    }),
    prisma.goodsReceipt.count({ where }),
  ]);
}

export function movementVelocity(
  tenantId: string,
  since: Date,
  locationId?: string,
) {
  return prisma.stockMovement.groupBy({
    by: ["productId"],
    where: {
      tenantId,
      createdAt: { gte: since },
      type: { in: OUTBOUND_TYPES },
      ...(locationId && { locationId }),
    },
    _sum: { quantity: true },
  });
}

export function productsWithNoMovementSince(
  tenantId: string,
  since: Date,
  locationId?: string,
) {
  return prisma.inventory.findMany({
    where: {
      tenantId,
      quantity: { gt: 0 },
      ...(locationId && { locationId }),
      product: {
        stockMovements: {
          none: {
            createdAt: { gte: since },
            ...(locationId && { locationId }),
          },
        },
      },
    },
    include: { product: true, location: true },
  });
}

export function findProductsByIds(tenantId: string, ids: string[]) {
  return prisma.product.findMany({ where: { tenantId, id: { in: ids } } });
}

export async function salesSummary(tenantId: string, since: Date) {
  const [totals, itemTotalsRows] = await Promise.all([
    prisma.sale.aggregate({
      where: { tenantId, soldAt: { gte: since } },
      _sum: { total: true, discountAmount: true },
      _count: true,
    }),
    prisma.$queryRaw<Array<{ cost: string | null; itemDiscountTotal: string | null }>>(
      Prisma.sql`
        SELECT
          SUM(si.quantity * si."unitCost") AS "cost",
          SUM(si."discountAmount") AS "itemDiscountTotal"
        FROM "sale_items" si
        JOIN "sales" s ON s.id = si."saleId"
        WHERE si."tenantId" = ${tenantId} AND s."tenantId" = ${tenantId} AND s."soldAt" >= ${since}
      `,
    ),
  ]);

  const itemTotalsRow = itemTotalsRows[0];
  const cost = itemTotalsRow?.cost
    ? new Prisma.Decimal(itemTotalsRow.cost)
    : new Prisma.Decimal(0);
  const itemDiscountTotal = itemTotalsRow?.itemDiscountTotal
    ? new Prisma.Decimal(itemTotalsRow.itemDiscountTotal)
    : new Prisma.Decimal(0);

  const revenue = totals._sum.total ?? new Prisma.Decimal(0);
  const saleDiscountTotal = totals._sum.discountAmount ?? new Prisma.Decimal(0);

  return {
    saleCount: totals._count,
    revenue,
    discountTotal: saleDiscountTotal.plus(itemDiscountTotal),
    costOfGoodsSold: cost,
    grossMargin: revenue.minus(cost),
  };
}

export function discountReport(tenantId: string, since: Date, skip: number, take: number) {
  const where = {
    tenantId,
    soldAt: { gte: since },
    OR: [{ discountAmount: { gt: 0 } }, { items: { some: { discountAmount: { gt: 0 } } } }],
  };

  return Promise.all([
    prisma.sale.findMany({
      where,
      skip,
      take,
      orderBy: { soldAt: "desc" },
      select: {
        id: true,
        saleNumber: true,
        soldAt: true,
        subtotal: true,
        discountAmount: true,
        discountReason: true,
        total: true,
        cashier: { select: { id: true, name: true } },
        items: {
          where: { discountAmount: { gt: 0 } },
          select: {
            quantity: true,
            unitPrice: true,
            discountAmount: true,
            product: { select: { id: true, name: true, sku: true } },
          },
        },
      },
    }),
    prisma.sale.count({ where }),
  ]);
}
