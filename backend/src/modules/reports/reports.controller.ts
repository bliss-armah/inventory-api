import type { Request, Response } from "express";
import { ok } from "../../shared/api-response";
import * as reportsService from "./reports.service";
import * as tenantsService from "../tenants/tenants.service.ts";
import { runLowStockDigest } from "../alerts/alerts.service.ts";

export async function currentStock(req: Request, res: Response) {
  ok(res, await reportsService.currentStock(req.auth!.tenantId, req.query));
}

export async function lowStock(req: Request, res: Response) {
  ok(res, await reportsService.lowStock(req.auth!.tenantId, req.query));
}

export async function outOfStock(req: Request, res: Response) {
  ok(res, await reportsService.outOfStock(req.auth!.tenantId, req.query));
}

export async function inventoryValuation(req: Request, res: Response) {
  ok(res, await reportsService.inventoryValuation(req.auth!.tenantId, req.query));
}

export async function purchaseHistory(req: Request, res: Response) {
  ok(res, await reportsService.purchaseHistory(req.auth!.tenantId, req.query));
}

export async function fastMoving(req: Request, res: Response) {
  ok(res, await reportsService.fastMoving(req.auth!.tenantId, req.query));
}

export async function slowMoving(req: Request, res: Response) {
  ok(res, await reportsService.slowMoving(req.auth!.tenantId, req.query));
}

export async function deadStock(req: Request, res: Response) {
  ok(res, await reportsService.deadStock(req.auth!.tenantId, req.query));
}

export async function salesSummary(req: Request, res: Response) {
  ok(res, await reportsService.salesSummary(req.auth!.tenantId, req.query));
}

export async function discounts(req: Request, res: Response) {
  ok(res, await reportsService.discounts(req.auth!.tenantId, req.query));
}

export async function notifyLowStock(req: Request, res: Response) {
  const tenant = await tenantsService.getCurrentTenant(req.auth!.tenantId);
  const result = await runLowStockDigest(req.auth!.tenantId, tenant.businessName, {
    force: true,
  });
  ok(res, result);
}
