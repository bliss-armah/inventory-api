import ms from "ms";
import { env } from "../../config/env";
import { signPlatformAccessToken } from "../../lib/jwt";
import { hashPassword, verifyPassword, verifyPasswordTimingSafeNoop } from "../../lib/password";
import { randomUUID } from "node:crypto";
import { generateOpaqueToken, hashOpaqueToken } from "../../lib/tokens";
import { BadRequestError, ConflictError, UnauthorizedError } from "../../shared/errors";
import { withUniqueConstraint } from "../../shared/prisma-errors";
import { sendEmail } from "../../lib/email";
import * as platformAuthRepository from "./platform-auth.repository";
import type {
  CreatePlatformAdminInput,
  PlatformForgotPasswordInput,
  PlatformLoginInput,
  PlatformResetPasswordInput,
} from "./platform-auth.validators";

export type PlatformAdminSummary = {
  id: string;
  name: string;
  email: string;
};

export type PlatformAuthResult = {
  admin: PlatformAdminSummary;
  accessToken: string;
  refreshToken: string;
};

function toSummary(admin: { id: string; name: string; email: string }): PlatformAdminSummary {
  return { id: admin.id, name: admin.name, email: admin.email };
}

async function issueSession(admin: {
  id: string;
  name: string;
  email: string;
}): Promise<PlatformAuthResult> {
  const accessToken = signPlatformAccessToken({ sub: admin.id });

  const refreshToken = generateOpaqueToken();
  await platformAuthRepository.createRefreshToken({
    platformAdminId: admin.id,
    tokenHash: hashOpaqueToken(refreshToken),
    expiresAt: new Date(Date.now() + ms(env.PLATFORM_REFRESH_TOKEN_TTL as ms.StringValue)),
  });

  return { admin: toSummary(admin), accessToken, refreshToken };
}

export async function login(input: PlatformLoginInput): Promise<PlatformAuthResult> {
  const admin = await platformAuthRepository.findByEmail(input.email);
  if (!admin || !admin.isActive) {
    await verifyPasswordTimingSafeNoop(input.password);
    throw new UnauthorizedError("Invalid email or password");
  }

  const validPassword = await verifyPassword(input.password, admin.passwordHash);
  if (!validPassword) {
    throw new UnauthorizedError("Invalid email or password");
  }

  await platformAuthRepository.updateLastLogin(admin.id);
  return issueSession(admin);
}

export async function refresh(refreshToken: string): Promise<PlatformAuthResult> {
  const tokenHash = hashOpaqueToken(refreshToken);
  const stored = await platformAuthRepository.findRefreshTokenByHash(tokenHash);

  if (!stored) {
    throw new UnauthorizedError("Invalid or expired refresh token");
  }

  if (stored.revokedAt) {
    await platformAuthRepository.revokeAllRefreshTokensForAdmin(stored.platformAdminId);
    throw new UnauthorizedError("Invalid or expired refresh token");
  }

  if (stored.expiresAt < new Date()) {
    throw new UnauthorizedError("Invalid or expired refresh token");
  }

  const admin = await platformAuthRepository.findById(stored.platformAdminId);
  if (!admin || !admin.isActive) {
    throw new UnauthorizedError("Invalid or expired refresh token");
  }

  await platformAuthRepository.revokeRefreshToken(stored.id);
  return issueSession(admin);
}

export async function logout(refreshToken: string): Promise<void> {
  const stored = await platformAuthRepository.findRefreshTokenByHash(
    hashOpaqueToken(refreshToken),
  );
  if (stored && !stored.revokedAt) {
    await platformAuthRepository.revokeRefreshToken(stored.id);
  }
}

export async function me(id: string): Promise<PlatformAdminSummary> {
  const admin = await platformAuthRepository.findById(id);
  if (!admin) {
    throw new UnauthorizedError();
  }
  return toSummary(admin);
}

const RESET_SUBJECT = "Reset your Inventory Manager platform password";
const INVITE_SUBJECT = "Your Inventory Manager platform account is ready";

function resetLink(token: string): string {
  return `${env.FRONTEND_URL}/platform/reset-password?token=${token}`;
}

async function issueResetToken(platformAdminId: string, ttl: string): Promise<string> {
  const token = generateOpaqueToken();
  await platformAuthRepository.createPasswordResetToken({
    platformAdminId,
    tokenHash: hashOpaqueToken(token),
    expiresAt: new Date(Date.now() + ms(ttl as ms.StringValue)),
  });
  return token;
}

export async function forgotPassword(input: PlatformForgotPasswordInput): Promise<void> {
  const admin = await platformAuthRepository.findByEmail(input.email);
  if (!admin || !admin.isActive) return;

  const token = await issueResetToken(admin.id, env.PASSWORD_RESET_TOKEN_TTL);

  try {
    await sendEmail(
      admin.email,
      RESET_SUBJECT,
      `Someone asked to reset the password for your Inventory Manager platform account. Set a new one here: ${resetLink(token)}\n\nThis link expires in ${ms(ms(env.PASSWORD_RESET_TOKEN_TTL as ms.StringValue), { long: true })} and can only be used once. If this wasn't you, ignore this email — your password stays unchanged.`,
    );
  } catch (error) {
    console.error(
      `Failed to send platform reset email to ${admin.email}: ${(error as Error).message}`,
    );
  }
}

export async function resetPassword(input: PlatformResetPasswordInput): Promise<void> {
  const stored = await platformAuthRepository.findPasswordResetTokenByHash(
    hashOpaqueToken(input.token),
  );

  if (!stored || stored.usedAt || stored.expiresAt < new Date()) {
    throw new BadRequestError("Invalid or expired reset token");
  }

  await platformAuthRepository.updatePassword(
    stored.platformAdminId,
    await hashPassword(input.password),
  );
  await platformAuthRepository.markPasswordResetTokenUsed(stored.id);
  await platformAuthRepository.revokeAllRefreshTokensForAdmin(stored.platformAdminId);
}

export async function createAdmin(input: CreatePlatformAdminInput) {
  const existing = await platformAuthRepository.findByEmail(input.email);
  if (existing) {
    throw new ConflictError("A platform admin with this email already exists", {
      email: ["A platform admin with this email already exists"],
    });
  }

  const unusablePasswordHash = await hashPassword(randomUUID());
  const admin = await withUniqueConstraint(
    () =>
      platformAuthRepository.create({
        name: input.name,
        email: input.email,
        passwordHash: unusablePasswordHash,
      }),
    { field: "email", message: "A platform admin with this email already exists" },
  );

  const token = await issueResetToken(admin.id, env.OWNER_INVITE_TTL);
  await sendEmail(
    admin.email,
    INVITE_SUBJECT,
    `You have been given platform administrator access to Inventory Manager. Set your password to sign in: ${resetLink(token)}`,
  );

  return toSummary(admin);
}

export function listAdmins() {
  return platformAuthRepository.list();
}
