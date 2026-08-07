import { z } from "zod";

export const sendSetupCodeSchema = z.object({
  phone: z.string().trim().min(7).max(20),
});

export const confirmSetupSchema = z.object({
  code: z.string().trim().length(6),
});

export const verifyLoginSchema = z
  .object({
    code: z.string().trim().length(6).optional(),
    backupCode: z.string().trim().min(8).max(12).optional(),
    rememberDevice: z.boolean().default(false),
  })
  .refine((data) => Boolean(data.code) !== Boolean(data.backupCode), {
    message: "Provide either a code or a backupCode, not both",
    path: ["code"],
  });

export const disableTwoFactorSchema = z.object({
  password: z.string().min(1),
});

export type SendSetupCodeInput = z.infer<typeof sendSetupCodeSchema>;
export type ConfirmSetupInput = z.infer<typeof confirmSetupSchema>;
export type VerifyLoginInput = z.infer<typeof verifyLoginSchema>;
export type DisableTwoFactorInput = z.infer<typeof disableTwoFactorSchema>;
