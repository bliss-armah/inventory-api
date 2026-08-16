import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { PERMISSIONS } from "../../shared/permissions";
import * as purchaseOrdersController from "./purchase-orders.controller";

export const purchaseOrdersRoutes = Router();

purchaseOrdersRoutes.use(authenticate);

const view = authorize(...PERMISSIONS.purchaseOrders.view);

purchaseOrdersRoutes.get("/", view, purchaseOrdersController.list);
purchaseOrdersRoutes.get("/:id", view, purchaseOrdersController.getOne);

purchaseOrdersRoutes.post(
  "/",
  authorize(...PERMISSIONS.purchaseOrders.create),
  purchaseOrdersController.create,
);
purchaseOrdersRoutes.post(
  "/:id/submit",
  authorize(...PERMISSIONS.purchaseOrders.submit),
  purchaseOrdersController.submit,
);
purchaseOrdersRoutes.post(
  "/:id/approve",
  authorize(...PERMISSIONS.purchaseOrders.approve),
  purchaseOrdersController.approve,
);
purchaseOrdersRoutes.post(
  "/:id/cancel",
  authorize(...PERMISSIONS.purchaseOrders.cancel),
  purchaseOrdersController.cancel,
);
purchaseOrdersRoutes.post(
  "/:id/receive",
  authorize(...PERMISSIONS.purchaseOrders.receive),
  purchaseOrdersController.receiveGoods,
);
