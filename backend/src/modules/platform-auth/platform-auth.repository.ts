import { prisma } from "../../lib/prisma";

export function findByEmail(email: string) {
  return prisma.platformAdmin.findUnique({ where: { email } });
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
