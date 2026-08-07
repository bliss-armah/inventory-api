import { createHash, randomBytes } from "node:crypto";

/**
 * Refresh and password-reset tokens are random opaque strings, not JWTs:
 * the raw value goes to the client while only its hash is persisted, so a
 * leaked database can't be replayed as a valid token.
 */
export function generateOpaqueToken(): string {
  return randomBytes(48).toString("base64url");
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
