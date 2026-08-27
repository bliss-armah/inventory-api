import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const sentEmails: Array<{ to: string; subject: string; body: string }> = [];

vi.mock("../lib/email.ts", () => ({
  sendEmail: vi.fn(async (to: string, subject: string, body: string) => {
    sentEmails.push({ to, subject, body });
  }),
}));

const { app } = await import("../app.ts");
const { prisma } = await import("../lib/prisma.ts");
const { buildDigestBody, selectNewlyLow, runLowStockDigest } = await import(
  "../modules/alerts/alerts.service.ts"
);
const { createTenantWithOwner, createLocation, deleteTenant } = await import("./fixtures.ts");

const tenantIds: string[] = [];

afterEach(() => {
  sentEmails.length = 0;
});

afterAll(async () => {
  for (const id of tenantIds) await deleteTenant(id);
});

async function shopWithStock(quantity: number, minimumStock = 10) {
  const created = await createTenantWithOwner("Alert Co");
  tenantIds.push(created.tenant.id);
  const location = await createLocation(created.tenant.id, "Main");
  const product = await prisma.product.create({
    data: {
      tenantId: created.tenant.id,
      sku: `ALERT-${Math.random().toString(36).slice(2, 8)}`,
      name: "Rice 5kg",
      unit: "bag",
      costPrice: 10,
      sellingPrice: 15,
      minimumStock,
    },
  });
  await prisma.inventory.create({
    data: {
      tenantId: created.tenant.id,
      productId: product.id,
      locationId: location.id,
      quantity,
    },
  });
  await prisma.businessSettings.upsert({
    where: { tenantId: created.tenant.id },
    create: { tenantId: created.tenant.id, lowStockAlertsEnabled: true },
    update: { lowStockAlertsEnabled: true },
  });
  return { ...created, location, product };
}

describe("choosing what to alert on", () => {
  const rows = [
    { productId: "p1", locationId: "l1", sku: "A", name: "A", locationName: "Main", quantity: 1, minimumStock: 5 },
    { productId: "p2", locationId: "l1", sku: "B", name: "B", locationName: "Main", quantity: 0, minimumStock: 5 },
  ];

  it("skips anything already notified inside the window", () => {
    expect(selectNewlyLow(rows, [{ productId: "p1", locationId: "l1" }])).toEqual([rows[1]]);
  });

  it("treats the same product at another location as its own alert", () => {
    expect(selectNewlyLow(rows, [{ productId: "p1", locationId: "OTHER" }])).toHaveLength(2);
  });

  it("returns everything when nothing was notified", () => {
    expect(selectNewlyLow(rows, [])).toHaveLength(2);
  });
});

describe("what the digest says", () => {
  const row = {
    productId: "p1", locationId: "l1", sku: "RICE-1", name: "Rice 5kg",
    locationName: "Main", quantity: 2, minimumStock: 10,
  };

  it("names the shop, the product and the shortfall", () => {
    const body = buildDigestBody("Peestone", [row], false);
    expect(body).toMatch(/Peestone/);
    expect(body).toMatch(/Rice 5kg \(RICE-1\)/);
    expect(body).toMatch(/2 left, minimum is 10/);
  });

  it("says out of stock rather than 0 left", () => {
    expect(buildDigestBody("Peestone", [{ ...row, quantity: 0 }], false)).toMatch(/out of stock/);
  });

  it("names the location only when more than one is involved", () => {
    expect(buildDigestBody("Peestone", [row], false)).not.toMatch(/at Main/);
    expect(buildDigestBody("Peestone", [row], true)).toMatch(/at Main/);
  });
});

describe("running the digest", () => {
  it("emails the owner once, then suppresses the repeat", async () => {
    const shop = await shopWithStock(2);

    const first = await runLowStockDigest(shop.tenant.id, shop.tenant.businessName);
    expect(first.notified).toBe(1);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]!.to).toBe(shop.user.email);

    sentEmails.length = 0;
    const second = await runLowStockDigest(shop.tenant.id, shop.tenant.businessName);
    expect(second.notified).toBe(0);
    expect(second.suppressed).toBe(1);
    expect(sentEmails).toHaveLength(0);
  });

  it("says nothing when stock is healthy", async () => {
    const shop = await shopWithStock(50);

    const result = await runLowStockDigest(shop.tenant.id, shop.tenant.businessName);

    expect(result.lowStock).toBe(0);
    expect(sentEmails).toHaveLength(0);
  });

  it("alerts again after the item recovers and drops back", async () => {
    const shop = await shopWithStock(2);
    await runLowStockDigest(shop.tenant.id, shop.tenant.businessName);
    sentEmails.length = 0;

    await prisma.inventory.updateMany({
      where: { productId: shop.product.id },
      data: { quantity: 80 },
    });
    await runLowStockDigest(shop.tenant.id, shop.tenant.businessName);
    expect(await prisma.lowStockAlert.count({ where: { tenantId: shop.tenant.id } })).toBe(0);

    await prisma.inventory.updateMany({
      where: { productId: shop.product.id },
      data: { quantity: 1 },
    });
    const again = await runLowStockDigest(shop.tenant.id, shop.tenant.businessName);

    expect(again.notified).toBe(1);
    expect(sentEmails).toHaveLength(1);
  });

  it("does nothing at all when the business has alerts switched off", async () => {
    const shop = await shopWithStock(2);
    await prisma.businessSettings.update({
      where: { tenantId: shop.tenant.id },
      data: { lowStockAlertsEnabled: false },
    });

    const result = await runLowStockDigest(shop.tenant.id, shop.tenant.businessName);

    expect(result.skipped).toBe("disabled");
    expect(sentEmails).toHaveLength(0);
  });

  it("ignores a product with no minimum set", async () => {
    const shop = await shopWithStock(0, 0);

    const result = await runLowStockDigest(shop.tenant.id, shop.tenant.businessName);

    expect(result.lowStock).toBe(0);
  });
});

describe("the on-demand endpoint", () => {
  it("runs even when the scheduled digest is switched off", async () => {
    const shop = await shopWithStock(2);
    await prisma.businessSettings.update({
      where: { tenantId: shop.tenant.id },
      data: { lowStockAlertsEnabled: false },
    });

    const res = await request(app)
      .post("/api/reports/low-stock/notify")
      .set("Authorization", `Bearer ${shop.token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.notified).toBe(1);
    expect(sentEmails).toHaveLength(1);
  });

  it("refuses a cashier", async () => {
    const shop = await shopWithStock(2);
    const { createCashier, tokenFor } = await import("./fixtures.ts");
    const cashier = await createCashier(shop.tenant.id);

    const res = await request(app)
      .post("/api/reports/low-stock/notify")
      .set("Authorization", `Bearer ${tokenFor(cashier)}`);

    expect(res.status).toBe(403);
  });

  it("never reaches another tenant's stock", async () => {
    const mine = await shopWithStock(50);
    await shopWithStock(1);

    const res = await request(app)
      .post("/api/reports/low-stock/notify")
      .set("Authorization", `Bearer ${mine.token}`);

    expect(res.body.data.lowStock).toBe(0);
  });
});
