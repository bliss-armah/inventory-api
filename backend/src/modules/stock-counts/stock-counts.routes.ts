import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { PERMISSIONS } from "../../shared/permissions";
import * as stockCountsController from "./stock-counts.controller";

export const stockCountsRoutes = Router();

stockCountsRoutes.use(authenticate);

const manage = authorize(...PERMISSIONS.stockCounts.manage);

stockCountsRoutes.get("/", stockCountsController.list);
stockCountsRoutes.get("/:id", stockCountsController.getOne);
stockCountsRoutes.post("/", manage, stockCountsController.create);
stockCountsRoutes.patch("/:id/items", manage, stockCountsController.updateItems);
stockCountsRoutes.post("/:id/complete", manage, stockCountsController.complete);
