import { z } from "zod";
import { OtpChannel } from "../../generated/prisma/enums.ts";

/**
 * Where to send the setup code. SMS needs a phone number to verify; EMAIL
 * doesn't take one — it always goes to the address already on the account,
 * which is itself a login identifier, so letting a caller nominate an
 * arbitrary address here would let them attach someone else's inbox as their
 * second factor.
 */
export const sendSetupCodeSchema = z.discriminatedUnion("channel", [
  z.object({
    channel: z.literal(OtpChannel.SMS),
    phone: z.string().trim().min(7).max(20),
  }),
  z.object({
    channel: z.literal(OtpChannel.EMAIL),
  }),
]);

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
