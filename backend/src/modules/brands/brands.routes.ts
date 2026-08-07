import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { PERMISSIONS } from "../../shared/permissions";
import * as brandsController from "./brands.controller";

export const brandsRoutes = Router();

brandsRoutes.use(authenticate);

const manage = authorize(...PERMISSIONS.brands.manage);

brandsRoutes.get("/", brandsController.list);
brandsRoutes.post("/", manage, brandsController.create);
brandsRoutes.patch("/:id", manage, brandsController.update);
