import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.ts";
import { authorize } from "../../middleware/authorize.ts";
import { requirePos } from "../../middleware/require-pos.ts";
import { PERMISSIONS } from "../../shared/permissions.ts";
import * as customersController from "./customers.controller.ts";

export const customersRoutes = Router();

customersRoutes.use(authenticate, requirePos, authorize(...PERMISSIONS.customers.manage));

customersRoutes.get("/", customersController.list);
customersRoutes.post("/", customersController.create);
customersRoutes.get("/:id", customersController.get);
customersRoutes.patch("/:id", customersController.update);
customersRoutes.get("/:id/sales", customersController.listSales);
