import { z } from "zod";

export const platformLoginSchema = z.object({
  email: z.email().toLowerCase(),
  password: z.string().min(1),
});

export const platformForgotPasswordSchema = z.object({
  email: z.email().toLowerCase(),
});

export const platformResetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(72),
});

export const createPlatformAdminSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email().toLowerCase(),
});

export type PlatformLoginInput = z.infer<typeof platformLoginSchema>;
export type PlatformForgotPasswordInput = z.infer<typeof platformForgotPasswordSchema>;
export type PlatformResetPasswordInput = z.infer<typeof platformResetPasswordSchema>;
export type CreatePlatformAdminInput = z.infer<typeof createPlatformAdminSchema>;
