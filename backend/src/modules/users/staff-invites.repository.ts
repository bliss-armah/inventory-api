import { prisma } from "../../lib/prisma.ts";
import { Role } from "../../generated/prisma";

export function listPendingForTenant(tenantId: string) {
  return prisma.staffInvite.findMany({
    where: { tenantId, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
}

export function findByTenantAndEmail(tenantId: string, email: string) {
  return prisma.staffInvite.findUnique({
    where: { tenantId_email: { tenantId, email } },
  });
}

export function findByTokenHash(tokenHash: string) {
  return prisma.staffInvite.findUnique({
    where: { tokenHash },
    include: { tenant: { select: { id: true, businessName: true, subscriptionStatus: true } } },
  });
}

export function findByIdInTenant(tenantId: string, id: string) {
  return prisma.staffInvite.findFirst({ where: { id, tenantId } });
}

/**
 * Upsert rather than create: re-inviting an address whose earlier invitation
 * expired should just work, and the (tenantId, email) unique index would
 * otherwise turn that into a confusing conflict.
 */
export function upsert(input: {
  tenantId: string;
  email: string;
  name: string;
  role: Role;
  tokenHash: string;
  expiresAt: Date;
  invitedByUserId: string;
}) {
  const { tenantId, email, ...rest } = input;
  return prisma.staffInvite.upsert({
    where: { tenantId_email: { tenantId, email } },
    create: { tenantId, email, ...rest },
    update: rest,
  });
}

export function remove(id: string) {
  return prisma.staffInvite.delete({ where: { id } }).catch(() => null);
}
