import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { PERMISSIONS } from "../../shared/permissions";
import * as reportsController from "./reports.controller";

export const reportsRoutes = Router();

reportsRoutes.use(authenticate);

const stockLevels = authorize(...PERMISSIONS.reports.stockLevels);
const purchaseHistory = authorize(...PERMISSIONS.reports.purchaseHistory);
const financial = authorize(...PERMISSIONS.reports.financial);

reportsRoutes.get("/current-stock", stockLevels, reportsController.currentStock);
reportsRoutes.get("/low-stock", stockLevels, reportsController.lowStock);
reportsRoutes.post("/low-stock/notify", stockLevels, reportsController.notifyLowStock);
reportsRoutes.get("/out-of-stock", stockLevels, reportsController.outOfStock);
reportsRoutes.get("/inventory-valuation", financial, reportsController.inventoryValuation);
reportsRoutes.get("/purchase-history", purchaseHistory, reportsController.purchaseHistory);
reportsRoutes.get("/fast-moving", financial, reportsController.fastMoving);
reportsRoutes.get("/slow-moving", financial, reportsController.slowMoving);
reportsRoutes.get("/dead-stock", financial, reportsController.deadStock);
reportsRoutes.get("/sales-summary", financial, reportsController.salesSummary);
reportsRoutes.get("/discounts", financial, reportsController.discounts);
