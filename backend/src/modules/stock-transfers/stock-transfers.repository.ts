import { prisma } from "../../lib/prisma.ts";
import type { PrismaTransactionClient } from "../../lib/transaction.ts";
import { TransferStatus } from "../../generated/prisma";
import type { CreateTransferInput } from "./stock-transfers.validators.ts";

const include = {
  fromLocation: true,
  toLocation: true,
  requestedBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  items: { include: { product: true } },
} as const;

export function create(
  tenantId: string,
  userId: string,
  input: CreateTransferInput,
) {
  return prisma.stockTransfer.create({
    data: {
      tenantId,
      fromLocationId: input.fromLocationId,
      toLocationId: input.toLocationId,
      notes: input.notes,
      requestedById: userId,
      items: { create: input.items },
    },
    include,
  });
}

export function list(
  tenantId: string,
  skip: number,
  take: number,
  status?: TransferStatus,
) {
  const where = { tenantId, ...(status && { status }) };
  return Promise.all([
    prisma.stockTransfer.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: "desc" },
      include,
    }),
    prisma.stockTransfer.count({ where }),
  ]);
}

export function findByIdInTenant(tenantId: string, id: string) {
  return prisma.stockTransfer.findFirst({ where: { id, tenantId }, include });
}

type TransitionExtra = Partial<{
  approvedById: string;
  approvedAt: Date;
  transferredAt: Date;
  receivedAt: Date;
}>;

/**
 * Atomically moves the transfer to `toStatus` only if it's currently in one
 * of `fromStatuses`. Two concurrent calls racing on the same transfer can
 * only have one succeed — Postgres serializes the UPDATEs, and the loser's
 * WHERE clause no longer matches once the winner has committed.
 */
export async function transitionStatusTx(
  tx: PrismaTransactionClient,
  tenantId: string,
  id: string,
  fromStatuses: TransferStatus[],
  toStatus: TransferStatus,
  extra?: TransitionExtra,
): Promise<boolean> {
  const result = await tx.stockTransfer.updateMany({
    where: { id, tenantId, status: { in: fromStatuses } },
    data: { status: toStatus, ...extra },
  });
  return result.count > 0;
}
