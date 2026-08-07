import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import * as inventoryController from "./inventory.controller";

export const inventoryRoutes = Router();

inventoryRoutes.use(authenticate);

inventoryRoutes.get("/", inventoryController.list);
