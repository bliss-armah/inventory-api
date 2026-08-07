import { prisma } from "../../lib/prisma.ts";
import { SubscriptionStatus } from "../../generated/prisma/enums.ts";

const include = {
  _count: { select: { users: true, locations: true, products: true } },
} as const;

export function list(skip: number, take: number, search?: string) {
  const where = search
    ? {
        OR: [
          { businessName: { contains: search, mode: "insensitive" as const } },
          { email: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : {};

  return Promise.all([
    prisma.tenant.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: "desc" },
      include,
    }),
    prisma.tenant.count({ where }),
  ]);
}

export function findById(id: string) {
  return prisma.tenant.findUnique({
    where: { id },
    include: {
      ...include,
      users: {
        where: { role: "OWNER" },
        select: { id: true, name: true, email: true, isActive: true },
      },
    },
  });
}

export function updateSubscriptionStatus(
  id: string,
  status: SubscriptionStatus,
  extra?: { suspendedAt?: Date | null; suspendedReason?: string | null },
) {
  return prisma.tenant.update({
    where: { id },
    data: { subscriptionStatus: status, ...extra },
  });
}

export function revokeAllRefreshTokensForTenant(tenantId: string) {
  return prisma.refreshToken.updateMany({
    where: { tenantId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function stats() {
  const [totalTenants, totalUsers, byStatus] = await Promise.all([
    prisma.tenant.count(),
    prisma.user.count(),
    prisma.tenant.groupBy({
      by: ["subscriptionStatus"],
      _count: { _all: true },
    }),
  ]);

  const tenantsByStatus = Object.fromEntries(
    Object.values(SubscriptionStatus).map((status) => [status, 0]),
  ) as Record<SubscriptionStatus, number>;
  for (const row of byStatus) {
    tenantsByStatus[row.subscriptionStatus] = row._count._all;
  }

  return { totalTenants, totalUsers, tenantsByStatus };
}
