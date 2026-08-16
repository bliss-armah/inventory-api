import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { PERMISSIONS } from "../../shared/permissions";
import * as tenantsController from "./tenants.controller";

export const tenantsRoutes = Router();

tenantsRoutes.use(authenticate);

const manage = authorize(...PERMISSIONS.tenants.manage);
const view = authorize(...PERMISSIONS.tenants.view);
// Settings carry their own pair: a cashier may read them (the till depends on
// it) but not write them. The tenant record itself stays owner-only.
const viewSettings = authorize(...PERMISSIONS.settings.view);
const manageSettings = authorize(...PERMISSIONS.settings.manage);

tenantsRoutes.get("/me", view, tenantsController.getCurrentTenant);
tenantsRoutes.patch("/me", manage, tenantsController.updateCurrentTenant);
tenantsRoutes.get("/me/settings", viewSettings, tenantsController.getSettings);
tenantsRoutes.patch("/me/settings", manageSettings, tenantsController.updateSettings);
