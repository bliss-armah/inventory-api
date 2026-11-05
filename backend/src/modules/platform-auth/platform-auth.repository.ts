import { prisma } from "../../lib/prisma";
import type { Identifier } from "../../lib/identifier";

export function findByEmail(email: string) {
  return prisma.platformAdmin.findUnique({ where: { email } });
}

export function findByIdentifier(identifier: Identifier) {
  return prisma.platformAdmin.findUnique({
    where:
      identifier.kind === "email"
        ? { email: identifier.email }
        : { phone: identifier.phone },
  });
}

export function updatePhone(id: string, phone: string) {
  return prisma.platformAdmin.update({ where: { id }, data: { phone } });
}

export function findById(id: string) {
  return prisma.platformAdmin.findUnique({ where: { id } });
}

export function updateLastLogin(id: string) {
  return prisma.platformAdmin.update({ where: { id }, data: { lastLoginAt: new Date() } });
}

export function createRefreshToken(input: {
  platformAdminId: string;
  tokenHash: string;
  expiresAt: Date;
}) {
  return prisma.platformAdminRefreshToken.create({ data: input });
}

export function findRefreshTokenByHash(tokenHash: string) {
  return prisma.platformAdminRefreshToken.findUnique({ where: { tokenHash } });
}

export function revokeRefreshToken(id: string) {
  return prisma.platformAdminRefreshToken.update({
    where: { id },
    data: { revokedAt: new Date() },
  });
}

export function revokeAllRefreshTokensForAdmin(platformAdminId: string) {
  return prisma.platformAdminRefreshToken.updateMany({
    where: { platformAdminId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export function create(input: {
  name: string;
  email: string;
  phone?: string;
  passwordHash: string;
}) {
  return prisma.platformAdmin.create({ data: input });
}

export function list() {
  return prisma.platformAdmin.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
}

export function updatePassword(id: string, passwordHash: string) {
  return prisma.platformAdmin.update({ where: { id }, data: { passwordHash } });
}

export function createPasswordResetToken(input: {
  platformAdminId: string;
  tokenHash: string;
  expiresAt: Date;
}) {
  return prisma.platformAdminPasswordResetToken.create({ data: input });
}

export function findPasswordResetTokenByHash(tokenHash: string) {
  return prisma.platformAdminPasswordResetToken.findUnique({ where: { tokenHash } });
}

export function markPasswordResetTokenUsed(id: string) {
  return prisma.platformAdminPasswordResetToken.update({
    where: { id },
    data: { usedAt: new Date() },
  });
}
