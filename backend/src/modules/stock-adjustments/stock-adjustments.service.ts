import { z } from "zod";
import { MovementType } from "../../generated/prisma";
import { prisma } from "../../lib/prisma.ts";
import { logActivity } from "../../lib/activity-logger.ts";
import { paginate } from "../../shared/pagination.ts";
import { BadRequestError } from "../../shared/errors.ts";
import { assertOwned } from "../../shared/ownership.ts";
import { lockForUpdate } from "../inventory/inventory.repository.ts";
import { recordMovement } from "../stock-movements/stock-movements.service.ts";
import * as stockAdjustmentsRepository from "./stock-adjustments.repository.ts";
import type {
  BulkAdjustmentInput,
  CreateAdjustmentInput,
} from "./stock-adjustments.validators.ts";

const listFilterSchema = z.object({ locationId: z.string().trim().optional() });

export async function create(
  tenantId: string,
  userId: string,
  input: CreateAdjustmentInput,
) {
  await assertOwned(tenantId, {
    productIds: [input.productId],
    locationIds: [input.locationId],
  });

  if (input.id) {
    const existing = await stockAdjustmentsRepository.findByIdInTenant(tenantId, input.id);
    if (existing) return existing;
  }

  return prisma.$transaction(async (tx) => {
    const adjustment = await stockAdjustmentsRepository.create(
      tx,
      tenantId,
      userId,
      input,
    );

    const movement = await recordMovement(tx, {
      tenantId,
      productId: input.productId,
      locationId: input.locationId,
      userId,
      type: MovementType.ADJUSTMENT,
      quantity: input.quantity,
      reference: adjustment.id,
      notes: `${input.reason}${input.notes ? `: ${input.notes}` : ""}`,
    });

    await logActivity(
      {
        tenantId,
        userId,
        action: "STOCK_ADJUSTED",
        description: `Stock adjusted by ${input.quantity} for reason ${input.reason}`,
      },
      tx,
    );

    return { adjustment, movement };
  });
}

function mergeBulkItems(items: BulkAdjustmentInput["items"]) {
  const totals = new Map<string, number>();
  for (const item of items) {
    totals.set(item.productId, (totals.get(item.productId) ?? 0) + item.quantity);
  }
  return [...totals.entries()]
    .map(([productId, quantity]) => ({ productId, quantity }))
    .sort((a, b) => a.productId.localeCompare(b.productId));
}

export async function createBulk(
  tenantId: string,
  userId: string,
  input: BulkAdjustmentInput,
) {
  const lines = mergeBulkItems(input.items);

  if (input.mode === "SET" && lines.some((line) => line.quantity < 0)) {
    throw new BadRequestError("A counted quantity cannot be negative");
  }
  if (input.mode === "DELTA" && lines.some((line) => line.quantity === 0)) {
    throw new BadRequestError("A quantity change cannot be zero");
  }

  await assertOwned(tenantId, {
    productIds: lines.map((line) => line.productId),
    locationIds: [input.locationId],
  });

  const products = await prisma.product.findMany({
    where: { tenantId, id: { in: lines.map((line) => line.productId) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(products.map((product) => [product.id, product.name]));

  return prisma.$transaction(async (tx) => {
    const results: Array<{
      productId: string;
      before: number;
      after: number;
      change: number;
    }> = [];

    for (const line of lines) {
      const locked = await lockForUpdate(tx, tenantId, line.productId, input.locationId);
      const change = input.mode === "SET" ? line.quantity - locked.quantity : line.quantity;
      if (change === 0) {
        results.push({
          productId: line.productId,
          before: locked.quantity,
          after: locked.quantity,
          change: 0,
        });
        continue;
      }

      const adjustment = await stockAdjustmentsRepository.create(tx, tenantId, userId, {
        productId: line.productId,
        locationId: input.locationId,
        quantity: change,
        reason: input.reason,
        notes: input.notes,
      });

      try {
        const movement = await recordMovement(tx, {
          tenantId,
          productId: line.productId,
          locationId: input.locationId,
          userId,
          type: MovementType.ADJUSTMENT,
          quantity: change,
          reference: adjustment.id,
          notes: `${input.reason}${input.notes ? `: ${input.notes}` : ""}`,
        });
        results.push({
          productId: line.productId,
          before: movement.beforeQuantity,
          after: movement.afterQuantity,
          change,
        });
      } catch (error) {
        if (error instanceof BadRequestError) {
          throw new BadRequestError(`${nameById.get(line.productId) ?? line.productId}: ${error.message}`);
        }
        throw error;
      }
    }

    const changed = results.filter((result) => result.change !== 0).length;
    await logActivity(
      {
        tenantId,
        userId,
        action: "STOCK_ADJUSTED_BULK",
        description: `Bulk stock adjustment (${input.reason}) changed ${changed} of ${results.length} products`,
      },
      tx,
    );

    return { changed, unchanged: results.length - changed, results };
  });
}

export function list(tenantId: string, rawQuery: unknown) {
  const { locationId } = listFilterSchema.parse(rawQuery);
  return paginate(rawQuery, (skip, take) =>
    stockAdjustmentsRepository.list(tenantId, skip, take, locationId),
  );
}
