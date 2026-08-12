import ms from "ms";
import { prisma } from "../../lib/prisma.ts";
import { env } from "../../config/env.ts";
import { generateOpaqueToken, hashOpaqueToken } from "../../lib/tokens.ts";
import {
  generateOtpCode,
  generateBackupCodes,
  normalizeBackupCode,
} from "../../lib/otp.ts";
import { deliverOtp } from "../../lib/otp-delivery.ts";
import { normalizePhone } from "../../lib/phone.ts";
import { logActivity } from "../../lib/activity-logger.ts";
import {
  BadRequestError,
  ConflictError,
  UnauthorizedError,
} from "../../shared/errors.ts";
import { Role, OtpPurpose, OtpChannel } from "../../generated/prisma/enums.ts";
import * as twoFactorAuthRepository from "./two-factor-auth.repository.ts";

const MAX_OTP_ATTEMPTS = 5;

export type TwoFactorUser = {
  id: string;
  tenantId: string;
  role: Role;
  email: string;
  phone: string | null;
  twoFactorEnabled: boolean;
  twoFactorConfirmedAt: Date | null;
  twoFactorChannel: OtpChannel | null;
};

/**
 * The destination a confirmed second factor points at. EMAIL always resolves
 * to the account's own address rather than a stored copy, so a change of email
 * can't leave codes going to the old one.
 */
function confirmedDestination(user: TwoFactorUser): string | null {
  if (!user.twoFactorConfirmedAt) return null;
  if (user.twoFactorChannel === OtpChannel.EMAIL) return user.email;
  if (user.twoFactorChannel === OtpChannel.SMS) return user.phone;
  return null;
}

/** OWNER can't opt out — every other role is opt-in via twoFactorEnabled. */
export function requiresTwoFactor(
  user: Pick<TwoFactorUser, "role" | "twoFactorEnabled">,
): boolean {
  return user.role === Role.OWNER || user.twoFactorEnabled;
}

async function sendOtpChallenge(
  tenantId: string,
  userId: string,
  channel: OtpChannel,
  destination: string,
  purpose: OtpPurpose,
) {
  const code = generateOtpCode();
  const ttl = ms(env.OTP_CODE_TTL as ms.StringValue);
  const expiresAt = new Date(Date.now() + ttl);
  await twoFactorAuthRepository.replaceActiveChallenge({
    tenantId,
    userId,
    purpose,
    channel,
    destination,
    codeHash: hashOpaqueToken(code),
    expiresAt,
  });
  await deliverOtp({
    channel,
    destination,
    code,
    minutes: Math.round(ttl / 60_000),
  });
}

/**
 * Called right after a password check succeeds for a user who needs 2FA
 * and has no valid remembered device. Issues the short-lived bearer token
 * for the rest of the flow, and — if the user already has a confirmed
 * channel — sends the login code immediately, so the client never has to
 * make a separate "please send me a code" call for the common case.
 *
 * `channel` comes back with `otp_required` so the client can tell the user
 * where to look without having to guess.
 */
export async function beginTwoFactorFlow(user: TwoFactorUser): Promise<
  | { status: "otp_required"; mfaToken: string; channel: OtpChannel }
  | { status: "setup_required"; mfaToken: string }
> {
  const mfaToken = generateOpaqueToken();
  const expiresAt = new Date(
    Date.now() + ms(env.PENDING_TWO_FACTOR_AUTH_TTL as ms.StringValue),
  );
  await twoFactorAuthRepository.createPendingAuth({
    tenantId: user.tenantId,
    userId: user.id,
    tokenHash: hashOpaqueToken(mfaToken),
    expiresAt,
  });

  const destination = confirmedDestination(user);
  if (destination && user.twoFactorChannel) {
    await sendOtpChallenge(
      user.tenantId,
      user.id,
      user.twoFactorChannel,
      destination,
      OtpPurpose.LOGIN,
    );
    return {
      status: "otp_required",
      mfaToken,
      channel: user.twoFactorChannel,
    };
  }

  return { status: "setup_required", mfaToken };
}

export async function findValidRememberedDevice(
  userId: string,
  rawToken: string,
) {
  const device = await twoFactorAuthRepository.findRememberedDeviceByTokenHash(
    hashOpaqueToken(rawToken),
  );
  if (!device || device.userId !== userId || device.expiresAt < new Date()) {
    return null;
  }
  return device;
}

export function slideRememberedDevice(id: string) {
  const expiresAt = new Date(
    Date.now() + ms(env.REMEMBERED_DEVICE_TTL as ms.StringValue),
  );
  return twoFactorAuthRepository.slideRememberedDevice(id, expiresAt);
}

export async function createRememberedDevice(tenantId: string, userId: string) {
  const token = generateOpaqueToken();
  const expiresAt = new Date(
    Date.now() + ms(env.REMEMBERED_DEVICE_TTL as ms.StringValue),
  );
  await twoFactorAuthRepository.createRememberedDevice({
    tenantId,
    userId,
    tokenHash: hashOpaqueToken(token),
    expiresAt,
  });
  return token;
}

/**
 * Sends the code that verifies a destination during setup. For SMS the phone
 * is claimed here rather than at confirm time: it's a unique login identifier,
 * so a number already attached to another account has to be rejected up front
 * instead of surfacing as a constraint violation after the user has already
 * received and typed a code.
 */
