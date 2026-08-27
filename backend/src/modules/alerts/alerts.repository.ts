import { Prisma } from "../../generated/prisma";
import { prisma } from "../../lib/prisma.ts";

export type LowStockRow = {
  productId: string;
  sku: string;
  name: string;
  locationId: string;
  locationName: string;
  quantity: number;
  minimumStock: number;
};

export function findLowStock(tenantId: string): Promise<LowStockRow[]> {
  return prisma.$queryRaw<LowStockRow[]>`
    SELECT p.id            AS "productId",
           p.sku           AS "sku",
           p.name          AS "name",
           l.id            AS "locationId",
           l.name          AS "locationName",
           i.quantity      AS "quantity",
           p."minimumStock" AS "minimumStock"
    FROM inventory i
    JOIN products p ON p.id = i."productId"
    JOIN locations l ON l.id = i."locationId"
    WHERE i."tenantId" = ${tenantId}
      AND p.status = 'ACTIVE'
      AND p."minimumStock" > 0
      AND i.quantity <= p."minimumStock"
    ORDER BY p.name ASC
  `;
}

export function findRecentlyNotified(tenantId: string, since: Date) {
  return prisma.lowStockAlert.findMany({
    where: { tenantId, notifiedAt: { gte: since } },
    select: { productId: true, locationId: true },
  });
}

export function recordNotified(
  tenantId: string,
  entries: Array<{ productId: string; locationId: string }>,
) {
  const now = new Date();
  return prisma.$transaction(
    entries.map((entry) =>
      prisma.lowStockAlert.upsert({
        where: {
          tenantId_productId_locationId: {
            tenantId,
            productId: entry.productId,
            locationId: entry.locationId,
          },
        },
        create: {
          tenantId,
          productId: entry.productId,
          locationId: entry.locationId,
          notifiedAt: now,
        },
        update: { notifiedAt: now },
      }),
    ),
  );
}

export function clearRecovered(
  tenantId: string,
  stillLow: Array<{ productId: string; locationId: string }>,
) {
  if (stillLow.length === 0) {
    return prisma.lowStockAlert.deleteMany({ where: { tenantId } });
  }
  return prisma.lowStockAlert.deleteMany({
    where: {
      tenantId,
      NOT: {
        OR: stillLow.map((entry) => ({
          productId: entry.productId,
          locationId: entry.locationId,
        })),
      },
    },
  });
}

export function findTenantsWithAlertsEnabled() {
  return prisma.businessSettings.findMany({
    where: { lowStockAlertsEnabled: true },
    select: { tenantId: true },
  });
}

/**
 * Who to email about this business's low stock. Reached through memberships,
 * since a person can be an OWNER here and something else somewhere else — the
 * role that matters is the one held in *this* tenant.
 */
export async function findOwnerEmails(tenantId: string) {
  const memberships = await prisma.membership.findMany({
    where: { tenantId, role: "OWNER", isActive: true },
    select: { user: { select: { email: true, name: true } } },
  });
  return memberships.map((membership) => membership.user);
}

export function alertsEnabledFor(tenantId: string) {
  return prisma.businessSettings.findUnique({
    where: { tenantId },
    select: { lowStockAlertsEnabled: true },
  });
}

export { Prisma };
