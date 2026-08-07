import { z } from "zod";

export const stockCountFilterSchema = z.object({
  locationId: z.string().trim().optional(),
});

export const createStockCountSchema = z.object({
  locationId: z.string().trim().min(1),
  notes: z.string().trim().max(500).optional(),
});

export const updateCountItemsSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().trim().min(1),
        physicalQuantity: z.coerce.number().int().nonnegative(),
      }),
    )
    .min(1),
});

export type CreateStockCountInput = z.infer<typeof createStockCountSchema>;
export type UpdateCountItemsInput = z.infer<typeof updateCountItemsSchema>;
export type StockCountFilter = z.infer<typeof stockCountFilterSchema>;
