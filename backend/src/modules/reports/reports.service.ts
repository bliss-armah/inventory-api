import { z } from "zod";
import { paginationQuerySchema, toSkipTake } from "../../shared/pagination";
import * as reportsRepository from "./reports.repository";

const locationFilterSchema = z.object({ locationId: z.string().trim().optional() });
const velocityFilterSchema = z.object({
  locationId: z.string().trim().optional(),
  days: z.coerce.number().int().positive().max(365).default(30),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export async function currentStock(tenantId: string, rawQuery: unknown) {
  const { locationId } = locationFilterSchema.parse(rawQuery);
  const { page, pageSize } = paginationQuerySchema.parse(rawQuery);
  const { skip, take } = toSkipTake({ page, pageSize });
  const [items, total] = await reportsRepository.currentStock(tenantId, skip, take, locationId);
  return { items, page, pageSize, total };
}

export async function lowStock(tenantId: string, rawQuery: unknown) {
  const { locationId } = locationFilterSchema.parse(rawQuery);
  const { page, pageSize } = paginationQuerySchema.parse(rawQuery);
  const { skip, take } = toSkipTake({ page, pageSize });
  const [items, total] = await reportsRepository.lowStock(tenantId, skip, take, locationId);
  return { items, page, pageSize, total };
}

export async function outOfStock(tenantId: string, rawQuery: unknown) {
  const { locationId } = locationFilterSchema.parse(rawQuery);
  const { page, pageSize } = paginationQuerySchema.parse(rawQuery);
  const { skip, take } = toSkipTake({ page, pageSize });
  const [items, total] = await reportsRepository.outOfStock(tenantId, skip, take, locationId);
  return { items, page, pageSize, total };
}

export async function inventoryValuation(tenantId: string, rawQuery: unknown) {
  const { locationId } = locationFilterSchema.parse(rawQuery);
  const rows = await reportsRepository.inventoryValuation(tenantId, locationId);
  const totalValue = rows.reduce((sum, row) => sum + Number(row.value), 0);
  return { rows, totalValue };
}

export function purchaseHistory(tenantId: string, rawQuery: unknown) {
  const { page, pageSize } = paginationQuerySchema.parse(rawQuery);
  const { skip, take } = toSkipTake({ page, pageSize });
  return reportsRepository
    .purchaseHistory(tenantId, skip, take)
    .then(([items, total]) => ({ items, page, pageSize, total }));
}

async function moveVelocityReport(
  tenantId: string,
  rawQuery: unknown,
  direction: "fast" | "slow",
) {
  const { locationId, days, limit } = velocityFilterSchema.parse(rawQuery);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const velocity = await reportsRepository.movementVelocity(tenantId, since, locationId);
  const sorted = [...velocity].sort((a, b) => {
    const aSum = a._sum.quantity ?? 0;
    const bSum = b._sum.quantity ?? 0;
    // Outbound quantity is stored negative, so "fast" is most negative first,
    // "slow" is closest to zero first.
    return direction === "fast" ? aSum - bSum : bSum - aSum;
  });

  const top = sorted.slice(0, limit);
  const products = await reportsRepository.findProductsByIds(
    tenantId,
    top.map((row) => row.productId),
  );
  const productById = new Map(products.map((product) => [product.id, product]));

  return top
    .map((row) => ({
      product: productById.get(row.productId),
      quantityMoved: Math.abs(row._sum.quantity ?? 0),
    }))
    .filter((row) => row.product);
}

export function fastMoving(tenantId: string, rawQuery: unknown) {
  return moveVelocityReport(tenantId, rawQuery, "fast");
}

export function slowMoving(tenantId: string, rawQuery: unknown) {
  return moveVelocityReport(tenantId, rawQuery, "slow");
}

export async function deadStock(tenantId: string, rawQuery: unknown) {
  const { locationId, days } = velocityFilterSchema.parse(rawQuery);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return reportsRepository.productsWithNoMovementSince(tenantId, since, locationId);
}

const salesWindowSchema = z.object({
  days: z.coerce.number().int().positive().max(365).default(30),
});

function windowStart(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export function salesSummary(tenantId: string, rawQuery: unknown) {
  const { days } = salesWindowSchema.parse(rawQuery);
  return reportsRepository.salesSummary(tenantId, windowStart(days));
}

export function discounts(tenantId: string, rawQuery: unknown) {
  const { days } = salesWindowSchema.parse(rawQuery);
  const { page, pageSize } = paginationQuerySchema.parse(rawQuery);
  const { skip, take } = toSkipTake({ page, pageSize });
  return reportsRepository
    .discountReport(tenantId, windowStart(days), skip, take)
    .then(([items, total]) => ({ items, page, pageSize, total }));
}
