import { z } from "zod";
import { TransferStatus } from "../../generated/prisma";

export const transferFilterSchema = z.object({
  status: z.enum(TransferStatus).optional(),
});

export const createTransferSchema = z
  .object({
    fromLocationId: z.string().trim().min(1),
    toLocationId: z.string().trim().min(1),
    notes: z.string().trim().max(500).optional(),
    items: z
      .array(
        z.object({
          productId: z.string().trim().min(1),
          quantity: z.coerce.number().int().positive(),
        }),
      )
      .min(1),
  })
  .refine((data) => data.fromLocationId !== data.toLocationId, {
    message: "Source and destination locations must be different",
    path: ["toLocationId"],
  });

export type CreateTransferInput = z.infer<typeof createTransferSchema>;
export type TransferFilter = z.infer<typeof transferFilterSchema>;
