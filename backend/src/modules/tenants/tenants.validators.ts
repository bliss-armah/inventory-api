import { z } from "zod";
import { InventoryMode } from "../../generated/prisma/enums.ts";

export const updateTenantSchema = z.object({
  businessName: z.string().trim().min(2).max(120).optional(),
  logoUrl: z.url().optional(),
  phone: z.string().trim().min(7).max(20).optional(),
  email: z.email().optional(),
  address: z.string().trim().max(240).optional(),
  country: z.string().trim().min(2).max(60).optional(),
  timeZone: z.string().trim().min(1).max(60).optional(),
});

const percent = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, "Must be a percentage like 10 or 12.50")
  .refine((value) => Number(value) <= 100, "Must be 100 or less");

export const updateSettingsSchema = z.object({
  inventoryMode: z.enum(InventoryMode).optional(),
  enablePos: z.boolean().optional(),
  enableBatchTracking: z.boolean().optional(),
  enableExpiryTracking: z.boolean().optional(),
  maxDiscountPercent: percent.optional(),
});

export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
