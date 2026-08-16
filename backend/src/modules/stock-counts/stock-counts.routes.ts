import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { PERMISSIONS } from "../../shared/permissions";
import * as stockCountsController from "./stock-counts.controller";

export const stockCountsRoutes = Router();

stockCountsRoutes.use(authenticate);

const manage = authorize(...PERMISSIONS.stockCounts.manage);
const view = authorize(...PERMISSIONS.stockCounts.view);

stockCountsRoutes.get("/", view, stockCountsController.list);
stockCountsRoutes.get("/:id", view, stockCountsController.getOne);
stockCountsRoutes.post("/", manage, stockCountsController.create);
stockCountsRoutes.patch("/:id/items", manage, stockCountsController.updateItems);
stockCountsRoutes.post("/:id/complete", manage, stockCountsController.complete);
