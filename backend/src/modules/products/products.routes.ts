import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { PERMISSIONS } from "../../shared/permissions";
import * as productsController from "./products.controller";

export const productsRoutes = Router();

productsRoutes.use(authenticate);

const manage = authorize(...PERMISSIONS.products.manage);

productsRoutes.get("/", productsController.list);
productsRoutes.get("/:id", productsController.getOne);
productsRoutes.get("/:id/price-history", productsController.getPriceHistory);
productsRoutes.post("/", manage, productsController.create);
productsRoutes.patch("/:id", manage, productsController.update);
