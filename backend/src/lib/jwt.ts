import jwt from "jsonwebtoken";
import { env } from "../config/env.ts";
import type { Role } from "../generated/prisma/enums.ts";

export type AccessTokenPayload = {
  type: "tenant_user";
  sub: string;
  tenantId: string;
  role: Role;
};

export function signAccessToken(
  payload: Omit<AccessTokenPayload, "type">,
): string {
  return jwt.sign(
    { ...payload, type: "tenant_user" } satisfies AccessTokenPayload,
    env.JWT_ACCESS_SECRET,
    {
      expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions["expiresIn"],
      algorithm: "HS256",
    },
  );
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
    algorithms: ["HS256"],
  }) as AccessTokenPayload & jwt.JwtPayload;
  if (payload.type !== "tenant_user") {
    throw new Error("Not a tenant access token");
  }
  return payload;
}

// ---------------------------------------------------------------------------
// Platform admin tokens: signed with a different secret (see config/env.ts)
// and carry a distinct `type` discriminator, so neither a bug nor a stolen
// tenant token can ever be accepted as a platform-admin token, or vice versa.
// ---------------------------------------------------------------------------

export type PlatformAccessTokenPayload = {
  type: "platform_admin";
  sub: string;
};

export function signPlatformAccessToken(
  payload: Omit<PlatformAccessTokenPayload, "type">,
): string {
  return jwt.sign(
    { ...payload, type: "platform_admin" } satisfies PlatformAccessTokenPayload,
    env.PLATFORM_JWT_ACCESS_SECRET,
    {
      expiresIn: env.PLATFORM_ACCESS_TOKEN_TTL as jwt.SignOptions["expiresIn"],
      algorithm: "HS256",
    },
  );
}

export function verifyPlatformAccessToken(
  token: string,
): PlatformAccessTokenPayload {
  const payload = jwt.verify(token, env.PLATFORM_JWT_ACCESS_SECRET, {
    algorithms: ["HS256"],
  }) as PlatformAccessTokenPayload & jwt.JwtPayload;
  if (payload.type !== "platform_admin") {
    throw new Error("Not a platform admin access token");
  }
  return payload;
}
