import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { authenticateBusinessSelection } from "../../middleware/authenticate-business-selection";
import { authRateLimit } from "../../middleware/rate-limit";
import * as authController from "./auth.controller";

export const authRoutes = Router();

authRoutes.post("/register", authRateLimit, authController.register);
authRoutes.post("/login", authRateLimit, authController.login);
authRoutes.post("/refresh", authController.refresh);
authRoutes.post("/logout", authController.logout);
authRoutes.post("/reset-password", authRateLimit, authController.resetPassword);
authRoutes.get("/me", authenticate, authController.me);

// Staff invitations. Both are unauthenticated: the token in the URL was mailed
// to the address it belongs to, and is the credential.
authRoutes.get("/invites/:token", authRateLimit, authController.describeInvite);
authRoutes.post("/invites/accept", authRateLimit, authController.acceptInvite);

// Business selection.
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
