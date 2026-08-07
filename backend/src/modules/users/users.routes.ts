import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { PERMISSIONS } from "../../shared/permissions";
import * as usersController from "./users.controller";

export const usersRoutes = Router();

usersRoutes.use(authenticate, authorize(...PERMISSIONS.users.manage));

usersRoutes.get("/", usersController.list);
usersRoutes.post("/", usersController.create);
usersRoutes.patch("/:id", usersController.update);
