import { Router } from "express";
import { authenticatePlatformAdmin } from "../../middleware/authenticate-platform-admin";
import * as platformTenantsController from "./platform-tenants.controller";

export const platformTenantsRoutes = Router();

platformTenantsRoutes.use(authenticatePlatformAdmin);

platformTenantsRoutes.get("/stats", platformTenantsController.stats);
platformTenantsRoutes.get("/tenants", platformTenantsController.list);
platformTenantsRoutes.post("/tenants", platformTenantsController.create);
platformTenantsRoutes.get("/tenants/:id", platformTenantsController.getOne);
platformTenantsRoutes.patch(
  "/tenants/:id/entitlements",
  platformTenantsController.updateEntitlements,
);
platformTenantsRoutes.post("/tenants/:id/suspend", platformTenantsController.suspend);
platformTenantsRoutes.post("/tenants/:id/reactivate", platformTenantsController.reactivate);
