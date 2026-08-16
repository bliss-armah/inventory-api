import { prisma } from "../../lib/prisma.ts";
import { Role } from "../../generated/prisma/enums.ts";
import type { Identifier } from "../../lib/identifier.ts";
import type { EntitlementsInput } from "../tenants/tenants.validators.ts";

/**
 * Exactly what createTenantWithOwner reads, declared structurally rather than
 * as a union of the two callers' schemas: public registration supplies a
 * password and platform onboarding does not, but neither difference matters
 * here, and naming the callers' types would couple this module to both.
 */
type TenantWithOwnerInput = {
  businessName: string;
  ownerName: string;
  email: string;
  phone: string;
  country: string;
  timeZone: string;
};

const withTenantStatus = {
  include: { tenant: { select: { subscriptionStatus: true } } },
} as const;

export function findUserByEmail(email: string) {
  return prisma.user.findUnique({ where: { email }, ...withTenantStatus });
}

/**
 * Resolves the single account a login identifier points at. Both columns are
 * unique, so either branch matches at most one user — which is what lets
 * phone stand in for email as a login credential.
 */
export function findUserByIdentifier(identifier: Identifier) {
  return prisma.user.findUnique({
    where:
      identifier.kind === "email"
        ? { email: identifier.email }
        : { phone: identifier.phone },
    ...withTenantStatus,
  });
}

export function findUserByPhone(phone: string) {
  return prisma.user.findUnique({ where: { phone }, ...withTenantStatus });
}

export function findUserById(id: string) {
  return prisma.user.findUnique({ where: { id }, ...withTenantStatus });
}

/**
 * Registering a business provisions its whole starting workspace atomically:
 * tenant, owner account, default "Main Store" location, and default settings.
 * Small businesses never have to configure any of this themselves.
 */
export function createTenantWithOwner(
  input: TenantWithOwnerInput,
  passwordHash: string,
  entitlements: EntitlementsInput = {},
) {
  return prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        businessName: input.businessName,
        phone: input.phone,
        email: input.email,
        country: input.country,
        timeZone: input.timeZone,
      },
    });

    const owner = await tx.user.create({
      data: {
        tenantId: tenant.id,
        name: input.ownerName,
        email: input.email,
        passwordHash,
        role: Role.OWNER,
      },
    });

    const location = await tx.location.create({
      data: {
        tenantId: tenant.id,
        name: "Main Store",
        isDefault: true,
      },
    });

    const settings = await tx.businessSettings.create({
      data: {
        tenantId: tenant.id,
        // Unset flags arrive as undefined, which Prisma reads as "use the
        // column default" — so the public-registration path is unchanged.
        ...entitlements,
      },
    });

    return { tenant, owner, location, settings };
  });
}

export function updateLastLogin(userId: string) {
  return prisma.user.update({
    where: { id: userId },
    data: { lastLoginAt: new Date() },
  });
}

export function createRefreshToken(input: {
  tenantId: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}) {
  return prisma.refreshToken.create({ data: input });
}

export function findRefreshTokenByHash(tokenHash: string) {
  return prisma.refreshToken.findUnique({ where: { tokenHash } });
}

export function revokeRefreshToken(id: string) {
  return prisma.refreshToken.update({
    where: { id },
    data: { revokedAt: new Date() },
  });
}

export function revokeAllRefreshTokensForUser(userId: string) {
  return prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export function createPasswordResetToken(input: {
  tenantId: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}) {
  return prisma.passwordResetToken.create({ data: input });
}

export function findPasswordResetTokenByHash(tokenHash: string) {
  return prisma.passwordResetToken.findUnique({ where: { tokenHash } });
}

export function markPasswordResetTokenUsed(id: string) {
  return prisma.passwordResetToken.update({
    where: { id },
    data: { usedAt: new Date() },
  });
}

export function updatePassword(userId: string, passwordHash: string) {
  return prisma.user.update({ where: { id: userId }, data: { passwordHash } });
}
