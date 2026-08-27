import { z } from "zod";
import { PaymentMethod, ReturnDisposition } from "../../generated/prisma";

export const createReturnSchema = z.object({
  shiftId: z.string().trim().min(1),
  reason: z.string().trim().max(500).optional(),
  refundMethod: z.enum(PaymentMethod),
  items: z
    .array(
      z.object({
        saleItemId: z.string().trim().min(1),
        quantity: z.coerce.number().int().positive(),
        disposition: z.enum(ReturnDisposition),
      }),
    )
    .min(1),
});

export type CreateReturnInput = z.infer<typeof createReturnSchema>;
