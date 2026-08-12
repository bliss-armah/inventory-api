import { z } from "zod";
import { isPhoneLike, normalizePhone } from "./phone.ts";

export type Identifier =
  | { kind: "email"; email: string }
  | { kind: "phone"; phone: string };

const emailSchema = z.email();

/**
 * Decides whether what the user typed into the single login field is an email
 * address or a phone number, and normalises it for lookup.
 *
 * An "@" is the discriminator: nothing containing one can be a phone number,
 * and every email must have one, so there's no input both branches could
 * claim. Returns null when it's neither — callers treat that exactly like a
 * wrong password rather than saying "that's not a valid email", which would
 * otherwise let someone probe which identifiers are even well-formed.
 */
export function classifyIdentifier(raw: string): Identifier | null {
  const value = raw.trim();

  if (value.includes("@")) {
    const parsed = emailSchema.safeParse(value);
    return parsed.success
      ? { kind: "email", email: value.toLowerCase() }
      : null;
  }

  return isPhoneLike(value)
    ? { kind: "phone", phone: normalizePhone(value) }
    : null;
}
