import { prisma } from "../../lib/prisma.ts";
import * as alertsRepository from "./alerts.repository.ts";
import { runLowStockDigest } from "./alerts.service.ts";

export async function runLowStockDigestForAllTenants(): Promise<number> {
  const enabled = await alertsRepository.findTenantsWithAlertsEnabled();
  let notified = 0;

  const tenants = await prisma.tenant.findMany({
    where: { id: { in: enabled.map(({ tenantId }) => tenantId) }, suspendedAt: null },
    select: { id: true, businessName: true },
  });

  for (const tenant of tenants) {
    const result = await runLowStockDigest(tenant.id, tenant.businessName);
    notified += result.notified;
  }

  return notified;
}
