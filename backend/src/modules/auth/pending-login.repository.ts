import { prisma } from "../../lib/prisma.ts";

export function findPendingLoginByTokenHash(tokenHash: string) {
  return prisma.pendingLogin.findUnique({ where: { tokenHash } });
}

export function createPendingLogin(input: {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}) {
  return prisma.pendingLogin.create({ data: input });
}

export function deletePendingLogin(id: string) {
  return prisma.pendingLogin.delete({ where: { id } }).catch(() => null);
}
