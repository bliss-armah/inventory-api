import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { authenticateMfaPending, authenticateAny } from "../../middleware/authenticate-two-factor";
import { authRateLimit } from "../../middleware/rate-limit";
import * as authController from "./auth.controller";

export const authRoutes = Router();

authRoutes.post("/register", authRateLimit, authController.register);
authRoutes.post("/login", authRateLimit, authController.login);
authRoutes.post("/refresh", authController.refresh);
authRoutes.post("/logout", authController.logout);
authRoutes.post("/forgot-password", authRateLimit, authController.forgotPassword);
authRoutes.post("/reset-password", authRateLimit, authController.resetPassword);
authRoutes.get("/me", authenticate, authController.me);

// Two-factor authentication. `authenticateMfaPending`/`authenticateAny`
// accept the short-lived pending-auth bearer token issued by login()/
// register() — never a normal access token for the /verify step, since
// that's specifically the step *before* a real session exists.
authRoutes.post(
  "/2fa/verify",
  authRateLimit,
  authenticateMfaPending,
  authController.verifyTwoFactor,
);
authRoutes.post(
  "/2fa/setup/send-code",
  authRateLimit,
  authenticateAny,
  authController.sendTwoFactorSetupCode,
);
authRoutes.post(
  "/2fa/setup/confirm",
  authRateLimit,
  authenticateAny,
  authController.confirmTwoFactorSetup,
);
authRoutes.post(
  "/2fa/disable",
  authRateLimit,
  authenticate,
  authController.disableTwoFactor,
);
authRoutes.post(
  "/2fa/backup-codes/regenerate",
  authRateLimit,
  authenticate,
  authController.regenerateBackupCodes,
);
