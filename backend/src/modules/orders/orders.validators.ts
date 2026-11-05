import { z } from "zod";
import { OrderStatus } from "../../generated/prisma";

const money = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, "Must be an amount like 12 or 12.50");

export const createOrderSchema = z.object({
  id: z.uuid(),
  orderNumber: z.string().trim().regex(/^ORD-\d{6}$/, "Order numbers look like ORD-123456").optional(),
  locationId: z.string().trim().min(1).optional(),
  customerId: z.string().trim().min(1).optional(),
  customerName: z.string().trim().min(1).max(120).optional(),
  note: z.string().trim().min(1).max(500).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().trim().min(1),
        quantity: z.coerce.number().int().positive().max(1_000_000),
        unitPrice: money.optional(),
      }),
    )
    .min(1)
    .max(200),
});

export const ordersListQuerySchema = z.object({
  status: z.enum(OrderStatus).optional(),
});

export const updatePickingSchema = z.object({
  items: z
    .array(
      z.object({
        itemId: z.string().trim().min(1),
        pickedQuantity: z.coerce.number().int().min(0).max(1_000_000),
      }),
    )
    .min(1)
    .max(200),
});

export type UpdatePickingInput = z.infer<typeof updatePickingSchema>;
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
