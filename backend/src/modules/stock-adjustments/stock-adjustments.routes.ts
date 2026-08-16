import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { PERMISSIONS } from "../../shared/permissions";
import * as stockAdjustmentsController from "./stock-adjustments.controller";

export const stockAdjustmentsRoutes = Router();

stockAdjustmentsRoutes.use(authenticate);

stockAdjustmentsRoutes.get(
  "/",
  authorize(...PERMISSIONS.stockAdjustments.view),
  stockAdjustmentsController.list,
);
stockAdjustmentsRoutes.post(
  "/",
  authorize(...PERMISSIONS.stockAdjustments.create),
  stockAdjustmentsController.create,
);
