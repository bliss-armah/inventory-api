import rateLimit from "express-rate-limit";

const rateLimitedResponse = {
  success: false as const,
  message: "Too many attempts. Please try again later.",
};

/** Global backstop against basic abuse/DoS on the whole API. */
export const globalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitedResponse,
});

/**
 * Tight limiter for credential-related endpoints (login, register,
 * forgot/reset password). These are the endpoints where unlimited attempts
 * translate directly into credential stuffing or a bcrypt-cost CPU DoS.
 */
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitedResponse,
});
