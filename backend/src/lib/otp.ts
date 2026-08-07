import { randomInt } from "node:crypto";

/** Six-digit numeric SMS code, zero-padded (e.g. "042917"). */
export function generateOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

// Excludes visually ambiguous characters (0/O, 1/I) since these are
// hand-typed from a printed/saved list, not pasted.
const BACKUP_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** A single one-time recovery code, e.g. "K7QX9F2M4B". */
export function generateBackupCode(): string {
  return Array.from(
    { length: 10 },
    () => BACKUP_CODE_ALPHABET[randomInt(BACKUP_CODE_ALPHABET.length)],
  ).join("");
}

export function generateBackupCodes(count = 10): string[] {
  return Array.from({ length: count }, () => generateBackupCode());
}

/** Case-insensitive, so a user typing a saved code in lowercase still works. */
export function normalizeBackupCode(code: string): string {
  return code.trim().toUpperCase();
}
