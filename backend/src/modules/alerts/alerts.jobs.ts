import { prisma } from "../../lib/prisma.ts";
import * as alertsRepository from "./alerts.repository.ts";
import { runLowStockDigest } from "./alerts.service.ts";

export async function runLowStockDigestForAllTenants(): Promise<number> {
  const enabled = await alertsRepository.findTenantsWithAlertsEnabled();
  let notified = 0;

  for (const { tenantId } of enabled) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { businessName: true, suspendedAt: true },
    });
    if (!tenant || tenant.suspendedAt) continue;

    const result = await runLowStockDigest(tenantId, tenant.businessName);
    notified += result.notified;
  }

  return notified;
}
