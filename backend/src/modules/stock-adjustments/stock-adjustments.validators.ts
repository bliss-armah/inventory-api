import { z } from "zod";
import { AdjustmentReason } from "../../generated/prisma";

export const createAdjustmentSchema = z.object({
  id: z.uuid().optional(),
  productId: z.string().trim().min(1),
  locationId: z.string().trim().min(1),
  quantity: z.coerce.number().int().refine((value) => value !== 0, {
    message: "Quantity must not be zero",
  }),
  reason: z.enum(AdjustmentReason),
  notes: z.string().trim().max(500).optional(),
});

export const bulkAdjustmentSchema = z.object({
  locationId: z.string().trim().min(1),
  mode: z.enum(["DELTA", "SET"]),
  reason: z.enum(AdjustmentReason),
  notes: z.string().trim().max(500).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().trim().min(1),
        quantity: z.coerce.number().int().min(-1_000_000).max(1_000_000),
      }),
    )
    .min(1)
    .max(200),
});

export type BulkAdjustmentInput = z.infer<typeof bulkAdjustmentSchema>;
export type CreateAdjustmentInput = z.infer<typeof createAdjustmentSchema>;
