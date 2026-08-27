import { MovementType } from "../../generated/prisma";
import type { PrismaTransactionClient } from "../../lib/transaction.ts";
import { prisma } from "../../lib/prisma.ts";
import { BadRequestError } from "../../shared/errors.ts";
import { paginate } from "../../shared/pagination.ts";
import * as inventoryRepository from "../inventory/inventory.repository.ts";
import * as stockMovementsRepository from "./stock-movements.repository.ts";
import { movementFilterSchema } from "./stock-movements.validators.ts";

const INBOUND_TYPES: MovementType[] = [
  MovementType.PURCHASE,
  MovementType.TRANSFER_IN,
  MovementType.RETURN,
];
const OUTBOUND_TYPES: MovementType[] = [
  MovementType.SALE,
  MovementType.TRANSFER_OUT,
  MovementType.DAMAGE,
  MovementType.EXPIRED,
];

/**
 * ADJUSTMENT is the one type where the caller supplies a signed delta
 * directly (a stock count can correct up or down). Every other type has a
 * fixed direction, so callers only ever pass a positive magnitude for them —
 * this is what stops a bug elsewhere from silently crediting stock through a
 * SALE movement.
 */
function resolveDelta(type: MovementType, quantity: number): number {
  if (type === MovementType.ADJUSTMENT) {
    if (quantity === 0) {
      throw new BadRequestError("Adjustment quantity cannot be zero");
    }
    return quantity;
  }

  if (quantity <= 0) {
    throw new BadRequestError("Quantity must be a positive number");
  }
  if (INBOUND_TYPES.includes(type)) return quantity;
  if (OUTBOUND_TYPES.includes(type)) return -quantity;

  throw new BadRequestError(`Unsupported movement type: ${type}`);
}

export type RecordMovementInput = {
  tenantId: string;
  productId: string;
  locationId: string;
  userId: string;
  type: MovementType;
  quantity: number;
  reference?: string;
  notes?: string;
};

/**
 * The single, atomic path by which stock quantities ever change. Locks the
 * inventory row, applies the signed delta, rejects anything that would take
 * stock negative, and writes the audit record — all inside the caller's
 * transaction so it composes with receiving, adjustments, and transfers.
 */
export async function recordMovement(
  tx: PrismaTransactionClient,
  input: RecordMovementInput,
) {
  const delta = resolveDelta(input.type, input.quantity);

  const locked = await inventoryRepository.lockForUpdate(
    tx,
    input.tenantId,
    input.productId,
    input.locationId,
  );

  const beforeQuantity = locked.quantity;
  const afterQuantity = beforeQuantity + delta;

  // Reserved stock (see inventory.service.ts#reserveStock) is committed to
  // something else already — this must never dip below it, which subsumes
  // the plain "never go negative" check for rows with no reservation.
  if (afterQuantity < locked.reservedQuantity) {
    throw new BadRequestError(
      `Insufficient stock: ${beforeQuantity} on hand${
        locked.reservedQuantity > 0
          ? ` (${locked.reservedQuantity} reserved)`
          : ""
      }, cannot apply change of ${delta}`,
    );
  }

  await inventoryRepository.setQuantity(tx, locked.id, afterQuantity);

  return stockMovementsRepository.create(tx, {
    tenantId: input.tenantId,
    productId: input.productId,
    locationId: input.locationId,
    userId: input.userId,
    type: input.type,
    quantity: delta,
    beforeQuantity,
    afterQuantity,
    reference: input.reference,
    notes: input.notes,
  });
}

/** Convenience wrapper for callers that only need to record one movement in isolation. */
export function recordMovementStandalone(input: RecordMovementInput) {
  return prisma.$transaction((tx) => recordMovement(tx, input));
}

export function list(tenantId: string, rawQuery: unknown) {
  const filter = movementFilterSchema.parse(rawQuery);
  return paginate(rawQuery, (skip, take) =>
    stockMovementsRepository.list(tenantId, skip, take, filter),
  );
}
