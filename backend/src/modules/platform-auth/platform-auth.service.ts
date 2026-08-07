import ms from "ms";
import { env } from "../../config/env";
import { signPlatformAccessToken } from "../../lib/jwt";
import { verifyPassword, verifyPasswordTimingSafeNoop } from "../../lib/password";
import { generateOpaqueToken, hashOpaqueToken } from "../../lib/tokens";
import { UnauthorizedError } from "../../shared/errors";
import * as platformAuthRepository from "./platform-auth.repository";
import type { PlatformLoginInput } from "./platform-auth.validators";

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
