import { Prisma } from "../../generated/prisma/client.ts";
import { Role, ShiftStatus } from "../../generated/prisma/enums.ts";
import { logActivity } from "../../lib/activity-logger.ts";
import { prisma } from "../../lib/prisma.ts";
import type { PrismaTransactionClient } from "../../lib/transaction.ts";
import { BadRequestError, NotFoundError } from "../../shared/errors.ts";
import { assertOwned } from "../../shared/ownership.ts";
import { paginate } from "../../shared/pagination.ts";
import { withUniqueConstraint } from "../../shared/prisma-errors.ts";
import { roleAllowed, PERMISSIONS } from "../../shared/permissions.ts";
import * as shiftsRepository from "./shifts.repository.ts";
import type { CloseShiftInput, OpenShiftInput } from "./shifts.validators.ts";

/**
 * Which location a shift belongs to, without making the caller know. A single
 * active location needs no decision at all, and a default one is an explicit
 * statement of where the till normally sits — only a genuine ambiguity (several
 * active locations, none marked default) is worth asking an owner about.
 */
async function resolveLocationId(
  tenantId: string,
  requested: string | undefined,
): Promise<string> {
  if (requested) {
    await assertOwned(tenantId, { locationIds: [requested] });
    return requested;
  }

  const locations = await shiftsRepository.findActiveLocations(tenantId);
  if (locations.length === 0) {
    throw new BadRequestError(
      "This business has no active location to open a shift against",
    );
  }
  if (locations.length === 1) {
    return locations[0]!.id;
  }

  const preferred = locations.find((location) => location.isDefault);
  if (!preferred) {
    throw new BadRequestError("Pick a location to open this shift against", {
      locationId: ["Pick a location to open this shift against"],
    });
  }
  return preferred.id;
}

export async function open(
  tenantId: string,
  cashierId: string,
  input: OpenShiftInput,
) {
  const locationId = await resolveLocationId(tenantId, input.locationId);

  const shift = await withUniqueConstraint(
    () =>
      shiftsRepository.open(
        tenantId,
        cashierId,
        locationId,
        new Prisma.Decimal(input.openingFloat),
      ),
    { field: "shift", message: "You already have an open shift" },
  );

  await logActivity({
    tenantId,
    userId: cashierId,
    action: "SHIFT_OPENED",
    description: `Shift opened with float ${input.openingFloat}`,
  });
  return shift;
}

export function getCurrent(tenantId: string, cashierId: string) {
  return shiftsRepository.findOpenForCashier(tenantId, cashierId);
}

export async function assertOpenShift(tenantId: string, userId: string, shiftId: string) {
  const shift = await shiftsRepository.findById(tenantId, shiftId);
  if (!shift) {
    throw new NotFoundError("Shift not found");
  }
  if (shift.status !== ShiftStatus.OPEN) {
    throw new BadRequestError("That shift is already closed");
  }
  if (shift.cashierId !== userId) {
    throw new BadRequestError("That shift belongs to another user");
  }
  return shift;
}

/**
 * Locks the shift row (FOR UPDATE, tenant-scoped) inside an already-open
 * transaction and re-checks it is still OPEN. Used both by close()/
 * forceClose() themselves and by sale/return creation, so a shift close and
 * a concurrent cash sale serialize on the same row instead of racing —
 * whichever transaction locks first, the other sees the up-to-date status
 * once it proceeds.
 */
export async function assertShiftStillOpen(
  tx: PrismaTransactionClient,
  tenantId: string,
  shiftId: string,
) {
  const locked = await shiftsRepository.lockShiftForUpdate(tx, tenantId, shiftId);
  if (!locked) {
    throw new NotFoundError("Shift not found");
  }
  if (locked.status !== ShiftStatus.OPEN) {
    throw new BadRequestError("That shift is already closed");
  }
  return { ...locked, openingFloat: new Prisma.Decimal(locked.openingFloat) };
}

async function closeShift(
  tenantId: string,
  shiftId: string,
  countedCash: Prisma.Decimal,
  notes: string | undefined,
) {
  return prisma.$transaction(async (tx) => {
    const shift = await assertShiftStillOpen(tx, tenantId, shiftId);
    const { cashSales, cashRefunds } = await shiftsRepository.sumCashMovement(
      tx,
      tenantId,
      shiftId,
    );

    const expectedCash = shift.openingFloat.plus(cashSales).minus(cashRefunds);
    const variance = countedCash.minus(expectedCash);

    const updated = await shiftsRepository.close(tx, tenantId, shiftId, {
      countedCash,
      expectedCash,
      variance,
      notes,
    });

    return { shift: updated, expectedCash, variance };
  });
}

export async function close(
  tenantId: string,
  userId: string,
  shiftId: string,
  input: CloseShiftInput,
) {
  await assertOpenShift(tenantId, userId, shiftId);
  const countedCash = new Prisma.Decimal(input.countedCash);
  const { shift, expectedCash, variance } = await closeShift(
    tenantId,
    shiftId,
    countedCash,
    input.notes,
  );

  await logActivity({
    tenantId,
    userId,
    action: "SHIFT_CLOSED",
    description: `Shift closed. Expected ${expectedCash}, counted ${countedCash}, variance ${variance}`,
  });

  return shift;
}

export async function forceClose(
  tenantId: string,
  actingUserId: string,
  actingRole: Role,
  shiftId: string,
  input: CloseShiftInput,
) {
  if (!roleAllowed(PERMISSIONS.shifts.forceClose, actingRole)) {
    throw new BadRequestError("Only an owner can force-close another user's shift");
  }

  const countedCash = new Prisma.Decimal(input.countedCash);
  const { shift } = await closeShift(tenantId, shiftId, countedCash, input.notes);

  await logActivity({
    tenantId,
    userId: actingUserId,
    action: "SHIFT_FORCE_CLOSED",
    description: `Shift ${shiftId} force-closed by owner`,
  });

  return shift;
}

export function list(tenantId: string, actingUserId: string, actingRole: Role, rawQuery: unknown) {
  const cashierId = roleAllowed(PERMISSIONS.shifts.viewAll, actingRole) ? undefined : actingUserId;
  return paginate(rawQuery, (skip, take) =>
    shiftsRepository.list(tenantId, skip, take, cashierId),
  );
}
