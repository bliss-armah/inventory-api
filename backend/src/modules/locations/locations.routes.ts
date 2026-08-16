import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { PERMISSIONS } from "../../shared/permissions";
import * as locationsController from "./locations.controller";

export const locationsRoutes = Router();

locationsRoutes.use(authenticate);

const manage = authorize(...PERMISSIONS.locations.manage);
const view = authorize(...PERMISSIONS.locations.view);

locationsRoutes.get("/", view, locationsController.list);
locationsRoutes.post("/", manage, locationsController.create);
locationsRoutes.patch("/:id", manage, locationsController.update);
