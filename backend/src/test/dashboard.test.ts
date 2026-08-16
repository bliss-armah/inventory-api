import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { app } from "../app";
import {
  createCashier,
  createLocation,
  createProduct,
  createTenantWithOwner,
  deleteTenant,
  enablePos,
  seedStock,
  tokenFor,
} from "./fixtures";

describe("dashboard", () => {
  let tenant: Awaited<ReturnType<typeof createTenantWithOwner>>;

  beforeAll(async () => {
    tenant = await createTenantWithOwner("Dashboard Co");
    await enablePos(tenant.tenant.id);
  });

  afterAll(async () => {
    await deleteTenant(tenant.tenant.id);
  });

  it("refuses a cashier's GET /api/dashboard outright, while an owner sees it", async () => {
    const location = await createLocation(tenant.tenant.id);
    const product = await createProduct(tenant.tenant.id);
    await seedStock(tenant.tenant.id, product.id, location.id, 20);

    const cashier = await createCashier(tenant.tenant.id);
    const token = tokenFor(cashier);

    const shiftRes = await request(app)
      .post("/api/shifts")
      .set("Authorization", `Bearer ${token}`)
      .send({ locationId: location.id, openingFloat: "0.00" });
    expect(shiftRes.status).toBe(201);

    const saleRes = await request(app)
      .post("/api/sales")
      .set("Authorization", `Bearer ${token}`)
      .send({
        id: randomUUID(),
        saleNumber: `SL-${randomUUID().slice(0, 12).toUpperCase()}`,
        shiftId: shiftRes.body.data.id,
        soldAt: new Date().toISOString(),
        paymentMethod: "CASH",
        amountTendered: "100.00",
        items: [{ productId: product.id, quantity: 1, unitPrice: "20.00" }],
      });
    expect(saleRes.status).toBe(201);

    const cashierRes = await request(app)
      .get("/api/dashboard")
      .set("Authorization", `Bearer ${token}`);

    expect(cashierRes.status).toBe(403);

    const ownerRes = await request(app)
      .get("/api/dashboard")
      .set("Authorization", `Bearer ${tenant.token}`);

    expect(ownerRes.status).toBe(200);
    expect(ownerRes.body.data.recentStockMovements.length).toBeGreaterThan(0);
  });
});
