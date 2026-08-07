import { prisma } from "../../lib/prisma.ts";
import { BadRequestError, NotFoundError } from "../../shared/errors.ts";
import { paginate } from "../../shared/pagination.ts";
import { withUniqueConstraint } from "../../shared/prisma-errors.ts";
import { InventoryMode } from "../../generated/prisma/enums.ts";
import * as locationsRepository from "./locations.repository.ts";
import type {
  CreateLocationInput,
  UpdateLocationInput,
} from "./locations.validators.ts";

export function list(tenantId: string, rawQuery: unknown) {
  return paginate(rawQuery, (skip, take, search) =>
    locationsRepository.list(tenantId, skip, take, search),
  );
}

export async function create(tenantId: string, input: CreateLocationInput) {
  const settings = await prisma.businessSettings.findUniqueOrThrow({
    where: { tenantId },
  });

  if (settings.inventoryMode === InventoryMode.SINGLE_LOCATION) {
    const count = await locationsRepository.countForTenant(tenantId);
    if (count >= 1) {
      throw new BadRequestError(
        "This business is in single-location mode. Enable multiple locations in settings before adding another location.",
      );
    }
  }

  return withUniqueConstraint(
    () => locationsRepository.create(tenantId, input),
    {
      field: "name",
      message: "A location with this name already exists",
    },
  );
}

export async function update(
  tenantId: string,
  id: string,
  input: UpdateLocationInput,
) {
  const existing = await locationsRepository.findByIdInTenant(tenantId, id);
  if (!existing) {
    throw new NotFoundError("Location not found");
  }
  return locationsRepository.update(tenantId, id, input);
}
