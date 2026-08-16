import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { PERMISSIONS } from "../../shared/permissions";
import * as tenantsController from "./tenants.controller";

export const tenantsRoutes = Router();

tenantsRoutes.use(authenticate);

const manage = authorize(...PERMISSIONS.tenants.manage);
const view = authorize(...PERMISSIONS.tenants.view);

tenantsRoutes.get("/me", view, tenantsController.getCurrentTenant);
tenantsRoutes.patch("/me", manage, tenantsController.updateCurrentTenant);
tenantsRoutes.get("/me/settings", view, tenantsController.getSettings);
tenantsRoutes.patch("/me/settings", manage, tenantsController.updateSettings);
