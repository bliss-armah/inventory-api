import { z } from "zod";
import { MovementType } from "../../generated/prisma";
import { prisma } from "../../lib/prisma.ts";
import { logActivity } from "../../lib/activity-logger.ts";
import { paginate } from "../../shared/pagination.ts";
import { assertOwned } from "../../shared/ownership.ts";
import { recordMovement } from "../stock-movements/stock-movements.service.ts";
import * as stockAdjustmentsRepository from "./stock-adjustments.repository.ts";
import type { CreateAdjustmentInput } from "./stock-adjustments.validators.ts";

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

export function list(tenantId: string, rawQuery: unknown) {
  const { locationId } = listFilterSchema.parse(rawQuery);
  return paginate(rawQuery, (skip, take) =>
    stockAdjustmentsRepository.list(tenantId, skip, take, locationId),
  );
}
