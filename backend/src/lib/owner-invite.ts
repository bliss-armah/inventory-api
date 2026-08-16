import ms from "ms";
import { env } from "../config/env.ts";
import { sendEmail } from "./email.ts";
import { generateOpaqueToken, hashOpaqueToken } from "./tokens.ts";
import * as authRepository from "../modules/auth/auth.repository.ts";

const SUBJECT = "Your Inventory Manager account is ready";

/**
 * An owner invite is deliberately the same object as a password reset: in both
 * cases someone is setting a password they do not currently have. Only the
 * lifetime and the wording differ, so there is no second token table to keep
 * correct, and /auth/reset-password already knows how to consume it.
 *
 * sendEmail logs to the console instead of sending when Brevo is unconfigured
 * outside production, so this is exercisable locally without a mail provider —
 * and is a hard error in production, so an invite that was never delivered can
 * never be mistaken for a successful onboarding.
 */
export async function sendOwnerInvite(input: {
  tenantId: string;
  userId: string;
  email: string;
  businessName: string;
}): Promise<void> {
  const token = generateOpaqueToken();

  await authRepository.createPasswordResetToken({
    tenantId: input.tenantId,
    userId: input.userId,
    tokenHash: hashOpaqueToken(token),
    expiresAt: new Date(Date.now() + ms(env.OWNER_INVITE_TTL as ms.StringValue)),
  });

  // Only the hash is stored, so this is the one moment the raw token exists.
  const link = `${env.FRONTEND_URL}/reset-password?token=${token}`;

  await sendEmail(
    input.email,
    SUBJECT,
    `${input.businessName} has been set up on Inventory Manager. Set your password to sign in: ${link}`,
  );
}
