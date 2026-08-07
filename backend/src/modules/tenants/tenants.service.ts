import { InventoryMode } from "../../generated/prisma/enums.ts";
import { BadRequestError } from "../../shared/errors.ts";
import { logActivity } from "../../lib/activity-logger.ts";
import * as tenantsRepository from "./tenants.repository.ts";
import * as locationsRepository from "../locations/locations.repository.ts";
import type {
  UpdateSettingsInput,
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

export async function updateSettings(
  tenantId: string,
  userId: string,
  input: UpdateSettingsInput,
) {
  if (input.inventoryMode === InventoryMode.SINGLE_LOCATION) {
    const locationCount = await locationsRepository.countForTenant(tenantId);
    if (locationCount > 1) {
      throw new BadRequestError(
        "Cannot switch to single-location mode while multiple locations exist. Remove the extra locations first.",
      );
    }
  }

  const settings = await tenantsRepository.updateSettings(tenantId, input);
  await logActivity({
    tenantId,
    userId,
    action: "SETTINGS_UPDATED",
    description: "Business settings were updated",
  });
  return settings;
}
