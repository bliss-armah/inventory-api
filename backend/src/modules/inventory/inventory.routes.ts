import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { PERMISSIONS } from "../../shared/permissions";
import * as inventoryController from "./inventory.controller";

export const inventoryRoutes = Router();

inventoryRoutes.use(authenticate);

const view = authorize(...PERMISSIONS.inventory.view);

inventoryRoutes.get("/", view, inventoryController.list);
