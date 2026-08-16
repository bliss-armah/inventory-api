import { Prisma } from "../../generated/prisma/client.ts";
import { ProductStatus } from "../../generated/prisma/enums.ts";
import { prisma } from "../../lib/prisma.ts";
import type { PrismaTransactionClient } from "../../lib/transaction.ts";

export function findById(tenantId: string, id: string) {
  return prisma.sale.findFirst({
    where: { tenantId, id },
    include: {
      items: { include: { product: { select: { id: true, name: true, sku: true, unit: true } } } },
      customer: { select: { id: true, name: true, phone: true } },
      cashier: { select: { id: true, name: true } },
      location: { select: { id: true, name: true } },
      returns: { include: { items: true } },
    },
  });
}

export function createSale(
  tx: PrismaTransactionClient,
  data: Prisma.SaleUncheckedCreateInput,
) {
  return tx.sale.create({ data });
}

export function createItems(
  tx: PrismaTransactionClient,
  items: Prisma.SaleItemUncheckedCreateInput[],
) {
  return tx.saleItem.createMany({ data: items });
}

export function list(
  tenantId: string,
  skip: number,
  take: number,
  filters: { cashierId?: string; shiftId?: string; from?: Date; to?: Date },
) {
  const where = {
    tenantId,
    ...(filters.cashierId && { cashierId: filters.cashierId }),
    ...(filters.shiftId && { shiftId: filters.shiftId }),
    ...((filters.from || filters.to) && {
      soldAt: {
        ...(filters.from && { gte: filters.from }),
        ...(filters.to && { lte: filters.to }),
      },
    }),
  };

  return Promise.all([
    prisma.sale.findMany({
      where,
      skip,
      take,
      orderBy: { soldAt: "desc" },
      include: {
        customer: { select: { id: true, name: true } },
        cashier: { select: { id: true, name: true } },
        items: { select: { id: true, quantity: true } },
      },
    }),
    prisma.sale.count({ where }),
  ]);
}

export async function catalog(tenantId: string, locationId: string) {
  const products = await prisma.product.findMany({
    where: { tenantId, status: ProductStatus.ACTIVE },
    select: {
      id: true,
      sku: true,
      barcode: true,
      name: true,
      unit: true,
      sellingPrice: true,
      inventory: {
        where: { locationId },
        select: { quantity: true, reservedQuantity: true },
      },
    },
    orderBy: { name: "asc" },
  });

  return products.map((product) => ({
    id: product.id,
    sku: product.sku,
    barcode: product.barcode,
    name: product.name,
    unit: product.unit,
    sellingPrice: product.sellingPrice,
    availableQuantity:
      (product.inventory[0]?.quantity ?? 0) - (product.inventory[0]?.reservedQuantity ?? 0),
  }));
}
