/**
 * Strips the formatting people type but providers don't want — spaces,
 * hyphens, parentheses, dots — while preserving a leading `+`.
 *
 * The point is not to validate or canonicalise into E.164 (that needs a real
 * phone-number library and per-country dialling rules). It's to make the
 * *same* input normalise the *same* way everywhere, so a number saved during
 * 2FA setup as "+233 20 000 0000" still matches a login typed as
 * "+233-20-000-0000". Setup and lookup both go through here, so they agree.
 */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/[^\d]/g, "");
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

/** A normalized phone: 7–20 digits, optionally `+`-prefixed. */
export function isPhoneLike(value: string): boolean {
  return /^\+?\d{7,20}$/.test(normalizePhone(value));
}
