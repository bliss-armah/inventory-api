import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { PERMISSIONS } from "../../shared/permissions";
import * as dashboardController from "./dashboard.controller";

export const dashboardRoutes = Router();

dashboardRoutes.use(authenticate);

dashboardRoutes.get(
  "/",
  authorize(...PERMISSIONS.dashboard.view),
  dashboardController.getDashboard,
);
