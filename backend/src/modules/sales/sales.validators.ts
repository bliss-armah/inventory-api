import { z } from "zod";
import { PaymentMethod } from "../../generated/prisma";

const money = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, "Must be an amount like 12 or 12.50");

export const createSaleSchema = z.object({
  id: z.uuid(),
  saleNumber: z.string().trim().min(3).max(32),
  shiftId: z.string().trim().min(1),
  customerId: z.string().trim().min(1).optional(),
  soldAt: z.coerce.date(),
  paymentMethod: z.enum(PaymentMethod),
  amountTendered: money,
  discountAmount: money.default("0"),
  discountReason: z.string().trim().max(200).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().trim().min(1),
        quantity: z.coerce.number().int().positive(),
        unitPrice: money,
        discountAmount: money.default("0"),
      }),
    )
    .min(1)
    .max(200),
});

export const catalogQuerySchema = z.object({
  locationId: z.string().trim().min(1),
});

export const salesListQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type CreateSaleInput = z.infer<typeof createSaleSchema>;
