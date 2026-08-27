import {
  AdjustmentReason,
  MovementType,
  StockCountStatus,
} from "../../generated/prisma";
import { prisma } from "../../lib/prisma.ts";
import { logActivity } from "../../lib/activity-logger.ts";
import { BadRequestError, NotFoundError } from "../../shared/errors.ts";
import { paginate } from "../../shared/pagination.ts";
import { assertOwned } from "../../shared/ownership.ts";
import { recordMovement } from "../stock-movements/stock-movements.service.ts";
import * as inventoryRepository from "../inventory/inventory.repository.ts";
import * as stockAdjustmentsRepository from "../stock-adjustments/stock-adjustments.repository.ts";
import * as stockCountsRepository from "./stock-counts.repository.ts";
import {
  stockCountFilterSchema,
  type CreateStockCountInput,
  type UpdateCountItemsInput,
} from "./stock-counts.validators.ts";

export function list(tenantId: string, rawQuery: unknown) {
  const { locationId } = stockCountFilterSchema.parse(rawQuery);
  return paginate(rawQuery, (skip, take) =>
    stockCountsRepository.list(tenantId, skip, take, locationId),
  );
}

export async function findOne(tenantId: string, id: string) {
  const count = await stockCountsRepository.findByIdInTenant(tenantId, id);
  if (!count) {
    throw new NotFoundError("Stock count not found");
  }
  return count;
}

export async function create(
  tenantId: string,
  userId: string,
  input: CreateStockCountInput,
) {
  await assertOwned(tenantId, { locationIds: [input.locationId] });
  return stockCountsRepository.create(
    tenantId,
    userId,
    input.locationId,
    input.notes,
  );
}

export async function updateItems(
  tenantId: string,
  id: string,
  input: UpdateCountItemsInput,
) {
  await prisma.$transaction(async (tx) => {
    const locked = await stockCountsRepository.lockForUpdateTx(
      tx,
      tenantId,
      id,
    );
    if (!locked) {
      throw new NotFoundError("Stock count not found");
    }

    const count = await tx.stockCount.findFirst({
      where: { id, tenantId },
      include: { items: true },
    });
    if (!count) {
      throw new NotFoundError("Stock count not found");
    }
    if (count.status === StockCountStatus.COMPLETED) {
      throw new BadRequestError("Cannot edit a completed stock count");
    }

    for (const entry of input.items) {
      const item = count.items.find((row) => row.productId === entry.productId);
      if (!item) {
        throw new BadRequestError(
          `Product ${entry.productId} is not part of this stock count`,
        );
      }
      await stockCountsRepository.updateItemPhysicalQuantityTx(
        tx,
        item.id,
        entry.physicalQuantity,
        entry.physicalQuantity - item.systemQuantity,
      );
    }

    if (count.status === StockCountStatus.DRAFT) {
      await stockCountsRepository.updateStatusTx(
        tx,
        tenantId,
        id,
        StockCountStatus.IN_PROGRESS,
      );
    }
  });

  return findOne(tenantId, id);
}

/**
 * Differences become stock adjustments once the count is finalized — the
 * count itself never touches inventory directly. The adjustment reconciles
 * to the physical quantity against whatever is in Inventory *right now*,
 * not the system quantity snapshotted when the count started: stock can
 * move (receiving, sales, other adjustments) while a count is in progress,
 * and reconciling against a stale snapshot would under- or over-correct.
 */
export async function complete(tenantId: string, userId: string, id: string) {
  await prisma.$transaction(async (tx) => {
    const locked = await stockCountsRepository.lockForUpdateTx(
      tx,
      tenantId,
      id,
    );
    if (!locked) {
      throw new NotFoundError("Stock count not found");
    }

    const count = await tx.stockCount.findFirst({
      where: { id, tenantId },
      include: { location: true, items: true },
    });
    if (!count) {
      throw new NotFoundError("Stock count not found");
    }
    if (count.status === StockCountStatus.COMPLETED) {
      throw new BadRequestError("Stock count already completed");
    }

    let adjustmentCount = 0;

    for (const item of count.items) {
      const live = await inventoryRepository.lockForUpdate(
        tx,
        tenantId,
        item.productId,
        count.locationId,
      );
      const delta = item.physicalQuantity - live.quantity;
      if (delta === 0) continue;

      adjustmentCount += 1;
      const adjustment = await stockAdjustmentsRepository.create(
        tx,
        tenantId,
        userId,
        {
          productId: item.productId,
          locationId: count.locationId,
          quantity: delta,
          reason: AdjustmentReason.COUNTING_ERROR,
          notes: "Stock count reconciliation",
        },
      );

      await recordMovement(tx, {
        tenantId,
        productId: item.productId,
        locationId: count.locationId,
        userId,
        type: MovementType.ADJUSTMENT,
        quantity: delta,
        reference: adjustment.id,
        notes: `Stock count ${count.id} reconciliation`,
      });
    }

    await stockCountsRepository.updateStatusTx(
      tx,
      tenantId,
      id,
      StockCountStatus.COMPLETED,
    );

    await logActivity(
      {
        tenantId,
        userId,
        action: "STOCK_COUNT_COMPLETED",
        description: `Stock count completed for ${count.location.name} with ${adjustmentCount} adjustment(s)`,
      },
      tx,
    );
  });

  return findOne(tenantId, id);
}
