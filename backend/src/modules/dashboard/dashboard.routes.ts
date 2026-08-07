import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import * as dashboardController from "./dashboard.controller";

export const dashboardRoutes = Router();

dashboardRoutes.use(authenticate);

dashboardRoutes.get("/", dashboardController.getDashboard);
