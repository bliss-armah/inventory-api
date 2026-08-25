import { z } from "zod";
import { ProductStatus } from "../../generated/prisma/enums.ts";

export const createProductSchema = z.object({
  sku: z.string().trim().min(1).max(60),
  barcode: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().trim().max(60).optional(),
  ),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).optional(),
  categoryId: z.string().trim().optional(),
  brandId: z.string().trim().optional(),
  unit: z.string().trim().min(1).max(30),
  costPrice: z.coerce.number().nonnegative(),
  sellingPrice: z.coerce.number().nonnegative(),
  minimumStock: z.coerce.number().int().nonnegative().default(0),
  imageUrl: z.url().optional(),
});

export const updateProductSchema = createProductSchema.partial().extend({
  status: z.enum(ProductStatus).optional(),
});

export const productFilterSchema = z.object({
  categoryId: z.string().trim().optional(),
  brandId: z.string().trim().optional(),
  status: z.enum(ProductStatus).optional(),
});

export const bulkUpdateProductsSchema = z
  .object({
    productIds: z.array(z.string().trim().min(1)).min(1).max(500),
    status: z.enum(ProductStatus).optional(),
    categoryId: z.string().trim().min(1).nullish(),
    brandId: z.string().trim().min(1).nullish(),
    priceChange: z
      .object({
        field: z.enum(["costPrice", "sellingPrice"]),
        mode: z.enum(["set", "increaseByPercent", "decreaseByPercent"]),
        value: z.coerce.number().nonnegative(),
      })
      .optional(),
  })
  .refine(
    (value) =>
      value.status !== undefined ||
      value.categoryId !== undefined ||
      value.brandId !== undefined ||
      value.priceChange !== undefined,
    { message: "Provide at least one change to apply" },
  );

export type BulkUpdateProductsInput = z.infer<typeof bulkUpdateProductsSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ProductFilter = z.infer<typeof productFilterSchema>;
