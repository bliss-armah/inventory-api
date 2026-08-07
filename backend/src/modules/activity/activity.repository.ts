import { prisma } from "../../lib/prisma";

export type ActivityFilter = {
  userId?: string;
  action?: string;
  from?: Date;
  to?: Date;
};

export function list(tenantId: string, skip: number, take: number, filter: ActivityFilter) {
  const where = {
    tenantId,
    ...(filter.userId && { userId: filter.userId }),
    ...(filter.action && { action: filter.action }),
    ...((filter.from || filter.to) && {
      createdAt: {
        ...(filter.from && { gte: filter.from }),
        ...(filter.to && { lte: filter.to }),
      },
    }),
  };

  return Promise.all([
    prisma.activityLog.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: "desc" },
      include: { user: { select: { id: true, name: true } } },
    }),
    prisma.activityLog.count({ where }),
  ]);
}
