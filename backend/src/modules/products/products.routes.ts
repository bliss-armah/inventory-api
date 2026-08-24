import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { PERMISSIONS } from "../../shared/permissions";
import * as productsController from "./products.controller";

export const productsRoutes = Router();

productsRoutes.use(authenticate);

const manage = authorize(...PERMISSIONS.products.manage);
const view = authorize(...PERMISSIONS.products.view);

productsRoutes.get("/", view, productsController.list);
productsRoutes.get("/:id", view, productsController.getOne);
productsRoutes.get("/:id/price-history", view, productsController.getPriceHistory);
productsRoutes.post("/", manage, productsController.create);
productsRoutes.patch("/:id", manage, productsController.update);
productsRoutes.post(
  "/barcodes/generate-missing",
  manage,
  productsController.generateMissingBarcodes,
);
productsRoutes.post("/:id/barcode", manage, productsController.generateBarcode);
