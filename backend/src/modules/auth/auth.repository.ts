import { prisma } from "../../lib/prisma.ts";
import { Role } from "../../generated/prisma";
import { normalizePhone } from "../../lib/phone.ts";
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

export function findUserByEmail(email: string) {
  return prisma.user.findUnique({ where: { email } });
}

/**
 * Resolves the single identity a login identifier points at. Both columns are
 * unique on `users`, so either branch matches at most one account — which is
 * what lets phone stand in for email as a login credential. Which *business*
 * that identity is signing into is a separate question, answered from its
 * memberships once the password (and second factor) check out.
 */
export function findUserByIdentifier(identifier: Identifier) {
  return prisma.user.findUnique({
    where:
      identifier.kind === "email"
        ? { email: identifier.email }
        : { phone: identifier.phone },
  });
}

export function findUserByPhone(phone: string) {
  return prisma.user.findUnique({ where: { phone } });
}

export function findUserById(id: string) {
  return prisma.user.findUnique({ where: { id } });
}

/**
 * Registering a business provisions its whole starting workspace atomically:
 * tenant, owner identity, the owner's membership, default "Main Store"
 * location, and default settings. Small businesses never have to configure
 * any of this themselves.
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

    // The business contact number doubles as the owner's login identifier and
    // SMS destination, but only if no other account has claimed it — several
    // businesses legitimately share one number, and users.phone is unique
    // globally because it resolves one identity at login. A skipped claim just
    // means that owner logs in by email.
    const phone = normalizePhone(input.phone);
    const phoneTaken = await tx.user.findUnique({
      where: { phone },
      select: { id: true },
    });

    const owner = await tx.user.create({
      data: {
        name: input.ownerName,
        email: input.email,
        phone: phoneTaken ? null : phone,
        passwordHash,
      },
    });

    const membership = await tx.membership.create({
      data: { userId: owner.id, tenantId: tenant.id, role: Role.OWNER },
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

    return { tenant, owner, membership, location, settings };
  });
}

/**
 * Accepting an invitation for an address that has never signed up: the
 * identity and its membership are created together, so a half-provisioned
 * account can't be left behind by a failure between the two.
 */
export function createUserWithMembership(input: {
  name: string;
  email: string;
  passwordHash: string;
  tenantId: string;
  role: Role;
}) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash: input.passwordHash,
      },
    });
    const membership = await tx.membership.create({
      data: { userId: user.id, tenantId: input.tenantId, role: input.role },
    });
    return { user, membership };
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

/**
 * Scoped revocation, for when one business changes someone's role or
 * deactivates them. Sessions that person holds in *other* businesses are none
 * of this tenant's business and must survive — which is exactly why
 * refresh_tokens kept its tenantId when the other token tables lost theirs.
 */
export function revokeRefreshTokensForUserInTenant(
  userId: string,
  tenantId: string,
) {
  return prisma.refreshToken.updateMany({
    where: { userId, tenantId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export function createPasswordResetToken(input: {
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
