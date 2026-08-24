import { prisma } from "../../lib/prisma.ts";
import type { Prisma } from "../../generated/prisma/client.ts";
import type { PrismaTransactionClient } from "../../lib/transaction.ts";
import type {
  CreateProductInput,
  ProductFilter,
  UpdateProductInput,
} from "./products.validators.ts";

export function list(
  tenantId: string,
  skip: number,
  take: number,
  search: string | undefined,
  filter: ProductFilter,
) {
  const where = {
    tenantId,
    ...(filter.categoryId && { categoryId: filter.categoryId }),
    ...(filter.brandId && { brandId: filter.brandId }),
    ...(filter.status && { status: filter.status }),
    ...(search && {
      OR: [
        { sku: { contains: search, mode: "insensitive" as const } },
        { name: { contains: search, mode: "insensitive" as const } },
        { barcode: { contains: search, mode: "insensitive" as const } },
      ],
    }),
  };

  return Promise.all([
    prisma.product.findMany({
      where,
      skip,
      take,
      orderBy: { name: "asc" },
      include: { category: true, brand: true },
    }),
    prisma.product.count({ where }),
  ]);
}

export function findByIdInTenant(tenantId: string, id: string) {
  return prisma.product.findFirst({
    where: { id, tenantId },
    include: { category: true, brand: true },
  });
}

export function findByBarcodeInTenant(tenantId: string, barcode: string) {
  return prisma.product.findFirst({ where: { tenantId, barcode } });
}

export function listMissingBarcode(tenantId: string) {
  return prisma.product.findMany({
    where: { tenantId, barcode: null },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
}

export function setBarcode(tenantId: string, id: string, barcode: string) {
  return prisma.product.update({
    where: { id, tenantId },
    data: { barcode },
    include: { category: true, brand: true },
  });
}

export function create(tenantId: string, input: CreateProductInput) {
  return prisma.product.create({ data: { tenantId, ...input } });
}

export function updateTx(
  tx: PrismaTransactionClient,
  tenantId: string,
  id: string,
  input: UpdateProductInput,
) {
  return tx.product.update({ where: { id, tenantId }, data: input });
}

export function recordPriceHistoryTx(
  tx: PrismaTransactionClient,
  input: {
    tenantId: string;
    productId: string;
    changedById: string;
    costPrice: Prisma.Decimal;
    sellingPrice: Prisma.Decimal;
  },
) {
  return tx.productPriceHistory.create({
    data: {
      tenantId: input.tenantId,
      productId: input.productId,
      changedById: input.changedById,
      costPrice: input.costPrice,
      sellingPrice: input.sellingPrice,
    },
  });
}

export function listPriceHistory(
  tenantId: string,
  productId: string,
  skip: number,
  take: number,
) {
  const where = { tenantId, productId };
  return Promise.all([
    prisma.productPriceHistory.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: "desc" },
      include: { changedBy: { select: { id: true, name: true } } },
    }),
    prisma.productPriceHistory.count({ where }),
  ]);
}
