import { randomBytes } from "node:crypto";
import { Prisma } from "../../generated/prisma/client.ts";
import { prisma } from "../../lib/prisma.ts";
import type { PrismaTransactionClient } from "../../lib/transaction.ts";

export function generateReturnNumber(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const entropy = randomBytes(3).toString("hex").toUpperCase();
  return `RT-${timestamp}${entropy}`;
}

export async function lockSale(tx: PrismaTransactionClient, tenantId: string, saleId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "sales"
    WHERE "id" = ${saleId} AND "tenantId" = ${tenantId}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

export async function returnedTotals(
  tx: PrismaTransactionClient,
  tenantId: string,
  saleId: string,
) {
  const rows = await tx.saleReturnItem.groupBy({
    by: ["saleItemId"],
    where: { tenantId, saleReturn: { saleId } },
    _sum: { quantity: true, refundAmount: true },
  });
  return new Map(
    rows.map((row) => [
      row.saleItemId,
      {
        quantity: row._sum.quantity ?? 0,
        refundAmount: row._sum.refundAmount ?? new Prisma.Decimal(0),
      },
    ]),
  );
}

export function createReturn(
  tx: PrismaTransactionClient,
  data: Prisma.SaleReturnUncheckedCreateInput,
) {
  return tx.saleReturn.create({ data });
}

export function createReturnItems(
  tx: PrismaTransactionClient,
  items: Prisma.SaleReturnItemUncheckedCreateInput[],
) {
  return tx.saleReturnItem.createMany({ data: items });
}

export function findById(tenantId: string, id: string) {
  return prisma.saleReturn.findFirst({
    where: { tenantId, id },
    include: { items: true },
  });
}
