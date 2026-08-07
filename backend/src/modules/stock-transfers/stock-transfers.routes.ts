import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { PERMISSIONS } from "../../shared/permissions";
import * as stockTransfersController from "./stock-transfers.controller";

export const stockTransfersRoutes = Router();

stockTransfersRoutes.use(authenticate);

const manage = authorize(...PERMISSIONS.stockTransfers.manage);

stockTransfersRoutes.get("/", stockTransfersController.list);
stockTransfersRoutes.get("/:id", stockTransfersController.getOne);
stockTransfersRoutes.post("/", manage, stockTransfersController.create);
stockTransfersRoutes.post("/:id/approve", manage, stockTransfersController.approve);
stockTransfersRoutes.post("/:id/cancel", manage, stockTransfersController.cancel);
stockTransfersRoutes.post("/:id/dispatch", manage, stockTransfersController.dispatch);
stockTransfersRoutes.post("/:id/receive", manage, stockTransfersController.receive);
