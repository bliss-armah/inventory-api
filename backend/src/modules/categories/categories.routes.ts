import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { PERMISSIONS } from "../../shared/permissions";
import * as categoriesController from "./categories.controller";

export const categoriesRoutes = Router();

categoriesRoutes.use(authenticate);

const manage = authorize(...PERMISSIONS.categories.manage);
const view = authorize(...PERMISSIONS.categories.view);

categoriesRoutes.get("/", view, categoriesController.list);
categoriesRoutes.post("/", manage, categoriesController.create);
categoriesRoutes.patch("/:id", manage, categoriesController.update);
