import { prisma } from "../../lib/prisma.ts";
import type { PrismaTransactionClient } from "../../lib/transaction.ts";
import { OtpPurpose, OtpChannel } from "../../generated/prisma/enums.ts";

export function findPendingAuthByTokenHash(tokenHash: string) {
  return prisma.pendingTwoFactorAuth.findUnique({ where: { tokenHash } });
}

export function createPendingAuth(input: {
  tenantId: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}) {
  return prisma.pendingTwoFactorAuth.create({ data: input });
}

export function deletePendingAuth(id: string) {
  return prisma.pendingTwoFactorAuth
    .delete({ where: { id } })
    .catch(() => null);
}

/**
 * Only one active challenge per (user, purpose) at a time — starting a new
 * one (re-sending a code) invalidates whatever was sent before, so an old
 * code a user might still have sitting in their messages can't be replayed.
 */
export async function replaceActiveChallenge(input: {
  tenantId: string;
  userId: string;
  purpose: OtpPurpose;
  channel: OtpChannel;
  destination: string;
  codeHash: string;
  expiresAt: Date;
}) {
  return prisma.$transaction(async (tx) => {
    await tx.otpChallenge.deleteMany({
      where: { userId: input.userId, purpose: input.purpose },
    });
    return tx.otpChallenge.create({ data: input });
  });
}

export function findActiveChallenge(userId: string, purpose: OtpPurpose) {
  return prisma.otpChallenge.findFirst({
    where: { userId, purpose, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
}

export function incrementChallengeAttempts(id: string) {
  return prisma.otpChallenge.update({
    where: { id },
    data: { attempts: { increment: 1 } },
  });
}

export function deleteChallenge(id: string) {
  return prisma.otpChallenge.delete({ where: { id } }).catch(() => null);
}

export function findRememberedDeviceByTokenHash(tokenHash: string) {
  return prisma.rememberedDevice.findUnique({ where: { tokenHash } });
}

export function createRememberedDevice(input: {
  tenantId: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}) {
  return prisma.rememberedDevice.create({ data: input });
}

/** Sliding expiry: a device used within its window is never re-prompted. */
export function slideRememberedDevice(id: string, expiresAt: Date) {
  return prisma.rememberedDevice.update({
    where: { id },
    data: { expiresAt, lastUsedAt: new Date() },
  });
}

export function findActiveBackupCodes(userId: string) {
  return prisma.twoFactorBackupCode.findMany({
    where: { userId, usedAt: null },
  });
}

export function createBackupCodesTx(
  tx: PrismaTransactionClient,
  tenantId: string,
  userId: string,
  codeHashes: string[],
) {
  return tx.twoFactorBackupCode.createMany({
    data: codeHashes.map((codeHash) => ({ tenantId, userId, codeHash })),
  });
}

export function deleteUnusedBackupCodesTx(
  tx: PrismaTransactionClient,
  userId: string,
) {
  return tx.twoFactorBackupCode.deleteMany({ where: { userId, usedAt: null } });
}

export function markBackupCodeUsedTx(tx: PrismaTransactionClient, id: string) {
  return tx.twoFactorBackupCode.update({
    where: { id },
    data: { usedAt: new Date() },
  });
}

export function deleteAllRememberedDevicesTx(
  tx: PrismaTransactionClient,
  userId: string,
) {
  return tx.rememberedDevice.deleteMany({ where: { userId } });
}

export function confirmTwoFactorSetupTx(
  tx: PrismaTransactionClient,
  userId: string,
  input: { channel: OtpChannel; phone?: string },
) {
  return tx.user.update({
    where: { id: userId },
    data: {
      ...(input.phone === undefined ? {} : { phone: input.phone }),
      twoFactorChannel: input.channel,
      twoFactorEnabled: true,
      twoFactorConfirmedAt: new Date(),
    },
  });
}

/**
 * Used to reject a phone already claimed by another account before a setup
 * code goes out. Selects only the id — the caller compares identity, and
 * nothing else about a stranger's account should be readable from here.
 */
export function findUserIdByPhone(phone: string) {
  return prisma.user.findUnique({ where: { phone }, select: { id: true } });
}

export function disableTwoFactor(userId: string) {
  return prisma.user.update({
    where: { id: userId },
    data: {
      twoFactorEnabled: false,
      twoFactorConfirmedAt: null,
      twoFactorChannel: null,
    },
  });
}

export { OtpPurpose, OtpChannel };
