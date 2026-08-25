import express, { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { PERMISSIONS } from "../../shared/permissions";
import * as productsController from "./products.controller";

export const productsRoutes = Router();

productsRoutes.use(authenticate);

const manage = authorize(...PERMISSIONS.products.manage);
const view = authorize(...PERMISSIONS.products.view);

productsRoutes.get("/export.csv", manage, productsController.exportCsv);
productsRoutes.post(
  "/import.csv",
  manage,
  express.text({ type: ["text/csv", "text/plain"], limit: "5mb" }),
  productsController.importCsv,
);
productsRoutes.patch("/bulk", manage, productsController.bulkUpdate);
productsRoutes.post(
  "/barcodes/generate-missing",
  manage,
  productsController.generateMissingBarcodes,
);

productsRoutes.get("/", view, productsController.list);
productsRoutes.post("/", manage, productsController.create);
productsRoutes.get("/:id", view, productsController.getOne);
productsRoutes.get("/:id/price-history", view, productsController.getPriceHistory);
productsRoutes.patch("/:id", manage, productsController.update);
productsRoutes.post("/:id/barcode", manage, productsController.generateBarcode);
