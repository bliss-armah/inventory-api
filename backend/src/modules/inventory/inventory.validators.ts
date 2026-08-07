import { z } from "zod";

export const inventoryFilterSchema = z.object({
  locationId: z.string().trim().optional(),
  productId: z.string().trim().optional(),
});

export type InventoryFilter = z.infer<typeof inventoryFilterSchema>;
