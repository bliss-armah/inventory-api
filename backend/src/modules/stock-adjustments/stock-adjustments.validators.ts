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

export type CreateAdjustmentInput = z.infer<typeof createAdjustmentSchema>;
