import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import * as stockMovementsController from "./stock-movements.controller";

export const stockMovementsRoutes = Router();

stockMovementsRoutes.use(authenticate);

// Movements are an audit trail, not something created directly through this
// route — they're produced by receiving, adjustments, and transfers.
stockMovementsRoutes.get("/", stockMovementsController.list);
