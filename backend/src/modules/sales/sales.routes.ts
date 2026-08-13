import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.ts";
import { authorize } from "../../middleware/authorize.ts";
import { requirePos } from "../../middleware/require-pos.ts";
import { PERMISSIONS } from "../../shared/permissions.ts";
import * as salesController from "./sales.controller.ts";

export const salesRoutes = Router();

salesRoutes.use(authenticate, requirePos);

salesRoutes.get("/catalog", salesController.catalog);
salesRoutes.get("/", salesController.list);
salesRoutes.post("/", authorize(...PERMISSIONS.sales.operate), salesController.create);
salesRoutes.get(
  "/:id",
  authorize(...PERMISSIONS.sales.viewAll, ...PERMISSIONS.sales.operate),
  salesController.get,
);
salesRoutes.post(
  "/:id/returns",
  authorize(...PERMISSIONS.sales.return),
  salesController.createReturn,
);
