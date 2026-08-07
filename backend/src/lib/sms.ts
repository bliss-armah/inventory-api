import { env, isProduction } from "../config/env";

/**
 * Sends an SMS via Twilio's REST API directly (a raw fetch call, not the
 * Twilio SDK — this is the one HTTP request the whole app needs, so pulling
 * in a dependency for it isn't worth it). Falls back to logging the message
 * outside production when Twilio isn't configured, matching how
 * forgot-password already handles "no delivery channel wired up yet" in
 * dev. In production, an unconfigured provider is a hard error rather than
 * a silent no-op — a 2FA code that's never actually delivered must never
 * look like a successful send.
 */
export async function sendSms(to: string, body: string): Promise<void> {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM_NUMBER) {
    if (isProduction) {
      throw new Error("SMS provider is not configured");
    }
    console.info(`[dev] SMS to ${to}: ${body}`);
    return;
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
  const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64");
  const form = new URLSearchParams({ To: to, From: env.TWILIO_FROM_NUMBER, Body: body });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to send SMS: ${response.status} ${text}`);
  }
}
