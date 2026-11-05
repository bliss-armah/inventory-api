import { z } from "zod";
import { OrderStatus } from "../../generated/prisma";

export const createOrderSchema = z.object({
  id: z.uuid(),
  locationId: z.string().trim().min(1).optional(),
  customerId: z.string().trim().min(1).optional(),
  customerName: z.string().trim().min(1).max(120).optional(),
  note: z.string().trim().min(1).max(500).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().trim().min(1),
        quantity: z.coerce.number().int().positive().max(1_000_000),
      }),
    )
    .min(1)
    .max(200),
});

export const ordersListQuerySchema = z.object({
  status: z.enum(OrderStatus).optional(),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
