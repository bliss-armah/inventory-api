import { env, isProduction } from "../config/env.ts";

/** Vynfy answers 200 with `success: false` for rejected sends, so the
 * envelope has to be read even on an OK status. */
type VynfyResponse = {
  success?: boolean;
  message?: string;
  error?: string;
  data?: { job_id?: string };
};

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Sends an SMS via Vynfy's REST API (a raw fetch call, not a vendor SDK —
 * this and lib/email.ts are the only outbound HTTP calls the app makes, so
 * pulling in a dependency isn't worth it). Falls back to logging the message
 * outside production when Vynfy isn't configured, matching how lib/email.ts
 * handles the same case. In production, an unconfigured provider is a hard
 * error rather than a silent no-op — a 2FA code that's never actually
 * delivered must never look like a successful send.
 *
 * The request shape is Vynfy's documented one: `X-API-Key` rather than a
 * bearer token, `recipients` as an array, and a `{ success, data.job_id }`
 * envelope that reports rejection inside a 200 response. Base URL and path
 * stay env-driven (VYNFY_BASE_URL / VYNFY_SEND_PATH) so a future endpoint
 * change is config rather than a code change.
 */
export async function sendSms(to: string, body: string): Promise<void> {
  if (!env.VYNFY_API_KEY || !env.VYNFY_SENDER_ID) {
    if (isProduction) {
      throw new Error("SMS provider is not configured");
    }
    console.info(`[dev] SMS to ${to}: ${body}`);
    return;
  }

  const url = `${env.VYNFY_BASE_URL.replace(/\/+$/, "")}/${env.VYNFY_SEND_PATH.replace(/^\/+/, "")}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "X-API-Key": env.VYNFY_API_KEY,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        sender: env.VYNFY_SENDER_ID,
        message: body,
        recipients: [to],
      }),
      // fetch has no default timeout, and this call sits inside the login
      // request — an unresponsive provider would otherwise hang the user's
      // login rather than failing it.
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // Covers both the abort above and outright connection failures. The
    // message is deliberately provider-shaped rather than the raw cause,
    // which callers surface as "couldn't send your code".
    throw new Error(`Failed to send SMS: ${(error as Error).message}`);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to send SMS: ${response.status} ${text}`);
  }

  const payload = (await response.json().catch(() => null)) as VynfyResponse | null;
  if (!payload?.success) {
    throw new Error(
      `Failed to send SMS: ${payload?.message ?? payload?.error ?? "Vynfy request did not succeed"}`,
    );
  }
}
