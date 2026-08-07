import { prisma } from "../lib/prisma";
import { BadRequestError } from "./errors";

type OwnershipCheck = {
  productIds?: string[];
  locationIds?: string[];
  supplierIds?: string[];
  categoryIds?: string[];
  brandIds?: string[];
};

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

/**
 * Foreign IDs arriving in a request body (productId, locationId, supplierId, ...)
 * must never be trusted as belonging to the caller's tenant just because they
 * parse as non-empty strings — a valid ID from another tenant would otherwise
 * let one business read or mutate another business's data. Call this before
 * any write that accepts such IDs from the client.
 */
export async function assertOwned(tenantId: string, check: OwnershipCheck): Promise<void> {
  await Promise.all([
    checkOwned("products", check.productIds, (ids) =>
      prisma.product.count({ where: { tenantId, id: { in: ids } } }),
    ),
    checkOwned("locations", check.locationIds, (ids) =>
      prisma.location.count({ where: { tenantId, id: { in: ids } } }),
    ),
    checkOwned("suppliers", check.supplierIds, (ids) =>
      prisma.supplier.count({ where: { tenantId, id: { in: ids } } }),
    ),
    checkOwned("categories", check.categoryIds, (ids) =>
      prisma.category.count({ where: { tenantId, id: { in: ids } } }),
    ),
    checkOwned("brands", check.brandIds, (ids) =>
      prisma.brand.count({ where: { tenantId, id: { in: ids } } }),
    ),
  ]);
}

async function checkOwned(
  label: string,
  ids: string[] | undefined,
  count: (ids: string[]) => Promise<number>,
): Promise<void> {
  if (!ids?.length) return;
  const deduped = unique(ids);
  const found = await count(deduped);
  if (found !== deduped.length) {
    throw new BadRequestError(`One or more ${label} do not belong to this business`);
  }
}
