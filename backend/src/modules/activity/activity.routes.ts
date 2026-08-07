import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { PERMISSIONS } from "../../shared/permissions";
import * as activityController from "./activity.controller";

export const activityRoutes = Router();

activityRoutes.use(authenticate, authorize(...PERMISSIONS.activity.view));

activityRoutes.get("/", activityController.list);
