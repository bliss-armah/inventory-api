import { prisma } from "../../lib/prisma";
import { generateEan13 } from "../../lib/barcode";
import { ConflictError, NotFoundError } from "../../shared/errors";
import { paginate, paginationQuerySchema, toSkipTake } from "../../shared/pagination";
import { isUniqueViolation, withUniqueConstraints } from "../../shared/prisma-errors";
import { assertOwned } from "../../shared/ownership";
import * as productsRepository from "./products.repository";
import { buildExportCsv, parseProductCsv, type RowError } from "./products.csv.ts";
import {
  productFilterSchema,
  type BulkUpdateProductsInput,
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

export async function exportCsv(tenantId: string): Promise<string> {
  return buildExportCsv(await productsRepository.listAllForExport(tenantId));
}

export type ImportSummary = {
  created: number;
  updated: number;
  failed: number;
  errors: RowError[];
};

export async function importCsv(
  tenantId: string,
  userId: string,
  text: string,
): Promise<ImportSummary> {
  const { rows, errors } = parseProductCsv(text);
  const summary: ImportSummary = {
    created: 0,
    updated: 0,
    failed: errors.length,
    errors: [...errors],
  };

  if (rows.length === 0) return summary;

  const [categories, brands] = await Promise.all([
    productsRepository.listCategoriesForTenant(tenantId),
    productsRepository.listBrandsForTenant(tenantId),
  ]);
  const categoryByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
  const brandByName = new Map(brands.map((b) => [b.name.toLowerCase(), b.id]));

  for (const row of rows) {
    const categoryId = row.category
      ? categoryByName.get(row.category.toLowerCase())
      : undefined;
    if (row.category && !categoryId) {
      summary.failed += 1;
      summary.errors.push({
        line: row.line,
        message: `category "${row.category}" does not exist — create it first`,
      });
      continue;
    }

    const brandId = row.brand ? brandByName.get(row.brand.toLowerCase()) : undefined;
    if (row.brand && !brandId) {
      summary.failed += 1;
      summary.errors.push({
        line: row.line,
        message: `brand "${row.brand}" does not exist — create it first`,
      });
      continue;
    }

    const fields = {
      sku: row.sku,
      barcode: row.barcode,
      name: row.name,
      description: row.description,
      categoryId,
      brandId,
      unit: row.unit,
      costPrice: row.costPrice,
      sellingPrice: row.sellingPrice,
      minimumStock: row.minimumStock,
    };

    try {
      const existing = await productsRepository.findBySkuInTenant(tenantId, row.sku);
      if (existing) {
        await update(tenantId, userId, existing.id, {
          ...fields,
          ...(row.status ? { status: row.status } : {}),
        });
        summary.updated += 1;
      } else {
        await create(tenantId, fields);
        summary.created += 1;
      }
    } catch (error) {
      summary.failed += 1;
      summary.errors.push({
        line: row.line,
        message: error instanceof Error ? error.message : "Could not save this row",
      });
    }
  }

  return summary;
}

function applyPriceChange(
  current: number,
  change: NonNullable<BulkUpdateProductsInput["priceChange"]>,
): number {
  if (change.mode === "set") return change.value;
  const factor =
    change.mode === "increaseByPercent" ? 1 + change.value / 100 : 1 - change.value / 100;
  return Math.max(0, Math.round(current * factor * 100) / 100);
}

export async function bulkUpdate(
  tenantId: string,
  userId: string,
  input: BulkUpdateProductsInput,
) {
  await assertOwned(tenantId, {
    categoryIds: input.categoryId ? [input.categoryId] : undefined,
    brandIds: input.brandId ? [input.brandId] : undefined,
  });

  const owned = await Promise.all(
    input.productIds.map((id) => productsRepository.findByIdInTenant(tenantId, id)),
  );
  const products = owned.filter((product) => product !== null);
  if (products.length !== input.productIds.length) {
    throw new NotFoundError("One or more products do not belong to this business");
  }

  const fields = {
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
    ...(input.brandId !== undefined ? { brandId: input.brandId } : {}),
  };

  if (Object.keys(fields).length > 0) {
    await productsRepository.updateManyFields(tenantId, input.productIds, fields);
  }

  if (input.priceChange) {
    const change = input.priceChange;
    for (const product of products) {
      const current = Number(product[change.field]);
      const next = applyPriceChange(current, change);
      if (next === current) continue;
      await update(tenantId, userId, product.id, { [change.field]: next });
    }
  }

  return { updated: products.length };
}
