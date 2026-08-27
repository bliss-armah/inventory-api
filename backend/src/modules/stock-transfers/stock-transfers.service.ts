import { MovementType, TransferStatus } from "../../generated/prisma";
import { prisma } from "../../lib/prisma.ts";
import { logActivity } from "../../lib/activity-logger.ts";
import { BadRequestError, NotFoundError } from "../../shared/errors.ts";
import { paginate } from "../../shared/pagination.ts";
import { assertOwned } from "../../shared/ownership.ts";
import { recordMovement } from "../stock-movements/stock-movements.service.ts";
import { reserveStock, releaseStock } from "../inventory/inventory.service.ts";
import * as stockTransfersRepository from "./stock-transfers.repository.ts";
import {
  transferFilterSchema,
  type CreateTransferInput,
} from "./stock-transfers.validators.ts";

export function list(tenantId: string, rawQuery: unknown) {
  const { status } = transferFilterSchema.parse(rawQuery);
  return paginate(rawQuery, (skip, take) =>
    stockTransfersRepository.list(tenantId, skip, take, status),
  );
}

export async function findOne(tenantId: string, id: string) {
  const transfer = await stockTransfersRepository.findByIdInTenant(
    tenantId,
    id,
  );
  if (!transfer) {
    throw new NotFoundError("Stock transfer not found");
  }
  return transfer;
}

export async function create(
  tenantId: string,
  userId: string,
  input: CreateTransferInput,
) {
  await assertOwned(tenantId, {
    locationIds: [input.fromLocationId, input.toLocationId],
    productIds: input.items.map((item) => item.productId),
  });
  return stockTransfersRepository.create(tenantId, userId, input);
}

/**
 * Approving is the point a transfer stops being a mere request and starts
 * committing real stock: each line item's quantity is reserved at the
 * source location (see inventory.service.ts#reserveStock) so it can't also
 * be sold, adjusted away, or claimed by another transfer before this one
 * dispatches. Reservation happens in the same transaction as the status
 * flip, so a failed reservation (not enough available stock) rolls back
 * the approval too, rather than leaving it approved-but-unfulfillable.
 */
export async function approve(tenantId: string, userId: string, id: string) {
  const transfer = await findOne(tenantId, id);

  await prisma.$transaction(async (tx) => {
    const transitioned = await stockTransfersRepository.transitionStatusTx(
      tx,
      tenantId,
      id,
      [TransferStatus.PENDING],
      TransferStatus.APPROVED,
      { approvedById: userId, approvedAt: new Date() },
    );
    if (!transitioned) {
      throw new BadRequestError("Only pending transfers can be approved");
    }

    for (const item of transfer.items) {
      await reserveStock(tx, {
        tenantId,
        productId: item.productId,
        locationId: transfer.fromLocationId,
        quantity: item.quantity,
      });
    }
  });

  return findOne(tenantId, id);
}

/**
 * Cancellation always attempts to release the reservation regardless of
 * whether this transfer was PENDING (never reserved anything) or APPROVED
 * (did) — relying on releaseStock's clamping to make the PENDING case a
 * harmless no-op. Deciding from a status read before this transaction would
 * be a race: another request could approve the transfer (and reserve stock)
 * in the gap between that read and this transition, leaving a reservation
 * this cancel would otherwise never clean up.
 */
export async function cancel(tenantId: string, id: string) {
  const transfer = await findOne(tenantId, id);

  await prisma.$transaction(async (tx) => {
    const transitioned = await stockTransfersRepository.transitionStatusTx(
      tx,
      tenantId,
      id,
      [TransferStatus.PENDING, TransferStatus.APPROVED],
      TransferStatus.CANCELED,
    );
    if (!transitioned) {
      throw new BadRequestError(
        "Only pending or approved transfers can be canceled",
      );
    }

    for (const item of transfer.items) {
      await releaseStock(tx, {
        tenantId,
        productId: item.productId,
        locationId: transfer.fromLocationId,
        quantity: item.quantity,
      });
    }
  });

  return findOne(tenantId, id);
}

/** Goods physically leave the source location: decrements stock there. */
export async function dispatch(tenantId: string, userId: string, id: string) {
  const transfer = await findOne(tenantId, id);

  await prisma.$transaction(async (tx) => {
    const transitioned = await stockTransfersRepository.transitionStatusTx(
      tx,
      tenantId,
      id,
      [TransferStatus.APPROVED],
      TransferStatus.TRANSFERRED,
      { transferredAt: new Date() },
    );
    if (!transitioned) {
      throw new BadRequestError("Only approved transfers can be dispatched");
    }

    for (const item of transfer.items) {
      // Release the hold before recording the real movement: recordMovement
      // now refuses to take quantity below reservedQuantity, and this same
      // item's own reservation would otherwise count against itself.
      await releaseStock(tx, {
        tenantId,
        productId: item.productId,
        locationId: transfer.fromLocationId,
        quantity: item.quantity,
      });
      await recordMovement(tx, {
        tenantId,
        productId: item.productId,
        locationId: transfer.fromLocationId,
        userId,
        type: MovementType.TRANSFER_OUT,
        quantity: item.quantity,
        reference: transfer.id,
        notes: `Transfer to ${transfer.toLocation.name}`,
      });
    }

    await logActivity(
      {
        tenantId,
        userId,
        action: "STOCK_TRANSFER_DISPATCHED",
        description: `Transfer from ${transfer.fromLocation.name} to ${transfer.toLocation.name} dispatched`,
      },
      tx,
    );
  });

  return findOne(tenantId, id);
}

/** Goods arrive at the destination location: increments stock there. */
export async function receive(tenantId: string, userId: string, id: string) {
  const transfer = await findOne(tenantId, id);

  await prisma.$transaction(async (tx) => {
    const transitioned = await stockTransfersRepository.transitionStatusTx(
      tx,
      tenantId,
      id,
      [TransferStatus.TRANSFERRED],
      TransferStatus.RECEIVED,
      { receivedAt: new Date() },
    );
    if (!transitioned) {
      throw new BadRequestError("Only dispatched transfers can be received");
    }

    for (const item of transfer.items) {
      await recordMovement(tx, {
        tenantId,
        productId: item.productId,
        locationId: transfer.toLocationId,
        userId,
        type: MovementType.TRANSFER_IN,
        quantity: item.quantity,
        reference: transfer.id,
        notes: `Transfer from ${transfer.fromLocation.name}`,
      });
    }

    await logActivity(
      {
        tenantId,
        userId,
        action: "STOCK_TRANSFER_RECEIVED",
        description: `Transfer from ${transfer.fromLocation.name} to ${transfer.toLocation.name} received`,
      },
      tx,
    );
  });

  return findOne(tenantId, id);
}
