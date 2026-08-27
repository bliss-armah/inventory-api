import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import {
  authenticatePendingLogin,
  authenticateBusinessSelection,
  authenticateAny,
} from "../../middleware/authenticate-pending-login";
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

// Staff invitations. Both are unauthenticated: the token in the URL was mailed
// to the address it belongs to, and is the credential.
authRoutes.get("/invites/:token", authRateLimit, authController.describeInvite);
authRoutes.post("/invites/accept", authRateLimit, authController.acceptInvite);

// Business selection. `authenticateBusinessSelection` accepts only a pending
// login that has already cleared its second factor — a password alone must
// never be enough to learn which businesses an address belongs to.
authRoutes.post(
  "/select-business",
  authRateLimit,
  authenticateBusinessSelection,
  authController.selectBusiness,
);
// Switching once already inside: an ordinary session, re-pointed at another of
// the caller's memberships.
authRoutes.post(
  "/switch-business",
  authenticate,
  authController.switchBusiness,
);

// Two-factor authentication. `authenticatePendingLogin`/`authenticateAny`
// accept the short-lived pending-login bearer token issued by login()/
// register() — never a normal access token for the /verify step, since
// that's specifically the step *before* a real session exists.
authRoutes.post(
  "/2fa/verify",
  authRateLimit,
  authenticatePendingLogin,
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
