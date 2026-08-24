import { prisma } from "../../lib/prisma";
import { generateEan13 } from "../../lib/barcode";
import { ConflictError, NotFoundError } from "../../shared/errors";
import { paginate, paginationQuerySchema, toSkipTake } from "../../shared/pagination";
import { isUniqueViolation, withUniqueConstraints } from "../../shared/prisma-errors";
import { assertOwned } from "../../shared/ownership";
import * as productsRepository from "./products.repository";
import {
  productFilterSchema,
  type CreateProductInput,
  type UpdateProductInput,
} from "./products.validators";

const PRODUCT_CONFLICTS = [
  {
    match: "barcode",
    field: "barcode",
    message: "A product with this barcode already exists",
  },
  { match: "sku", field: "sku", message: "A product with this SKU already exists" },
] as const satisfies [
  { field: string; message: string; match?: string },
  ...{ field: string; message: string; match?: string }[],
];

const BARCODE_ATTEMPTS = 5;

export function list(tenantId: string, rawQuery: unknown) {
  const filter = productFilterSchema.parse(rawQuery);
  return paginate(rawQuery, (skip, take, search) =>
    productsRepository.list(tenantId, skip, take, search, filter),
  );
}

async function allocateBarcode(tenantId: string): Promise<string> {
  for (let attempt = 0; attempt < BARCODE_ATTEMPTS; attempt += 1) {
    const barcode = generateEan13();
    const taken = await productsRepository.findByBarcodeInTenant(tenantId, barcode);
    if (!taken) {
      return barcode;
    }
  }
  throw new ConflictError("Could not allocate a unique barcode. Please try again.");
}

export async function create(tenantId: string, input: CreateProductInput) {
  await assertOwned(tenantId, {
    categoryIds: input.categoryId ? [input.categoryId] : undefined,
    brandIds: input.brandId ? [input.brandId] : undefined,
  });
  const barcode = input.barcode ?? (await allocateBarcode(tenantId));
  return withUniqueConstraints(
    () => productsRepository.create(tenantId, { ...input, barcode }),
    PRODUCT_CONFLICTS,
  );
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

  return withUniqueConstraints(
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
    PRODUCT_CONFLICTS,
  );
}

export async function generateBarcode(tenantId: string, id: string) {
  const existing = await productsRepository.findByIdInTenant(tenantId, id);
  if (!existing) {
    throw new NotFoundError("Product not found");
  }
  if (existing.barcode) {
    throw new ConflictError("This product already has a barcode", {
      barcode: ["This product already has a barcode"],
    });
  }

  for (let attempt = 0; attempt < BARCODE_ATTEMPTS; attempt += 1) {
    const barcode = await allocateBarcode(tenantId);
    try {
      return await productsRepository.setBarcode(tenantId, id, barcode);
    } catch (error) {
      if (isUniqueViolation(error)) continue;
      throw error;
    }
  }

  throw new ConflictError("Could not allocate a unique barcode. Please try again.");
}

export async function generateMissingBarcodes(tenantId: string) {
  const pending = await productsRepository.listMissingBarcode(tenantId);
  let generated = 0;

  for (const product of pending) {
    for (let attempt = 0; attempt < BARCODE_ATTEMPTS; attempt += 1) {
      const barcode = await allocateBarcode(tenantId);
      try {
        await productsRepository.setBarcode(tenantId, product.id, barcode);
        generated += 1;
        break;
      } catch (error) {
        if (isUniqueViolation(error)) continue;
        throw error;
      }
    }
  }

  return { generated, skipped: pending.length - generated };
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
