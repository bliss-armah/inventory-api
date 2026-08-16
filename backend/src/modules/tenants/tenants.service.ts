import { InventoryMode } from "../../generated/prisma/enums.ts";
import { BadRequestError } from "../../shared/errors.ts";
import { logActivity } from "../../lib/activity-logger.ts";
import * as tenantsRepository from "./tenants.repository.ts";
import * as locationsRepository from "../locations/locations.repository.ts";
import type {
  OwnerUpdateSettingsInput,
  UpdateTenantInput,
} from "./tenants.validators.ts";

export function getCurrentTenant(tenantId: string) {
  return tenantsRepository.getTenantById(tenantId);
}

export async function updateCurrentTenant(
  tenantId: string,
  userId: string,
  input: UpdateTenantInput,
) {
  const tenant = await tenantsRepository.updateTenant(tenantId, input);
  await logActivity({
    tenantId,
    userId,
    action: "TENANT_UPDATED",
    description: "Business profile was updated",
  });
  return tenant;
}

export function getSettings(tenantId: string) {
  return tenantsRepository.getSettings(tenantId);
}

/**
 * Single-location mode is a lie if the tenant still has several locations —
 * stock would be stranded at one the app no longer shows. Exported because
 * inventoryMode is an entitlement now, set by a platform admin, and that path
 * needs exactly the same guard.
 */
export async function assertInventoryModeChangeAllowed(
  tenantId: string,
  mode: InventoryMode | undefined,
): Promise<void> {
  if (mode !== InventoryMode.SINGLE_LOCATION) return;

  const locationCount = await locationsRepository.countForTenant(tenantId);
  if (locationCount > 1) {
    throw new BadRequestError(
      "Cannot switch to single-location mode while multiple locations exist. Remove the extra locations first.",
    );
  }
}

export async function updateSettings(
  tenantId: string,
  userId: string,
  input: OwnerUpdateSettingsInput,
) {
  const settings = await tenantsRepository.updateSettings(tenantId, input);
  await logActivity({
    tenantId,
    userId,
    action: "SETTINGS_UPDATED",
    description: "Business settings were updated",
  });
  return settings;
}
