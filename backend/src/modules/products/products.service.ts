import { prisma } from "../../lib/prisma";
import { NotFoundError } from "../../shared/errors";
import { paginate, paginationQuerySchema, toSkipTake } from "../../shared/pagination";
import { withUniqueConstraint } from "../../shared/prisma-errors";
import { assertOwned } from "../../shared/ownership";
import * as productsRepository from "./products.repository";
import {
  productFilterSchema,
  type CreateProductInput,
  type UpdateProductInput,
} from "./products.validators";

export function list(tenantId: string, rawQuery: unknown) {
  const filter = productFilterSchema.parse(rawQuery);
  return paginate(rawQuery, (skip, take, search) =>
    productsRepository.list(tenantId, skip, take, search, filter),
  );
}

export async function create(tenantId: string, input: CreateProductInput) {
  await assertOwned(tenantId, {
    categoryIds: input.categoryId ? [input.categoryId] : undefined,
    brandIds: input.brandId ? [input.brandId] : undefined,
  });
  return withUniqueConstraint(() => productsRepository.create(tenantId, input), {
    field: "sku",
    message: "A product with this SKU already exists",
  });
}

export async function update(
  tenantId: string,
  userId: string,
  id: string,
  input: UpdateProductInput,
) {
  const existing = await productsRepository.findByIdInTenant(tenantId, id);
  if (!existing) {
    throw new NotFoundError("Product not found");
  }
  await assertOwned(tenantId, {
    categoryIds: input.categoryId ? [input.categoryId] : undefined,
    brandIds: input.brandId ? [input.brandId] : undefined,
  });

  const priceChanged =
    (input.costPrice !== undefined && input.costPrice !== Number(existing.costPrice)) ||
    (input.sellingPrice !== undefined && input.sellingPrice !== Number(existing.sellingPrice));

  return withUniqueConstraint(
    () =>
      prisma.$transaction(async (tx) => {
        // Snapshot what the price *was* before overwriting it — both fields
        // together even if only one changed, so each row reads as a
        // complete price state rather than a partial diff.
        if (priceChanged) {
          await productsRepository.recordPriceHistoryTx(tx, {
            tenantId,
            productId: id,
            changedById: userId,
            costPrice: existing.costPrice,
            sellingPrice: existing.sellingPrice,
          });
        }
        return productsRepository.updateTx(tx, tenantId, id, input);
      }),
    { field: "sku", message: "A product with this SKU already exists" },
  );
}

export async function findOne(tenantId: string, id: string) {
  const product = await productsRepository.findByIdInTenant(tenantId, id);
  if (!product) {
    throw new NotFoundError("Product not found");
  }
  return product;
}

export async function getPriceHistory(tenantId: string, productId: string, rawQuery: unknown) {
  const product = await productsRepository.findByIdInTenant(tenantId, productId);
  if (!product) {
    throw new NotFoundError("Product not found");
  }

  const { page, pageSize } = paginationQuerySchema.parse(rawQuery);
  const { skip, take } = toSkipTake({ page, pageSize });
  const [items, total] = await productsRepository.listPriceHistory(tenantId, productId, skip, take);
  return { items, page, pageSize, total };
}
