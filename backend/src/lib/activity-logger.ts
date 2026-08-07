import { prisma } from "./prisma";
import type { PrismaTransactionClient } from "./transaction";

type LogActivityInput = {
  tenantId: string;
  userId?: string | null;
  action: string;
  description: string;
  ipAddress?: string | null;
};

/**
 * Writes the audit trail entry. Pass `tx` when the action being logged
 * changes stock or other business state in the same transaction — that
 * makes the log write atomic with the change (both commit or both roll
 * back), instead of a log failure reporting an error for an operation that
 * already succeeded and inviting a client retry that re-applies it.
 *
 * Without `tx` (e.g. login, profile updates) the write runs standalone and
 * failures are swallowed — losing an audit entry for a non-stock action
 * shouldn't fail the request that triggered it.
 */
export async function logActivity(
  input: LogActivityInput,
  tx?: PrismaTransactionClient,
): Promise<void> {
  const client = tx ?? prisma;
  const write = client.activityLog.create({
    data: {
      tenantId: input.tenantId,
      userId: input.userId ?? null,
      action: input.action,
      description: input.description,
      ipAddress: input.ipAddress ?? null,
    },
  });

  if (tx) {
    await write;
    return;
  }

  try {
    await write;
  } catch (error) {
    console.error("Failed to write activity log entry:", error);
  }
}
