import { prisma } from "../../lib/prisma";
import type { UpdateSettingsInput, UpdateTenantInput } from "./tenants.validators";

export function getTenantById(tenantId: string) {
  return prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
}

export function updateTenant(tenantId: string, input: UpdateTenantInput) {
  return prisma.tenant.update({ where: { id: tenantId }, data: input });
}

export function getSettings(tenantId: string) {
  return prisma.businessSettings.findUniqueOrThrow({ where: { tenantId } });
}

export function updateSettings(tenantId: string, input: UpdateSettingsInput) {
  return prisma.businessSettings.update({ where: { tenantId }, data: input });
}
