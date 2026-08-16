import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.ts";
import { authorize } from "../../middleware/authorize.ts";
import { requirePos } from "../../middleware/require-pos.ts";
import { PERMISSIONS } from "../../shared/permissions.ts";
import * as shiftsController from "./shifts.controller.ts";

export const shiftsRoutes = Router();

shiftsRoutes.use(authenticate, requirePos);

shiftsRoutes.get(
  "/",
  authorize(...PERMISSIONS.shifts.viewAll, ...PERMISSIONS.shifts.operate),
  shiftsController.list,
);
shiftsRoutes.get("/current", authorize(...PERMISSIONS.shifts.operate), shiftsController.current);
shiftsRoutes.post("/", authorize(...PERMISSIONS.shifts.operate), shiftsController.open);
shiftsRoutes.post("/:id/close", authorize(...PERMISSIONS.shifts.operate), shiftsController.close);
shiftsRoutes.post(
  "/:id/force-close",
  authorize(...PERMISSIONS.shifts.forceClose),
  shiftsController.forceClose,
);
