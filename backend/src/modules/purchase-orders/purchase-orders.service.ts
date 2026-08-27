import {
  MovementType,
  PurchaseOrderStatus,
} from "../../generated/prisma";
import { prisma } from "../../lib/prisma.ts";
import { logActivity } from "../../lib/activity-logger.ts";
import { BadRequestError, NotFoundError } from "../../shared/errors.ts";
import { paginate } from "../../shared/pagination.ts";
import { withUniqueConstraint } from "../../shared/prisma-errors.ts";
import { assertOwned } from "../../shared/ownership.ts";
import { recordMovement } from "../stock-movements/stock-movements.service.ts";
import * as purchaseOrdersRepository from "./purchase-orders.repository.ts";
import {
  purchaseOrderFilterSchema,
  type CreatePurchaseOrderInput,
  type ReceiveGoodsInput,
} from "./purchase-orders.validators.ts";

export function list(tenantId: string, rawQuery: unknown) {
  const filter = purchaseOrderFilterSchema.parse(rawQuery);
  return paginate(rawQuery, (skip, take) =>
    purchaseOrdersRepository.list(tenantId, skip, take, filter),
  );
}

export async function findOne(tenantId: string, id: string) {
  const order = await purchaseOrdersRepository.findByIdInTenant(tenantId, id);
  if (!order) {
    throw new NotFoundError("Purchase order not found");
  }
  return order;
}

export async function create(
  tenantId: string,
  userId: string,
  input: CreatePurchaseOrderInput,
) {
  await assertOwned(tenantId, {
    supplierIds: [input.supplierId],
    locationIds: [input.locationId],
    productIds: input.items.map((item) => item.productId),
  });

  return withUniqueConstraint(
    () => purchaseOrdersRepository.create(tenantId, userId, input),
    {
      field: "orderNumber",
      message: "A purchase order with this number already exists",
    },
  );
}

export async function submit(tenantId: string, id: string) {
  const transitioned = await purchaseOrdersRepository.transitionStatus(
    tenantId,
    id,
    [PurchaseOrderStatus.DRAFT],
    PurchaseOrderStatus.SUBMITTED,
  );
  if (!transitioned) {
    await findOne(tenantId, id);
    throw new BadRequestError("Only draft purchase orders can be submitted");
  }
  return findOne(tenantId, id);
}

export async function approve(tenantId: string, userId: string, id: string) {
  const transitioned = await purchaseOrdersRepository.transitionStatus(
    tenantId,
    id,
    [PurchaseOrderStatus.SUBMITTED],
    PurchaseOrderStatus.APPROVED,
    { approvedById: userId, approvedAt: new Date() },
  );
  if (!transitioned) {
    await findOne(tenantId, id);
    throw new BadRequestError("Only submitted purchase orders can be approved");
  }

  const order = await findOne(tenantId, id);
  await logActivity({
    tenantId,
    userId,
    action: "PURCHASE_ORDER_APPROVED",
    description: `Purchase order ${order.orderNumber} approved`,
  });

  return order;
}

export async function cancel(tenantId: string, id: string) {
  const transitioned = await purchaseOrdersRepository.transitionStatus(
    tenantId,
    id,
    [PurchaseOrderStatus.DRAFT, PurchaseOrderStatus.SUBMITTED],
    PurchaseOrderStatus.CANCELED,
  );
  if (!transitioned) {
    await findOne(tenantId, id);
    throw new BadRequestError(
      "Only draft or submitted purchase orders can be canceled",
    );
  }
  return findOne(tenantId, id);
}

/**
 * Receiving is the only place a purchase order touches inventory: it creates
 * a GoodsReceipt, bumps each item's received quantity, and records a PURCHASE
 * stock movement per line — all inside one transaction — then auto-completes
 * the order once every line is fully received.
 */
export async function receiveGoods(
  tenantId: string,
  userId: string,
  id: string,
  input: ReceiveGoodsInput,
) {
  const result = await prisma.$transaction(async (tx) => {
    // Lock the order first so two concurrent receives against the same PO
    // serialize — otherwise both could read the same "remaining quantity"
    // and over-receive past what was ordered.
    const locked = await purchaseOrdersRepository.lockForUpdateTx(
      tx,
      tenantId,
      id,
    );
    if (!locked) {
      throw new NotFoundError("Purchase order not found");
    }

    const order = await purchaseOrdersRepository.findByIdInTenantTx(
      tx,
      tenantId,
      id,
    );
    if (!order) {
      throw new NotFoundError("Purchase order not found");
    }
    if (
      order.status !== PurchaseOrderStatus.APPROVED &&
      order.status !== PurchaseOrderStatus.GOODS_RECEIVED
    ) {
      throw new BadRequestError(
        "Goods can only be received against approved purchase orders",
      );
    }

    for (const receiveItem of input.items) {
      const orderItem = order.items.find(
        (item) => item.productId === receiveItem.productId,
      );
      if (!orderItem) {
        throw new BadRequestError(
          `Product ${receiveItem.productId} is not part of this purchase order`,
        );
      }
      const remaining = orderItem.quantityOrdered - orderItem.quantityReceived;
      if (receiveItem.quantity > remaining) {
        throw new BadRequestError(
          `Cannot receive ${receiveItem.quantity} units of ${orderItem.product.name}; only ${remaining} remain on order`,
        );
      }
    }

    const receipt = await purchaseOrdersRepository.createGoodsReceiptTx(tx, {
      tenantId,
      purchaseOrderId: id,
      locationId: order.locationId,
      receivedById: userId,
      notes: input.notes,
      items: input.items,
    });

    for (const receiveItem of input.items) {
      const orderItem = order.items.find(
        (item) => item.productId === receiveItem.productId,
      )!;
      await purchaseOrdersRepository.incrementReceivedQuantityTx(
        tx,
        orderItem.id,
        receiveItem.quantity,
      );
      await recordMovement(tx, {
        tenantId,
        productId: receiveItem.productId,
        locationId: order.locationId,
        userId,
        type: MovementType.PURCHASE,
        quantity: receiveItem.quantity,
        reference: receipt.id,
        notes: `Received against ${order.orderNumber}`,
      });
    }

    const freshOrder = await purchaseOrdersRepository.findByIdInTenantTx(
      tx,
      tenantId,
      id,
    );
    const fullyReceived = freshOrder!.items.every(
      (item) => item.quantityReceived >= item.quantityOrdered,
    );
    const nextStatus = fullyReceived
      ? PurchaseOrderStatus.COMPLETED
      : PurchaseOrderStatus.GOODS_RECEIVED;

    const updatedOrder = await purchaseOrdersRepository.updateStatusTx(
      tx,
      tenantId,
      id,
      nextStatus,
    );

    await logActivity(
      {
        tenantId,
        userId,
        action: "GOODS_RECEIVED",
        description: `Goods received against purchase order ${updatedOrder.orderNumber}`,
      },
      tx,
    );

    return { receipt, order: updatedOrder };
  });

  return result;
}
