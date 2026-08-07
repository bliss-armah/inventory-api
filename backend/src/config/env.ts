import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(5000),
  FRONTEND_URL: z.url(),
  CORS_ORIGINS: z
    .string()
    .transform((value) => value.split(",").map((origin) => origin.trim())),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(16),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL: z.string().default("30d"),
  PASSWORD_RESET_TOKEN_TTL: z.string().default("1h"),
  COOKIE_SECRET: z.string().min(16),
  // Deliberately a separate secret from JWT_ACCESS_SECRET: a platform-admin
  // token must never be verifiable by tenant auth middleware, or vice versa.
  PLATFORM_JWT_ACCESS_SECRET: z.string().min(16),
  PLATFORM_ACCESS_TOKEN_TTL: z.string().default("15m"),
  PLATFORM_REFRESH_TOKEN_TTL: z.string().default("7d"),
  // Two-factor SMS delivery. Optional: when unset, lib/sms.ts falls back to
  // logging the code to the console outside production (and refuses to
  // silently "succeed" in production without a real provider configured).
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),
  OTP_CODE_TTL: z.string().default("10m"),
  PENDING_TWO_FACTOR_AUTH_TTL: z.string().default("10m"),
  REMEMBERED_DEVICE_TTL: z.string().default("30d"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:", z.treeifyError(parsed.error));
  throw new Error("Invalid environment configuration");
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === "production";
