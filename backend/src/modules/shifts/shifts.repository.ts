import { Prisma, ShiftStatus, PaymentMethod, LocationStatus } from "../../generated/prisma";
import { prisma } from "../../lib/prisma.ts";
import type { PrismaTransactionClient } from "../../lib/transaction.ts";

export function findActiveLocations(tenantId: string) {
  return prisma.location.findMany({
    where: { tenantId, status: LocationStatus.ACTIVE },
    select: { id: true, isDefault: true },
    orderBy: { createdAt: "asc" },
  });
}

export function findOpenForCashier(tenantId: string, cashierId: string) {
  return prisma.shift.findFirst({
    where: { tenantId, cashierId, status: ShiftStatus.OPEN },
    include: { location: { select: { id: true, name: true } } },
  });
}

export function findById(tenantId: string, id: string) {
  return prisma.shift.findFirst({
    where: { tenantId, id },
    include: {
      location: { select: { id: true, name: true } },
      cashier: { select: { id: true, name: true } },
    },
  });
}

export function open(
  tenantId: string,
  cashierId: string,
  locationId: string,
  openingFloat: Prisma.Decimal,
  id?: string,
) {
  return prisma.shift.create({
    data: { ...(id ? { id } : {}), tenantId, cashierId, locationId, openingFloat },
    include: { location: { select: { id: true, name: true } } },
  });
}

export function findByIdForCashier(tenantId: string, cashierId: string, id: string) {
  return prisma.shift.findFirst({
    where: { id, tenantId, cashierId },
    include: { location: { select: { id: true, name: true } } },
  });
}

export async function lockShiftForUpdate(
  tx: PrismaTransactionClient,
  tenantId: string,
  id: string,
) {
  const rows = await tx.$queryRaw<
    Array<{ id: string; status: string; openingFloat: string }>
  >`
    SELECT "id", "status", "openingFloat" FROM "shifts"
    WHERE "id" = ${id} AND "tenantId" = ${tenantId}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

export async function sumCashMovement(
  tx: PrismaTransactionClient,
  tenantId: string,
  shiftId: string,
) {
  const [sales, refunds] = await Promise.all([
    tx.sale.aggregate({
      where: { tenantId, shiftId, paymentMethod: PaymentMethod.CASH },
      _sum: { total: true },
    }),
    tx.saleReturn.aggregate({
      where: { tenantId, shiftId, refundMethod: PaymentMethod.CASH },
      _sum: { refundAmount: true },
    }),
  ]);

  return {
    cashSales: sales._sum.total ?? new Prisma.Decimal(0),
    cashRefunds: refunds._sum.refundAmount ?? new Prisma.Decimal(0),
  };
}

export function close(
  tx: PrismaTransactionClient,
  tenantId: string,
  id: string,
  data: {
    countedCash: Prisma.Decimal;
    expectedCash: Prisma.Decimal;
    variance: Prisma.Decimal;
    notes?: string;
  },
) {
  return tx.shift.update({
    where: { id, tenantId },
    data: { ...data, status: ShiftStatus.CLOSED, closedAt: new Date() },
  });
}

export function list(tenantId: string, skip: number, take: number, cashierId?: string) {
  const where = { tenantId, ...(cashierId && { cashierId }) };

  return Promise.all([
    prisma.shift.findMany({
      where,
      skip,
      take,
      orderBy: { openedAt: "desc" },
      include: {
        location: { select: { id: true, name: true } },
        cashier: { select: { id: true, name: true } },
      },
    }),
    prisma.shift.count({ where }),
  ]);
}
