import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.ts";
import { authorize } from "../../middleware/authorize.ts";
import { requirePos } from "../../middleware/require-pos.ts";
import { PERMISSIONS } from "../../shared/permissions.ts";
import * as ordersController from "./orders.controller.ts";

export const ordersRoutes = Router();

ordersRoutes.use(authenticate, requirePos, authorize(...PERMISSIONS.orders.operate));

ordersRoutes.get("/", ordersController.list);
ordersRoutes.post("/", ordersController.create);
ordersRoutes.get("/by-number/:orderNumber", ordersController.getByNumber);
ordersRoutes.get("/:id", ordersController.get);
ordersRoutes.post("/:id/cancel", ordersController.cancel);
ordersRoutes.put("/:id/picking", ordersController.updatePicking);
