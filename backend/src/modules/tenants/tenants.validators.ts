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

/**
 * What a business owner may change about their own settings: the discount cap,
 * and nothing else. strictObject so an attempt to set an entitlement comes back
 * as a visible 400 rather than a silent no-op the UI would render as "saved".
 */
export const ownerUpdateSettingsSchema = z.strictObject({
  maxDiscountPercent: percent,
});

/**
 * Entitlements — what the business is provisioned for. Assigned by the platform
 * operator at onboarding and changed only through modules/platform-tenants;
 * deliberately not reachable from any tenant-facing route.
 */
export const entitlementsSchema = z.object({
  inventoryMode: z.enum(InventoryMode).optional(),
  enablePos: z.boolean().optional(),
  enableBatchTracking: z.boolean().optional(),
  enableExpiryTracking: z.boolean().optional(),
});

export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;
export type OwnerUpdateSettingsInput = z.infer<typeof ownerUpdateSettingsSchema>;
export type EntitlementsInput = z.infer<typeof entitlementsSchema>;
