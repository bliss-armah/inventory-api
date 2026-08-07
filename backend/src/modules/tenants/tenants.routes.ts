import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { PERMISSIONS } from "../../shared/permissions";
import * as tenantsController from "./tenants.controller";

export const tenantsRoutes = Router();

tenantsRoutes.use(authenticate);

const manage = authorize(...PERMISSIONS.tenants.manage);

tenantsRoutes.get("/me", tenantsController.getCurrentTenant);
tenantsRoutes.patch("/me", manage, tenantsController.updateCurrentTenant);
tenantsRoutes.get("/me/settings", tenantsController.getSettings);
tenantsRoutes.patch("/me/settings", manage, tenantsController.updateSettings);
