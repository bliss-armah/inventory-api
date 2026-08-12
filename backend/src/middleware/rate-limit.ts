import rateLimit from "express-rate-limit";
import { env } from "../config/env.ts";

const rateLimitedResponse = {
  success: false as const,
  message: "Too many attempts. Please try again later.",
};

// The test suite runs many real requests against one long-lived Express app
// instance per process (no restart between tests), all from the same
// in-process "IP" — sharing this in-memory counter with production/dev
// traffic would make unrelated test files bleed into each other's limits
// and turn flaky at 10 requests. Rate limiting itself isn't what these
// functional suites are testing (a dedicated test would exercise it
// directly), so skip enforcement in NODE_ENV=test rather than mocking the
// module out.
const skipInTests = () => env.NODE_ENV === "test";

/** Global backstop against basic abuse/DoS on the whole API. */
export const globalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitedResponse,
  skip: skipInTests,
});

/**
 * Tight limiter for credential-related endpoints (login, register,
 * forgot/reset password, 2FA verify/setup). These are the endpoints where
 * unlimited attempts translate directly into credential stuffing, an SMS
 * cost-abuse vector, or a bcrypt-cost CPU DoS.
 */
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitedResponse,
  skip: skipInTests,
});
