import { prisma } from "../../lib/prisma";
import type { OwnerUpdateSettingsInput, UpdateTenantInput } from "./tenants.validators";

export function getTenantById(tenantId: string) {
  return prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
}

export function updateTenant(tenantId: string, input: UpdateTenantInput) {
  return prisma.tenant.update({ where: { id: tenantId }, data: input });
}

/**
 * Carries `businessName` alongside the settings themselves. The till prints it
 * on every receipt but cannot read `/tenants/me` (PERMISSIONS.tenants.view is
 * owner-only, and the tenant record holds subscription and entitlement fields a
 * cashier has no business seeing), so the name rides along on the one part of
 * the record the till is already trusted with. Flattened rather than nested so
 * callers don't have to know it came from a join.
 */
export async function getSettings(tenantId: string) {
  const { tenant, ...settings } = await prisma.businessSettings.findUniqueOrThrow({
    where: { tenantId },
    include: { tenant: { select: { businessName: true } } },
  });
  return { ...settings, businessName: tenant.businessName };
}

// Owner-facing only: the discount cap. Entitlement writes go through
// platform-tenants.repository, which is the only place allowed to set them.
export function updateSettings(tenantId: string, input: OwnerUpdateSettingsInput) {
  return prisma.businessSettings.update({ where: { tenantId }, data: input });
}
