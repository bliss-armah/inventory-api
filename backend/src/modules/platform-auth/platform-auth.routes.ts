import { Router } from "express";
import { authenticatePlatformAdmin } from "../../middleware/authenticate-platform-admin";
import { authRateLimit } from "../../middleware/rate-limit";
import * as platformAuthController from "./platform-auth.controller";

export const platformAuthRoutes = Router();

platformAuthRoutes.post("/login", authRateLimit, platformAuthController.login);
platformAuthRoutes.post("/refresh", platformAuthController.refresh);
platformAuthRoutes.post("/logout", platformAuthController.logout);
platformAuthRoutes.post(
  "/forgot-password",
  authRateLimit,
  platformAuthController.forgotPassword,
);
platformAuthRoutes.post(
  "/reset-password",
  authRateLimit,
  platformAuthController.resetPassword,
);
platformAuthRoutes.get("/me", authenticatePlatformAdmin, platformAuthController.me);
platformAuthRoutes.get(
  "/admins",
  authenticatePlatformAdmin,
  platformAuthController.listAdmins,
);
platformAuthRoutes.post(
  "/admins",
  authenticatePlatformAdmin,
  platformAuthController.createAdmin,
);
