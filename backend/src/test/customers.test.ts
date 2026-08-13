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

describe("customers", () => {
  let tenant: Awaited<ReturnType<typeof createTenantWithOwner>>;

  beforeAll(async () => {
    tenant = await createTenantWithOwner("Customers Co");
    await enablePos(tenant.tenant.id);
  });

  afterAll(async () => {
    await deleteTenant(tenant.tenant.id);
  });

  it("creates and reads back a customer", async () => {
    const createRes = await request(app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${tenant.token}`)
      .send({ name: "Ama Mensah", phone: "+233201234567" });

    expect(createRes.status).toBe(201);
    expect(createRes.body.data.name).toBe("Ama Mensah");

    const getRes = await request(app)
      .get(`/api/customers/${createRes.body.data.id}`)
      .set("Authorization", `Bearer ${tenant.token}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.data.phone).toBe("+233201234567");
  });

  it("rejects a duplicate phone number within the same tenant", async () => {
    await request(app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${tenant.token}`)
      .send({ name: "First", phone: "+233209999999" });

    const res = await request(app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${tenant.token}`)
      .send({ name: "Second", phone: "+233209999999" });

    expect(res.status).toBe(409);
  });

  it("allows many customers with no phone number", async () => {
    const first = await request(app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${tenant.token}`)
      .send({ name: "Walk-in A" });
    const second = await request(app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${tenant.token}`)
      .send({ name: "Walk-in B" });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
  });

  it("gives a cashier only their own sales for a customer, with no unitCost, while an owner sees every sale with cost", async () => {
    const location = await createLocation(tenant.tenant.id);
    const product = await createProduct(tenant.tenant.id);
    await seedStock(tenant.tenant.id, product.id, location.id, 20);

    const customerRes = await request(app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${tenant.token}`)
      .send({ name: "History Holder" });
    expect(customerRes.status).toBe(201);
    const customerId = customerRes.body.data.id;

    const cashierA = await createCashier(tenant.tenant.id);
    const cashierB = await createCashier(tenant.tenant.id);
    const tokenA = tokenFor(cashierA);
    const tokenB = tokenFor(cashierB);

    async function sell(token: string) {
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
          customerId,
          soldAt: new Date().toISOString(),
          paymentMethod: "CASH",
          amountTendered: "100.00",
          items: [{ productId: product.id, quantity: 1, unitPrice: "20.00" }],
        });
      expect(saleRes.status).toBe(201);
      return saleRes.body.data.id as string;
    }

    const saleAId = await sell(tokenA);
    const saleBId = await sell(tokenB);

    const aRes = await request(app)
      .get(`/api/customers/${customerId}/sales`)
      .set("Authorization", `Bearer ${tokenA}`);

    expect(aRes.status).toBe(200);
    for (const sale of aRes.body.data.items) {
      for (const item of sale.items) {
        expect(item.unitCost).toBeUndefined();
      }
    }
    expect(aRes.body.data.items.map((sale: { id: string }) => sale.id)).toEqual([saleAId]);
    expect(aRes.body.data.total).toBe(1);

    const ownerRes = await request(app)
      .get(`/api/customers/${customerId}/sales`)
      .set("Authorization", `Bearer ${tenant.token}`);

    expect(ownerRes.status).toBe(200);
    expect(ownerRes.body.data.total).toBe(2);
    const ownerIds = ownerRes.body.data.items.map((sale: { id: string }) => sale.id);
    expect(ownerIds).toContain(saleAId);
    expect(ownerIds).toContain(saleBId);
    for (const sale of ownerRes.body.data.items) {
      for (const item of sale.items) {
        expect(item.unitCost).toBeDefined();
      }
    }
  });
});
