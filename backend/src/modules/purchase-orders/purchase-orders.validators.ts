import { z } from "zod";
import { PurchaseOrderStatus } from "../../generated/prisma/enums.ts";

const orderItemSchema = z.object({
  productId: z.string().trim().min(1),
  quantityOrdered: z.coerce.number().int().positive(),
  costPrice: z.coerce.number().nonnegative(),
});

export const createPurchaseOrderSchema = z.object({
  supplierId: z.string().trim().min(1),
  locationId: z.string().trim().min(1),
  notes: z.string().trim().max(500).optional(),
  items: z.array(orderItemSchema).min(1),
});

const receiveItemSchema = z.object({
  productId: z.string().trim().min(1),
  quantity: z.coerce.number().int().positive(),
  costPrice: z.coerce.number().nonnegative(),
  batchNumber: z.string().trim().max(60).optional(),
  expiryDate: z.coerce.date().optional(),
});

export const receiveGoodsSchema = z.object({
  notes: z.string().trim().max(500).optional(),
  items: z.array(receiveItemSchema).min(1),
});

export const purchaseOrderFilterSchema = z.object({
  status: z.enum(PurchaseOrderStatus).optional(),
});

export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderSchema>;
export type ReceiveGoodsInput = z.infer<typeof receiveGoodsSchema>;
export type PurchaseOrderFilter = z.infer<typeof purchaseOrderFilterSchema>;