export async function sendSetupCode(
  user: { id: string; tenantId: string; email: string },
  input:
    | { channel: typeof OtpChannel.SMS; phone: string }
    | { channel: typeof OtpChannel.EMAIL },
) {
  if (input.channel === OtpChannel.EMAIL) {
    await sendOtpChallenge(
      user.tenantId,
      user.id,
      OtpChannel.EMAIL,
      user.email,
      OtpPurpose.SETUP,
    );
    return;
  }

  const phone = normalizePhone(input.phone);
  const owner = await twoFactorAuthRepository.findUserIdByPhone(phone);
  if (owner && owner.id !== user.id) {
    throw new ConflictError("That phone number is already in use", {
      phone: ["That phone number is already in use"],
    });
  }

  await sendOtpChallenge(
    user.tenantId,
    user.id,
    OtpChannel.SMS,
    phone,
    OtpPurpose.SETUP,
  );
}

/**
 * Shared by both the OTP-required login path and setup-confirmation:
 * checks the challenge, rate-limits wrong guesses per-challenge (not just
 * per-IP — someone with the right IP but no phone shouldn't get unlimited
 * tries), and burns the challenge on either a correct guess or attempt
 * exhaustion so it can't be probed indefinitely.
 */
async function consumeChallenge(
  userId: string,
  purpose: OtpPurpose,
  code: string,
) {
  const challenge = await twoFactorAuthRepository.findActiveChallenge(
    userId,
    purpose,
  );
  if (!challenge) {
    throw new BadRequestError(
      "No verification code is pending — request a new one.",
    );
  }
  if (challenge.attempts >= MAX_OTP_ATTEMPTS) {
    await twoFactorAuthRepository.deleteChallenge(challenge.id);
    throw new BadRequestError(
      "Too many incorrect attempts — request a new code.",
    );
  }
  if (hashOpaqueToken(code) !== challenge.codeHash) {
    await twoFactorAuthRepository.incrementChallengeAttempts(challenge.id);
    throw new UnauthorizedError("Incorrect code");
  }
  await twoFactorAuthRepository.deleteChallenge(challenge.id);
  return challenge;
}

export async function confirmSetup(
  tenantId: string,
  userId: string,
  code: string,
) {
  const challenge = await consumeChallenge(userId, OtpPurpose.SETUP, code);
  const backupCodes = generateBackupCodes();

  await prisma.$transaction(async (tx) => {
    await twoFactorAuthRepository.confirmTwoFactorSetupTx(tx, userId, {
      channel: challenge.channel,
      // Only an SMS setup establishes a phone number. An email setup must not
      // touch it — the address it verified is already on the account.
      phone:
        challenge.channel === OtpChannel.SMS ? challenge.destination : undefined,
    });
    await twoFactorAuthRepository.createBackupCodesTx(
      tx,
      tenantId,
      userId,
      backupCodes.map((raw) => hashOpaqueToken(raw)),
    );
  });

  await logActivity({
    tenantId,
    userId,
    action: "TWO_FACTOR_ENABLED",
    description: "Two-factor authentication enabled",
  });

  return { backupCodes };
}

/** Verifies a login OTP or backup code. Throws on failure; returns nothing on success. */
export async function verifyLogin(input: {
  userId: string;
  code?: string;
  backupCode?: string;
}) {
  if (input.backupCode) {
    const codes = await twoFactorAuthRepository.findActiveBackupCodes(
      input.userId,
    );
    const normalized = normalizeBackupCode(input.backupCode);
    const match = codes.find(
      (entry) => entry.codeHash === hashOpaqueToken(normalized),
    );
    if (!match) {
      throw new UnauthorizedError("Incorrect backup code");
    }
    await prisma.$transaction((tx) =>
      twoFactorAuthRepository.markBackupCodeUsedTx(tx, match.id),
    );
    return;
  }

  await consumeChallenge(input.userId, OtpPurpose.LOGIN, input.code!);
}

export async function disable(tenantId: string, userId: string) {
  await prisma.$transaction(async (tx) => {
    await twoFactorAuthRepository.deleteUnusedBackupCodesTx(tx, userId);
    await twoFactorAuthRepository.deleteAllRememberedDevicesTx(tx, userId);
  });
  await twoFactorAuthRepository.disableTwoFactor(userId);

  await logActivity({
    tenantId,
    userId,
    action: "TWO_FACTOR_DISABLED",
    description: "Two-factor authentication disabled",
  });
}

export async function regenerateBackupCodes(tenantId: string, userId: string) {
  const backupCodes = generateBackupCodes();
  await prisma.$transaction(async (tx) => {
    await twoFactorAuthRepository.deleteUnusedBackupCodesTx(tx, userId);
    await twoFactorAuthRepository.createBackupCodesTx(
      tx,
      tenantId,
      userId,
      backupCodes.map((raw) => hashOpaqueToken(raw)),
    );
  });

  await logActivity({
    tenantId,
    userId,
    action: "TWO_FACTOR_BACKUP_CODES_REGENERATED",
    description: "Two-factor backup codes regenerated",
  });

  return { backupCodes };
}
