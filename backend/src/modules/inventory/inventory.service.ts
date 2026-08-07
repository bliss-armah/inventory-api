import type { PrismaTransactionClient } from "../../lib/transaction";
import { BadRequestError } from "../../shared/errors";
import { paginationQuerySchema, toSkipTake } from "../../shared/pagination";
import * as inventoryRepository from "./inventory.repository";
import { inventoryFilterSchema } from "./inventory.validators";

export async function list(tenantId: string, rawQuery: unknown) {
  const { page, pageSize } = paginationQuerySchema.parse(rawQuery);
  const filter = inventoryFilterSchema.parse(rawQuery);
  const { skip, take } = toSkipTake({ page, pageSize });

  const [rows, total] = await inventoryRepository.list(tenantId, skip, take, filter);

  const items = rows.map((row) => ({
    ...row,
    availableQuantity: row.quantity - row.reservedQuantity,
  }));

  return { items, page, pageSize, total };
}

export type ReservationInput = {
  tenantId: string;
  productId: string;
  locationId: string;
  quantity: number;
};

/**
 * Holds stock against a future commitment (currently: an approved but not
 * yet dispatched transfer) without moving it yet, so it can't also be sold,
 * adjusted away, or transferred elsewhere out from under that commitment.
 * Rejects if there isn't enough *available* (quantity - alreadyReserved)
 * stock to cover it.
 */
export async function reserveStock(tx: PrismaTransactionClient, input: ReservationInput) {
  const locked = await inventoryRepository.lockForUpdate(
    tx,
    input.tenantId,
    input.productId,
    input.locationId,
  );
  const available = locked.quantity - locked.reservedQuantity;
  if (input.quantity > available) {
    throw new BadRequestError(
      `Insufficient available stock: ${available} available (${locked.reservedQuantity} already reserved), cannot reserve ${input.quantity}`,
    );
  }
  await inventoryRepository.adjustReservedQuantity(tx, locked.id, input.quantity);
}

/**
 * Releases a hold placed by reserveStock — called both when the commitment
 * falls through (a transfer is canceled) and when it's fulfilled (a transfer
 * is dispatched, right before the real stock movement that actually reduces
 * quantity). Clamped so a release can never be double-applied into a
 * negative reservedQuantity.
 */
export async function releaseStock(tx: PrismaTransactionClient, input: ReservationInput) {
  const locked = await inventoryRepository.lockForUpdate(
    tx,
    input.tenantId,
    input.productId,
    input.locationId,
  );
  const delta = -Math.min(input.quantity, locked.reservedQuantity);
  if (delta === 0) return;
  await inventoryRepository.adjustReservedQuantity(tx, locked.id, delta);
}
