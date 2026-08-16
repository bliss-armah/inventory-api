import { prisma } from "../../lib/prisma";
import type { OwnerUpdateSettingsInput, UpdateTenantInput } from "./tenants.validators";

export function getTenantById(tenantId: string) {
  return prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
}

export function updateTenant(tenantId: string, input: UpdateTenantInput) {
  return prisma.tenant.update({ where: { id: tenantId }, data: input });
}

export function getSettings(tenantId: string) {
  return prisma.businessSettings.findUniqueOrThrow({ where: { tenantId } });
}

// Owner-facing only: the discount cap. Entitlement writes go through
// platform-tenants.repository, which is the only place allowed to set them.
export function updateSettings(tenantId: string, input: OwnerUpdateSettingsInput) {
  return prisma.businessSettings.update({ where: { tenantId }, data: input });
}
