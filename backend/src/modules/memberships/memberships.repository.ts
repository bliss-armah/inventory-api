import { prisma } from "../../lib/prisma.ts";
import { Role, SubscriptionStatus } from "../../generated/prisma";

/**
 * A membership is only ever useful alongside the business it grants access to
 * — the login picker needs the name, and every gate needs the subscription
 * status — so both travel with it rather than being fetched again per caller.
 */
const withTenant = {
  include: {
    tenant: {
      select: { id: true, businessName: true, subscriptionStatus: true },
    },
  },
} as const;

export type MembershipWithTenant = Awaited<
  ReturnType<typeof findForUserAndTenant>
>;

/** Every business this person can currently sign into, suspended or not. */
export function listActiveForUser(userId: string) {
  return prisma.membership.findMany({
    where: { userId, isActive: true },
    ...withTenant,
    orderBy: { createdAt: "asc" },
  });
}

export function findForUserAndTenant(userId: string, tenantId: string) {
  return prisma.membership.findUnique({
    where: { userId_tenantId: { userId, tenantId } },
    ...withTenant,
  });
}

/**
 * Drops the suspended businesses from a membership list. Called only after
 * credentials check out — which of someone's businesses is suspended is not
 * something a failed password attempt should be able to probe.
 */
export function selectSignInable<
  T extends { tenant: { subscriptionStatus: SubscriptionStatus } },
>(memberships: T[]): T[] {
  return memberships.filter(
    (m) => m.tenant.subscriptionStatus !== SubscriptionStatus.SUSPENDED,
  );
}

/**
 * Staff list for one business: the memberships, each with the identity behind
 * it. Search spans the person's name and email, both of which live on `users`.
 */
export function listForTenant(
  tenantId: string,
  skip: number,
  take: number,
  search?: string,
) {
  const where = {
    tenantId,
    ...(search && {
      user: {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { email: { contains: search, mode: "insensitive" as const } },
        ],
      },
    }),
  };

  return Promise.all([
    prisma.membership.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            lastLoginAt: true,
          },
        },
      },
      skip,
      take,
      orderBy: { createdAt: "desc" },
    }),
    prisma.membership.count({ where }),
  ]);
}

export function findByIdInTenant(tenantId: string, id: string) {
  return prisma.membership.findFirst({
    where: { id, tenantId },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
}

/** The membership for a given email *within one business*, or null. */
export function findByEmailInTenant(tenantId: string, email: string) {
  return prisma.membership.findFirst({
    where: { tenantId, user: { email } },
    include: { user: { select: { id: true, email: true } } },
  });
}

export function countActiveOwners(tenantId: string, excludingUserId?: string) {
  return prisma.membership.count({
    where: {
      tenantId,
      role: Role.OWNER,
      isActive: true,
      ...(excludingUserId && { userId: { not: excludingUserId } }),
    },
  });
}

export function create(input: {
  userId: string;
  tenantId: string;
  role: Role;
}) {
  return prisma.membership.create({ data: input });
}

export function update(
  id: string,
  data: { role?: Role; isActive?: boolean },
) {
  return prisma.membership.update({
    where: { id },
    data,
    include: { user: { select: { id: true, name: true, email: true } } },
  });
}

export function remove(id: string) {
  return prisma.membership.delete({ where: { id } });
}
