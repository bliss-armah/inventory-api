import { OrderStatus, Prisma } from "../../generated/prisma";
import { prisma } from "../../lib/prisma.ts";
import type { PrismaTransactionClient } from "../../lib/transaction.ts";

const orderInclude = {
  items: {
    include: { product: { select: { id: true, name: true, sku: true, barcode: true, unit: true } } },
    orderBy: { id: "asc" },
  },
  customer: { select: { id: true, name: true, phone: true } },
  createdBy: { select: { id: true, name: true } },
  location: { select: { id: true, name: true } },
} satisfies Prisma.OrderInclude;

export function findById(tenantId: string, id: string) {
  return prisma.order.findFirst({ where: { tenantId, id }, include: orderInclude });
}

export function findByNumber(tenantId: string, orderNumber: string) {
  return prisma.order.findFirst({ where: { tenantId, orderNumber }, include: orderInclude });
}

export function list(
  tenantId: string,
  skip: number,
  take: number,
  filters: { status?: OrderStatus; search?: string },
) {
  const search = filters.search;
  const where: Prisma.OrderWhereInput = {
    tenantId,
    ...(filters.status && { status: filters.status }),
    ...(search && {
      OR: [
        { orderNumber: { contains: search, mode: "insensitive" } },
        { customerName: { contains: search, mode: "insensitive" } },
        { customer: { name: { contains: search, mode: "insensitive" } } },
      ],
    }),
  };

  return Promise.all([
    prisma.order.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: "desc" },
      include: {
        customer: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        items: { select: { id: true, quantity: true, pickedQuantity: true } },
      },
    }),
    prisma.order.count({ where }),
  ]);
}

export function createOrder(tx: PrismaTransactionClient, data: Prisma.OrderUncheckedCreateInput) {
  return tx.order.create({ data });
}

export function createItems(
  tx: PrismaTransactionClient,
  items: Prisma.OrderItemUncheckedCreateInput[],
) {
  return tx.orderItem.createMany({ data: items });
}

export function claimOpen(
  tx: PrismaTransactionClient,
  tenantId: string,
  id: string,
  data: Prisma.OrderUncheckedUpdateManyInput,
) {
  return tx.order.updateMany({
    where: { tenantId, id, status: OrderStatus.OPEN },
    data,
  });
}

export function setPickedQuantity(
  tx: PrismaTransactionClient,
  tenantId: string,
  orderId: string,
  itemId: string,
  pickedQuantity: number,
) {
  return tx.orderItem.updateMany({
    where: { id: itemId, tenantId, orderId },
    data: { pickedQuantity },
  });
}

export function findItems(tx: PrismaTransactionClient, tenantId: string, orderId: string) {
  return tx.orderItem.findMany({
    where: { tenantId, orderId },
    orderBy: { productId: "asc" },
  });
}

export function findStaleOpenIds(cutoff: Date) {
  return prisma.order.findMany({
    where: { status: OrderStatus.OPEN, createdAt: { lt: cutoff } },
    select: { id: true, tenantId: true },
  });
}
