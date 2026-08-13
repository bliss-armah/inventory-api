import { Prisma } from "../../generated/prisma/client.ts";
import { MovementType, ReturnDisposition } from "../../generated/prisma/enums.ts";
import { prisma } from "../../lib/prisma.ts";
import { logActivity } from "../../lib/activity-logger.ts";
import { BadRequestError, NotFoundError } from "../../shared/errors.ts";
import { recordMovement } from "../stock-movements/stock-movements.service.ts";
import { assertOpenShift, assertShiftStillOpen } from "../shifts/shifts.service.ts";
import * as returnsRepository from "./returns.repository.ts";
import type { CreateReturnInput } from "./returns.validators.ts";

const ZERO = new Prisma.Decimal(0);

export async function create(
  tenantId: string,
  userId: string,
  saleId: string,
  input: CreateReturnInput,
) {
  const shift = await assertOpenShift(tenantId, userId, input.shiftId);

  const sale = await prisma.sale.findFirst({
    where: { tenantId, id: saleId },
    include: { items: true },
  });
  if (!sale) {
    throw new NotFoundError("Sale not found");
  }

  return prisma.$transaction(async (tx) => {
    await returnsRepository.lockSale(tx, tenantId, saleId);
    await assertShiftStillOpen(tx, tenantId, shift.id);
    const alreadyReturned = await returnsRepository.returnedTotals(tx, tenantId, saleId);

    const saleItemById = new Map(sale.items.map((item) => [item.id, item]));
    let refundAmount = ZERO;
    const consumedQuantity = new Map<string, number>();
    const consumedRefund = new Map<string, Prisma.Decimal>();

    const returnItems = input.items.map((line) => {
      const saleItem = saleItemById.get(line.saleItemId);
      if (!saleItem) {
        throw new BadRequestError("That line does not belong to this sale");
      }

      const priorTotals = alreadyReturned.get(line.saleItemId);
      const priorQuantity = priorTotals?.quantity ?? 0;
      const priorRefund = priorTotals?.refundAmount ?? ZERO;
      const consumedSoFarQuantity = consumedQuantity.get(line.saleItemId) ?? 0;
      const consumedSoFarRefund = consumedRefund.get(line.saleItemId) ?? ZERO;

      const previously = priorQuantity + consumedSoFarQuantity;
      if (previously + line.quantity > saleItem.quantity) {
        throw new BadRequestError(
          `Cannot return ${line.quantity} of that item: ${saleItem.quantity - previously} remaining`,
        );
      }

      const refundedSoFar = priorRefund.plus(consumedSoFarRefund);
      const newlyReturnedQuantity = previously + line.quantity;
      const perUnit = saleItem.lineTotal.dividedBy(saleItem.quantity);
      const lineRefund =
        newlyReturnedQuantity === saleItem.quantity
          ? saleItem.lineTotal.minus(refundedSoFar)
          : perUnit.times(line.quantity).toDecimalPlaces(2);

      consumedQuantity.set(line.saleItemId, consumedSoFarQuantity + line.quantity);
      consumedRefund.set(line.saleItemId, consumedSoFarRefund.plus(lineRefund));
      refundAmount = refundAmount.plus(lineRefund);

      return {
        tenantId,
        saleItemId: saleItem.id,
        productId: saleItem.productId,
        quantity: line.quantity,
        disposition: line.disposition,
        unitPrice: saleItem.unitPrice,
        refundAmount: lineRefund,
      };
    });

    const saleReturn = await returnsRepository.createReturn(tx, {
      tenantId,
      saleId,
      returnNumber: returnsRepository.generateReturnNumber(),
      locationId: sale.locationId,
      shiftId: shift.id,
      userId,
      reason: input.reason ?? null,
      refundAmount,
      refundMethod: input.refundMethod,
    });

    await returnsRepository.createReturnItems(
      tx,
      returnItems.map((item) => ({ ...item, saleReturnId: saleReturn.id })),
    );

    for (const item of returnItems) {
      await recordMovement(tx, {
        tenantId,
        productId: item.productId,
        locationId: sale.locationId,
        userId,
        type: MovementType.RETURN,
        quantity: item.quantity,
        reference: saleReturn.returnNumber,
      });

      if (item.disposition === ReturnDisposition.DAMAGED) {
        await recordMovement(tx, {
          tenantId,
          productId: item.productId,
          locationId: sale.locationId,
          userId,
          type: MovementType.DAMAGE,
          quantity: item.quantity,
          reference: saleReturn.returnNumber,
          notes: "Damaged on return",
        });
      }
    }

    await logActivity(
      {
        tenantId,
        userId,
        action: "SALE_RETURNED",
        description: `Return ${saleReturn.returnNumber} against sale ${sale.saleNumber} for ${refundAmount}`,
      },
      tx,
    );

    return saleReturn;
  });
}
