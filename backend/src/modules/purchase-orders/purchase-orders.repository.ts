import { randomBytes } from "node:crypto";
import { prisma } from "../../lib/prisma.ts";
import { Prisma } from "../../generated/prisma/client.ts";
import type { PrismaTransactionClient } from "../../lib/transaction.ts";
import { PurchaseOrderStatus } from "../../generated/prisma/enums.ts";
import type {
  CreatePurchaseOrderInput,
  PurchaseOrderFilter,
} from "./purchase-orders.validators.ts";

const include = {
  supplier: true,
  location: true,
  createdBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  items: { include: { product: true } },
} as const;

/**
 * Timestamp alone collides if two orders are created in the same
 * millisecond for the same tenant; a few bytes of random entropy make that
 * astronomically unlikely without needing a per-tenant sequence table.
 */
export function generateOrderNumber(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const entropy = randomBytes(3).toString("hex").toUpperCase();
  return `PO-${timestamp}${entropy}`;
}

export function create(
  tenantId: string,
  userId: string,
  input: CreatePurchaseOrderInput,
) {
  return prisma.purchaseOrder.create({
    data: {
      tenantId,
      supplierId: input.supplierId,
      locationId: input.locationId,
      notes: input.notes,
      orderNumber: generateOrderNumber(),
      createdById: userId,
      items: {
        create: input.items.map((item) => ({
          productId: item.productId,
          quantityOrdered: item.quantityOrdered,
          costPrice: item.costPrice,
        })),
      },
    },
    include,
  });
}

export function list(
  tenantId: string,
  skip: number,
  take: number,
  filter: PurchaseOrderFilter,
) {
  const where = { tenantId, ...(filter.status && { status: filter.status }) };

  return Promise.all([
    prisma.purchaseOrder.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: "desc" },
      include,
    }),
    prisma.purchaseOrder.count({ where }),
  ]);
}

export function findByIdInTenant(tenantId: string, id: string) {
  return prisma.purchaseOrder.findFirst({ where: { id, tenantId }, include });
}

export function findByIdInTenantTx(
  tx: PrismaTransactionClient,
  tenantId: string,
  id: string,
) {
  return tx.purchaseOrder.findFirst({ where: { id, tenantId }, include });
}

/**
 * Atomically moves the order to `toStatus` only if it's currently in one of
 * `fromStatuses`, so two concurrent requests on the same order can't both
 * succeed — Postgres serializes the UPDATEs and the loser's WHERE no longer
 * matches once the winner has committed.
 */
export async function transitionStatus(
  tenantId: string,
  id: string,
  fromStatuses: PurchaseOrderStatus[],
  toStatus: PurchaseOrderStatus,
  extra?: { approvedById?: string; approvedAt?: Date },
): Promise<boolean> {
  const result = await prisma.purchaseOrder.updateMany({
    where: { id, tenantId, status: { in: fromStatuses } },
    data: { status: toStatus, ...extra },
  });
  return result.count > 0;
}

export function updateStatusTx(
  tx: PrismaTransactionClient,
  tenantId: string,
  id: string,
  status: PurchaseOrderStatus,
) {
  return tx.purchaseOrder.update({ where: { id, tenantId }, data: { status } });
}

/**
 * Row-locks the order for the duration of the transaction so concurrent
 * `receiveGoods` calls on the same order serialize instead of both reading
 * the same "remaining quantity" and over-receiving.
 */
export async function lockForUpdateTx(
  tx: PrismaTransactionClient,
  tenantId: string,
  id: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT id FROM "purchase_orders" WHERE id = ${id} AND "tenantId" = ${tenantId} FOR UPDATE`,
  );
  return rows.length > 0;
}

export function incrementReceivedQuantityTx(
  tx: PrismaTransactionClient,
  itemId: string,
  quantity: number,
) {
  return tx.purchaseOrderItem.update({
    where: { id: itemId },
    data: { quantityReceived: { increment: quantity } },
  });
}

export function createGoodsReceiptTx(
  tx: PrismaTransactionClient,
  input: {
    tenantId: string;
    purchaseOrderId: string;
    locationId: string;
    receivedById: string;
    notes?: string;
    items: Array<{
      productId: string;
      quantity: number;
      costPrice: number;
      batchNumber?: string;
      expiryDate?: Date;
    }>;
  },
) {
  return tx.goodsReceipt.create({
    data: {
      tenantId: input.tenantId,
      purchaseOrderId: input.purchaseOrderId,
      locationId: input.locationId,
      receivedById: input.receivedById,
      notes: input.notes,
      items: { create: input.items },
    },
    include: { items: true },
  });
}
