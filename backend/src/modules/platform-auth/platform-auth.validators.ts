import { z } from "zod";
import { isPhoneLike } from "../../lib/phone.ts";

export const platformLoginSchema = z
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

export const platformResetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(72),
});

export const createPlatformAdminSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email().toLowerCase(),
  phone: z.string().trim().min(7).max(20).refine(isPhoneLike, "Enter a valid phone number").optional(),
});

export type PlatformLoginInput = z.infer<typeof platformLoginSchema>;
export type PlatformResetPasswordInput = z.infer<typeof platformResetPasswordSchema>;
export type CreatePlatformAdminInput = z.infer<typeof createPlatformAdminSchema>;
