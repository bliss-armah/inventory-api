import { sendEmail } from "../../lib/email.ts";
import * as alertsRepository from "./alerts.repository.ts";
import type { LowStockRow } from "./alerts.repository.ts";

export const RENOTIFY_AFTER_MS = 24 * 60 * 60 * 1000;

const SUBJECT = "Items running low in your shop";

export type LowStockDigest = {
  checked: number;
  lowStock: number;
  notified: number;
  suppressed: number;
  skipped?: "disabled" | "no-recipients";
};

function keyOf(entry: { productId: string; locationId: string }): string {
  return `${entry.productId}:${entry.locationId}`;
}

export function selectNewlyLow(
  lowStock: readonly LowStockRow[],
  recentlyNotified: ReadonlyArray<{ productId: string; locationId: string }>,
): LowStockRow[] {
  const seen = new Set(recentlyNotified.map(keyOf));
  return lowStock.filter((row) => !seen.has(keyOf(row)));
}

export function buildDigestBody(
  businessName: string,
  rows: readonly LowStockRow[],
  multiLocation: boolean,
): string {
  const lines = rows.map((row) => {
    const where = multiLocation ? ` at ${row.locationName}` : "";
    const state = row.quantity === 0 ? "out of stock" : `${row.quantity} left`;
    return `- ${row.name} (${row.sku})${where}: ${state}, minimum is ${row.minimumStock}`;
  });

  return [
    `${rows.length} item${rows.length === 1 ? " has" : "s have"} reached the minimum stock level at ${businessName}.`,
    "",
    ...lines,
    "",
    "This is sent once per item per day while it stays low, and again if it recovers and drops back.",
  ].join("\n");
}

export async function runLowStockDigest(
  tenantId: string,
  businessName: string,
  options: { force?: boolean } = {},
): Promise<LowStockDigest> {
  const settings = await alertsRepository.alertsEnabledFor(tenantId);
  if (!settings?.lowStockAlertsEnabled && !options.force) {
    return { checked: 0, lowStock: 0, notified: 0, suppressed: 0, skipped: "disabled" };
  }

  const lowStock = await alertsRepository.findLowStock(tenantId);
  await alertsRepository.clearRecovered(tenantId, lowStock);

  if (lowStock.length === 0) {
    return { checked: 1, lowStock: 0, notified: 0, suppressed: 0 };
  }

  const recentlyNotified = await alertsRepository.findRecentlyNotified(
    tenantId,
    new Date(Date.now() - RENOTIFY_AFTER_MS),
  );
  const fresh = selectNewlyLow(lowStock, recentlyNotified);

  if (fresh.length === 0) {
    return {
      checked: 1,
      lowStock: lowStock.length,
      notified: 0,
      suppressed: lowStock.length,
    };
  }

  const owners = await alertsRepository.findOwnerEmails(tenantId);
  if (owners.length === 0) {
    return {
      checked: 1,
      lowStock: lowStock.length,
      notified: 0,
      suppressed: 0,
      skipped: "no-recipients",
    };
  }

  const multiLocation = new Set(lowStock.map((row) => row.locationId)).size > 1;
  const body = buildDigestBody(businessName, fresh, multiLocation);

  for (const owner of owners) {
    try {
      await sendEmail(owner.email, SUBJECT, body);
    } catch (error) {
      console.error(
        `Low-stock digest to ${owner.email} failed: ${(error as Error).message}`,
      );
    }
  }

  await alertsRepository.recordNotified(tenantId, fresh);

  return {
    checked: 1,
    lowStock: lowStock.length,
    notified: fresh.length,
    suppressed: lowStock.length - fresh.length,
  };
}
