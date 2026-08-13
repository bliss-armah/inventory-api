import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { app } from "../app";
import {
  createTenantWithOwner,
  createLocation,
  createProduct,
  createCashier,
  tokenFor,
  deleteTenant,
  enablePos,
  seedStock,
} from "./fixtures";

describe("sales reports", () => {
  let tenant: Awaited<ReturnType<typeof createTenantWithOwner>>;
  let reportCashierToken: string;
  let reportShiftId: string;
  let reportProductId: string;

  beforeAll(async () => {
    tenant = await createTenantWithOwner("Reports Co");
    const location = await createLocation(tenant.tenant.id);
    await enablePos(tenant.tenant.id, 20);

    const cashier = await createCashier(tenant.tenant.id);
    const cashierToken = tokenFor(cashier);
    reportCashierToken = cashierToken;
    const shiftRes = await request(app)
      .post("/api/shifts")
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({ locationId: location.id, openingFloat: "0.00" });
    reportShiftId = shiftRes.body.data.id;

    const product = await createProduct(tenant.tenant.id);
    reportProductId = product.id;
    await seedStock(tenant.tenant.id, product.id, location.id, 50);

    await request(app)
      .post("/api/sales")
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({
        id: randomUUID(),
        saleNumber: `SL-${randomUUID().slice(0, 12).toUpperCase()}`,
        shiftId: reportShiftId,
        soldAt: new Date().toISOString(),
        paymentMethod: "CASH",
        amountTendered: "1000.00",
        items: [{ productId: product.id, quantity: 4, unitPrice: "20.00" }],
      });
  });

  afterAll(async () => {
    await deleteTenant(tenant.tenant.id);
  });

  it("reports revenue, cost of goods sold and margin", async () => {
    const res = await request(app)
      .get("/api/reports/sales-summary?days=1")
      .set("Authorization", `Bearer ${tenant.token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.saleCount).toBe(1);
    expect(Number(res.body.data.revenue)).toBe(80);
    expect(Number(res.body.data.costOfGoodsSold)).toBe(40);
    expect(Number(res.body.data.grossMargin)).toBe(40);
  });

  it("filters on soldAt, so a backdated sale falls outside a short window", async () => {
    const backdated = new Date(Date.now() - 10 * 86_400_000).toISOString();
    await request(app)
      .post("/api/sales")
      .set("Authorization", `Bearer ${reportCashierToken}`)
      .send({
        id: randomUUID(),
        saleNumber: `SL-${randomUUID().slice(0, 12).toUpperCase()}`,
        shiftId: reportShiftId,
        soldAt: backdated,
        paymentMethod: "CASH",
        amountTendered: "1000.00",
        items: [{ productId: reportProductId, quantity: 1, unitPrice: "20.00" }],
      });

    const narrow = await request(app)
      .get("/api/reports/sales-summary?days=1")
      .set("Authorization", `Bearer ${tenant.token}`);
    const wide = await request(app)
      .get("/api/reports/sales-summary?days=30")
      .set("Authorization", `Bearer ${tenant.token}`);

    expect(narrow.body.data.saleCount).toBe(1);
    expect(wide.body.data.saleCount).toBe(2);
  });

  it("reconciles revenue, margin and discountTotal when both sale- and line-level discounts apply", async () => {
    const discountTenant = await createTenantWithOwner("Reports Discount Co");
    const location = await createLocation(discountTenant.tenant.id);
    await enablePos(discountTenant.tenant.id, 20);

    const cashier = await createCashier(discountTenant.tenant.id);
    const cashierToken = tokenFor(cashier);
    const shiftRes = await request(app)
      .post("/api/shifts")
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({ locationId: location.id, openingFloat: "0.00" });

    const product = await createProduct(discountTenant.tenant.id);
    await seedStock(discountTenant.tenant.id, product.id, location.id, 50);

    const saleRes = await request(app)
      .post("/api/sales")
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({
        id: randomUUID(),
        saleNumber: `SL-${randomUUID().slice(0, 12).toUpperCase()}`,
        shiftId: shiftRes.body.data.id,
        soldAt: new Date().toISOString(),
        paymentMethod: "CASH",
        amountTendered: "1000.00",
        discountAmount: "3.00",
        items: [
          { productId: product.id, quantity: 4, unitPrice: "20.00", discountAmount: "5.00" },
        ],
      });
    expect(saleRes.status).toBe(201);

    const res = await request(app)
      .get("/api/reports/sales-summary?days=1")
      .set("Authorization", `Bearer ${discountTenant.token}`);

    expect(res.status).toBe(200);
    expect(Number(res.body.data.revenue)).toBe(72);
    expect(Number(res.body.data.costOfGoodsSold)).toBe(40);
    expect(Number(res.body.data.grossMargin)).toBe(32);
    expect(Number(res.body.data.discountTotal)).toBe(8);

    await deleteTenant(discountTenant.tenant.id);
  });

  it("lists a sale with a line discount, excludes an undiscounted sale, and returns the standard envelope", async () => {
    const discountedSaleRes = await request(app)
      .post("/api/sales")
      .set("Authorization", `Bearer ${reportCashierToken}`)
      .send({
        id: randomUUID(),
        saleNumber: `SL-${randomUUID().slice(0, 12).toUpperCase()}`,
        shiftId: reportShiftId,
        soldAt: new Date().toISOString(),
        paymentMethod: "CASH",
        amountTendered: "1000.00",
        items: [
          { productId: reportProductId, quantity: 2, unitPrice: "20.00", discountAmount: "5.00" },
        ],
      });
    expect(discountedSaleRes.status).toBe(201);

    const plainSaleRes = await request(app)
      .post("/api/sales")
      .set("Authorization", `Bearer ${reportCashierToken}`)
      .send({
        id: randomUUID(),
        saleNumber: `SL-${randomUUID().slice(0, 12).toUpperCase()}`,
        shiftId: reportShiftId,
        soldAt: new Date().toISOString(),
        paymentMethod: "CASH",
        amountTendered: "1000.00",
        items: [{ productId: reportProductId, quantity: 1, unitPrice: "20.00" }],
      });
    expect(plainSaleRes.status).toBe(201);

    const res = await request(app)
      .get("/api/reports/discounts?days=1")
      .set("Authorization", `Bearer ${tenant.token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.page).toBe(1);
    expect(res.body.data.pageSize).toBe(20);
    expect(typeof res.body.data.total).toBe("number");

    const ids = res.body.data.items.map((item: { id: string }) => item.id);
    expect(ids).toContain(discountedSaleRes.body.data.id);
    expect(ids).not.toContain(plainSaleRes.body.data.id);

    const discountedRow = res.body.data.items.find(
      (item: { id: string }) => item.id === discountedSaleRes.body.data.id,
    );
    if (!discountedRow) {
      throw new Error("Expected the discounted sale to be in the report");
    }
    expect(discountedRow.items).toHaveLength(1);
    expect(Number(discountedRow.items[0].discountAmount)).toBe(5);
  });
});
