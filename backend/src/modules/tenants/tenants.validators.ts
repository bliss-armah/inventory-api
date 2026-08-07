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

export const updateSettingsSchema = z.object({
  inventoryMode: z.enum(InventoryMode).optional(),
  enablePos: z.boolean().optional(),
  enableBatchTracking: z.boolean().optional(),
  enableExpiryTracking: z.boolean().optional(),
});

export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
