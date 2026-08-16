import { z } from "zod";

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
