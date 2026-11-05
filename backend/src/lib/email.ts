import { env, isProduction } from "../config/env.ts";

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

/**
 * Sends a transactional email through Brevo's REST API (a raw fetch, not the
 * SDK). Falls back to logging outside production when Brevo isn't configured,
 * and treats an unconfigured provider in production as a hard error.
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
