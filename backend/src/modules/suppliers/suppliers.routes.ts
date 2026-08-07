import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { PERMISSIONS } from "../../shared/permissions";
import * as suppliersController from "./suppliers.controller";

export const suppliersRoutes = Router();

suppliersRoutes.use(authenticate);

const manage = authorize(...PERMISSIONS.suppliers.manage);

suppliersRoutes.get("/", suppliersController.list);
suppliersRoutes.post("/", manage, suppliersController.create);
suppliersRoutes.patch("/:id", manage, suppliersController.update);
