import { z } from "zod";
import { InventoryMode } from "../../generated/prisma/enums.ts";

export const suspendTenantSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export type SuspendTenantInput = z.infer<typeof suspendTenantSchema>;

/**
 * Re-exported rather than redefined: which fields count as entitlements is
 * decided in one place, so the tenant-facing schema (which must reject them)
 * and this platform-facing one (which must accept them) can never drift.
 */
export { entitlementsSchema } from "../tenants/tenants.validators.ts";
export type { EntitlementsInput } from "../tenants/tenants.validators.ts";

/**
 * Onboarding a business: its profile, its owner, and what it is provisioned
 * for, in one call. Deliberately no password field — the owner sets their own
 * through the invite link, so no human ever handles a password on their behalf.
 */
export const createTenantSchema = z.object({
  businessName: z.string().trim().min(2).max(120),
  ownerName: z.string().trim().min(2).max(120),
  email: z.email().toLowerCase(),
  phone: z.string().trim().min(7).max(20),
  country: z.string().trim().min(2).max(60),
  timeZone: z.string().trim().min(1).max(60),
  inventoryMode: z.enum(InventoryMode).optional(),
  enablePos: z.boolean().optional(),
  enableBatchTracking: z.boolean().optional(),
  enableExpiryTracking: z.boolean().optional(),
});

export type PlatformCreateTenantInput = z.infer<typeof createTenantSchema>;
