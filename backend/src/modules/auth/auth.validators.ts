import { z } from "zod";

export const registerSchema = z.object({
  businessName: z.string().trim().min(2).max(120),
  ownerName: z.string().trim().min(2).max(120),
  email: z.email().toLowerCase(),
  phone: z.string().trim().min(7).max(20),
  password: z.string().min(8).max(72),
  country: z.string().trim().min(2).max(60),
  timeZone: z.string().trim().min(1).max(60),
});

/**
 * One field for both login identifiers — an email address or a phone number.
 * Which one it is gets decided by lib/identifier.ts, not here, so that a
 * malformed identifier fails as "invalid credentials" rather than as a
 * validation error naming the format we expected.
 *
 * `email` is still accepted as an alias so clients written against the
 * email-only login keep working; `identifier` wins when both are sent.
 */
export const loginSchema = z
  .object({
    identifier: z.string().trim().min(1).max(254).optional(),
    email: z.string().trim().min(1).max(254).optional(),
    password: z.string().min(1),
  })
  .refine((value) => Boolean(value.identifier ?? value.email), {
    message: "Provide an email address or phone number",
    path: ["identifier"],
  })
  .transform((value) => ({
    identifier: (value.identifier ?? value.email) as string,
    password: value.password,
  }));

export const forgotPasswordSchema = z.object({
  email: z.email().toLowerCase(),
});

export const selectBusinessSchema = z.object({
  tenantId: z.string().min(1),
});

/**
 * `name` is only read when the invited address has no account yet — for one
 * that does, the name already on the identity wins, because an owner in one
 * business has no business renaming a person in another.
 */
export const acceptInviteSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(72),
  name: z.string().trim().min(2).max(120).optional(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(72),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type SelectBusinessInput = z.infer<typeof selectBusinessSchema>;
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
