import { env, isProduction } from "../config/env.ts";

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

/**
 * Sends a transactional email through Brevo's REST API (a raw fetch, not the
 * SDK — this and lib/sms.ts are the only outbound HTTP calls the app makes,
 * so a dependency isn't worth it). Mirrors lib/sms.ts exactly: falls back to
 * logging outside production when Brevo isn't configured, and treats an
 * unconfigured provider in production as a hard error — a verification code
 * that was never actually delivered must never look like a successful send.
 */
export async function sendEmail(
  to: string,
  subject: string,
  body: string,
): Promise<void> {
  if (!env.BREVO_API_KEY || !env.BREVO_SENDER_EMAIL) {
    if (isProduction) {
      throw new Error("Email provider is not configured");
    }
    // Body only, not the subject too — for an OTP the two restate each other,
    // and this line exists to be skimmed for the code.
    console.info(`[dev] Email to ${to}: ${body}`);
    return;
  }

  const response = await fetch(BREVO_ENDPOINT, {
    method: "POST",
    headers: {
      "api-key": env.BREVO_API_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      sender: { email: env.BREVO_SENDER_EMAIL, name: env.BREVO_SENDER_NAME },
      to: [{ email: to }],
      subject,
      textContent: body,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to send email: ${response.status} ${text}`);
  }
}
