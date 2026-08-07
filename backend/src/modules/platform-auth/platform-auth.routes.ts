import { Router } from "express";
import { authenticatePlatformAdmin } from "../../middleware/authenticate-platform-admin";
import { authRateLimit } from "../../middleware/rate-limit";
import * as platformAuthController from "./platform-auth.controller";

export const platformAuthRoutes = Router();

platformAuthRoutes.post("/login", authRateLimit, platformAuthController.login);
platformAuthRoutes.post("/refresh", platformAuthController.refresh);
platformAuthRoutes.post("/logout", platformAuthController.logout);
platformAuthRoutes.get("/me", authenticatePlatformAdmin, platformAuthController.me);
