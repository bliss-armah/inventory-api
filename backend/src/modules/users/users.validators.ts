import { z } from "zod";
import { Role } from "../../generated/prisma";
import { isPhoneLike, normalizePhone } from "../../lib/phone.ts";

/**
 * `phone` is optional but doubles as a login identifier and as the SMS
 * destination for that account's login codes, so a staff member without one
 * simply gets their codes by email instead.
 */
const phoneField = z
  .string()
  .trim()
  .refine(isPhoneLike, "Enter a valid phone number")
  .transform(normalizePhone);

export const createUserSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email().toLowerCase(),
  phone: phoneField.optional(),
  password: z.string().min(8).max(72),
  role: z.enum(Role),
});

export const updateUserSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phone: phoneField.nullish(),
  role: z.enum(Role).optional(),
  isActive: z.boolean().optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
