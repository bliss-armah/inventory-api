import { prisma } from "../../lib/prisma.ts";
import type { Role } from "../../generated/prisma/enums.ts";
import { PERMISSIONS, roleAllowed } from "../../shared/permissions.ts";
import * as purchaseOrdersRepository from "../purchase-orders/purchase-orders.repository.ts";
import * as stockMovementsRepository from "../stock-movements/stock-movements.repository.ts";
import * as reportsRepository from "../reports/reports.repository.ts";
import * as activityRepository from "../activity/activity.repository.ts";

const RECENT_LIMIT = 5;

/**
 * One call composing everything the dashboard screen needs, so the
 * frontend doesn't fire five-plus separate requests on load. Fields the
 * caller's role isn't permitted to see (per the same PERMISSIONS.reports /
 * PERMISSIONS.activity rules the dedicated endpoints enforce) come back as
 * `null` rather than omitted, so the frontend type is a fixed shape.
 */
export async function getDashboard(tenantId: string, role: Role) {
  const canSeeFinancials = roleAllowed(PERMISSIONS.reports.financial, role);
  const canSeeStockLevels = roleAllowed(PERMISSIONS.reports.stockLevels, role);
  const canSeeActivity = roleAllowed(PERMISSIONS.activity.view, role);

  const [
    totalProducts,
    recentPurchaseOrders,
    recentStockMovements,
    valuationRows,
    lowStockResult,
    outOfStockResult,
    activityResult,
  ] = await Promise.all([
    prisma.product.count({ where: { tenantId } }),
    purchaseOrdersRepository.listRecent(tenantId, RECENT_LIMIT),
    stockMovementsRepository.listRecent(tenantId, RECENT_LIMIT),
    canSeeFinancials
      ? reportsRepository.inventoryValuation(tenantId)
      : Promise.resolve(null),
    canSeeStockLevels
      ? reportsRepository.lowStock(tenantId, 0, 1, undefined)
      : Promise.resolve(null),
    canSeeStockLevels
      ? reportsRepository.outOfStock(tenantId, 0, 1, undefined)
      : Promise.resolve(null),
    canSeeActivity
      ? activityRepository.list(tenantId, 0, RECENT_LIMIT, {})
      : Promise.resolve(null),
  ]);

  return {
    totalProducts,
    recentPurchaseOrders,
    recentStockMovements,
    inventoryValue: valuationRows
      ? valuationRows.reduce((sum, row) => sum + Number(row.value), 0)
      : null,
    lowStockCount: lowStockResult ? lowStockResult[1] : null,
    outOfStockCount: outOfStockResult ? outOfStockResult[1] : null,
    recentActivity: activityResult ? activityResult[0] : null,
  };
}
