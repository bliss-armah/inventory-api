import type { Request, Response } from "express";
import { created, ok } from "../../shared/api-response";
import { logActivity } from "../../lib/activity-logger";
import { requireParam } from "../../shared/params";
import * as productsService from "./products.service";
import {
  bulkUpdateProductsSchema,
  createProductSchema,
  updateProductSchema,
} from "./products.validators";

export async function list(req: Request, res: Response) {
  ok(res, await productsService.list(req.auth!.tenantId, req.query));
}

export async function getOne(req: Request, res: Response) {
  ok(res, await productsService.findOne(req.auth!.tenantId, requireParam(req, "id")));
}

export async function create(req: Request, res: Response) {
  const input = createProductSchema.parse(req.body);
  const product = await productsService.create(req.auth!.tenantId, input);
  await logActivity({
    tenantId: req.auth!.tenantId,
    userId: req.auth!.userId,
    action: "PRODUCT_CREATED",
    description: `Product "${product.name}" (${product.sku}) created`,
  });
  created(res, product);
}

export async function update(req: Request, res: Response) {
  const input = updateProductSchema.parse(req.body);
  const product = await productsService.update(
    req.auth!.tenantId,
    req.auth!.userId,
    requireParam(req, "id"),
    input,
  );
  await logActivity({
    tenantId: req.auth!.tenantId,
    userId: req.auth!.userId,
    action: "PRODUCT_UPDATED",
    description: `Product "${product.name}" (${product.sku}) updated`,
  });
  ok(res, product);
}

export async function generateBarcode(req: Request, res: Response) {
  const product = await productsService.generateBarcode(
    req.auth!.tenantId,
    requireParam(req, "id"),
  );
  await logActivity({
    tenantId: req.auth!.tenantId,
    userId: req.auth!.userId,
    action: "PRODUCT_UPDATED",
    description: `Barcode ${product.barcode} generated for "${product.name}" (${product.sku})`,
  });
  ok(res, product);
}

export async function generateMissingBarcodes(req: Request, res: Response) {
  const result = await productsService.generateMissingBarcodes(req.auth!.tenantId);
  if (result.generated > 0) {
    await logActivity({
      tenantId: req.auth!.tenantId,
      userId: req.auth!.userId,
      action: "PRODUCT_UPDATED",
      description: `Generated barcodes for ${result.generated} product(s) that had none`,
    });
  }
  ok(res, result);
}

export async function getPriceHistory(req: Request, res: Response) {
  ok(
    res,
    await productsService.getPriceHistory(req.auth!.tenantId, requireParam(req, "id"), req.query),
  );
}

export async function exportCsv(req: Request, res: Response) {
  const csv = await productsService.exportCsv(req.auth!.tenantId);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="products.csv"');
  res.send(csv);
}

export async function importCsv(req: Request, res: Response) {
  const body = typeof req.body === "string" ? req.body : "";
  const summary = await productsService.importCsv(
    req.auth!.tenantId,
    req.auth!.userId,
    body,
  );
  if (summary.created > 0 || summary.updated > 0) {
    await logActivity({
      tenantId: req.auth!.tenantId,
      userId: req.auth!.userId,
      action: "PRODUCT_UPDATED",
      description: `CSV import: ${summary.created} created, ${summary.updated} updated, ${summary.failed} failed`,
    });
  }
  ok(res, summary);
}

export async function bulkUpdate(req: Request, res: Response) {
  const input = bulkUpdateProductsSchema.parse(req.body);
  const result = await productsService.bulkUpdate(
    req.auth!.tenantId,
    req.auth!.userId,
    input,
  );
  await logActivity({
    tenantId: req.auth!.tenantId,
    userId: req.auth!.userId,
    action: "PRODUCT_UPDATED",
    description: `Bulk update applied to ${result.updated} product(s)`,
  });
  ok(res, result);
}
