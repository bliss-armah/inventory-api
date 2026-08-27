import { z } from "zod";
import { resolveDatabaseUrl } from "./database-url.ts";

export { ENV_FILE } from "./database-url.ts";

// Loads the single server/.env and fills in DATABASE_URL (derived from
// POSTGRES_* unless set explicitly) before the schema below validates it.
const databaseUrl = resolveDatabaseUrl();
if (databaseUrl) {
  process.env.DATABASE_URL = databaseUrl;
}

/**
 * Treats a blank var as absent. `FOO=` in a .env file is how you write "not
 * configured yet" — without this, an empty string reaches the validator as a
 * real value and fails formats like z.email(), or silently overrides a
 * .default() with "".
 */
function blank<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => (value === "" ? undefined : value), schema);
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(5000),
  FRONTEND_URL: z.url(),
  CORS_ORIGINS: z
    .string()
    .transform((value) => value.split(",").map((origin) => origin.trim())),
  // Businesses are onboarded by a platform admin, so self-service signup is
  // off unless deliberately enabled. Deliberately not z.coerce.boolean():
  // coercion reads the string "false" as truthy, which would quietly leave
  // signup wide open — the exact opposite of what this setting is for.
  ALLOW_PUBLIC_REGISTRATION: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(16),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL: z.string().default("30d"),
  PASSWORD_RESET_TOKEN_TTL: z.string().default("1h"),
  // An owner invite is a password-set link, so it reuses PasswordResetToken —
  // but it has to survive an onboarding conversation and an unread inbox, not
  // a five-minute "I forgot my password" round trip.
  OWNER_INVITE_TTL: z.string().default("7d"),
  COOKIE_SECRET: z.string().min(16),
  // Deliberately a separate secret from JWT_ACCESS_SECRET: a platform-admin
  // token must never be verifiable by tenant auth middleware, or vice versa.
  PLATFORM_JWT_ACCESS_SECRET: z.string().min(16),
  PLATFORM_ACCESS_TOKEN_TTL: z.string().default("15m"),
  PLATFORM_REFRESH_TOKEN_TTL: z.string().default("7d"),
  // Two-factor code delivery — Brevo for email, Vynfy for SMS. All optional:
  // when a channel's credentials are unset, lib/email.ts / lib/sms.ts fall
  // back to logging the code to the console outside production (and refuse to
  // silently "succeed" in production without a real provider configured).
  BREVO_API_KEY: blank(z.string().optional()),
  BREVO_SENDER_EMAIL: blank(z.email().optional()),
  BREVO_SENDER_NAME: blank(z.string().default("Inventory Manager")),
  VYNFY_API_KEY: blank(z.string().optional()),
  VYNFY_SENDER_ID: blank(z.string().optional()),
  VYNFY_BASE_URL: blank(z.string().default("https://sms.vynfy.com")),
  VYNFY_SEND_PATH: blank(z.string().default("/api/v1/send")),
  // Cloudflare R2, addressed with the S3 API. All optional: when unset,
  // lib/image-store.ts writes to local disk outside production and refuses to
  // start in production, the same contract lib/email.ts uses for Brevo.
  R2_ACCOUNT_ID: blank(z.string().optional()),
  R2_ACCESS_KEY_ID: blank(z.string().optional()),
  R2_SECRET_ACCESS_KEY: blank(z.string().optional()),
  R2_BUCKET: blank(z.string().optional()),
  R2_PUBLIC_BASE_URL: blank(z.url().optional()),
  // Overrides the derived R2 endpoint. Set it to run against MinIO locally or
  // any other S3-compatible store; path-style addressing turns on with it,
  // which is what self-hosted servers expect.
  R2_ENDPOINT: blank(z.url().optional()),
  OTP_CODE_TTL: z.string().default("10m"),
  PENDING_TWO_FACTOR_AUTH_TTL: z.string().default("10m"),
  REMEMBERED_DEVICE_TTL: z.string().default("30d"),
  // Long by comparison with the other opaque tokens because the recipient is a
  // person who has to find the email, not a client mid-handshake.
  STAFF_INVITE_TTL: z.string().default("7d"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:", z.treeifyError(parsed.error));
  throw new Error("Invalid environment configuration");
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === "production";
