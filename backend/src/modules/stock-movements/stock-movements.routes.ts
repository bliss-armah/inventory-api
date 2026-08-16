import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { PERMISSIONS } from "../../shared/permissions";
import * as stockMovementsController from "./stock-movements.controller";

export const stockMovementsRoutes = Router();

stockMovementsRoutes.use(authenticate);

const view = authorize(...PERMISSIONS.stockMovements.view);

// Movements are an audit trail, not something created directly through this
// route — they're produced by receiving, adjustments, and transfers.
stockMovementsRoutes.get("/", view, stockMovementsController.list);
