import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { app } from "../app";
import { prisma } from "../lib/prisma";
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

describe("sales", () => {
  let tenant: Awaited<ReturnType<typeof createTenantWithOwner>>;
  let location: Awaited<ReturnType<typeof createLocation>>;
  let cashierToken: string;
  let shiftId: string;

  beforeAll(async () => {
    tenant = await createTenantWithOwner("Sales Co");
    location = await createLocation(tenant.tenant.id);
    await enablePos(tenant.tenant.id, 10);

    const cashier = await createCashier(tenant.tenant.id);
    cashierToken = tokenFor(cashier);

    const shiftRes = await request(app)
      .post("/api/shifts")
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({ locationId: location.id, openingFloat: "0.00" });
    shiftId = shiftRes.body.data.id;
  });

  afterAll(async () => {
    await deleteTenant(tenant.tenant.id);
  });

  function salePayload(overrides: Record<string, unknown> = {}) {
    return {
      id: randomUUID(),
      saleNumber: `SL-${randomUUID().slice(0, 12).toUpperCase()}`,
      shiftId,
      soldAt: new Date().toISOString(),
      paymentMethod: "CASH",
      amountTendered: "1000.00",
      items: [],
      ...overrides,
    };
  }

  it("decrements stock by exactly the quantity sold", async () => {
    const product = await createProduct(tenant.tenant.id);
    await seedStock(tenant.tenant.id, product.id, location.id, 10);

    const res = await request(app)
      .post("/api/sales")
      .set("Authorization", `Bearer ${cashierToken}`)
      .send(
        salePayload({
          items: [{ productId: product.id, quantity: 3, unitPrice: "20.00" }],
        }),
      );

    expect(res.status).toBe(201);
    expect(Number(res.body.data.total)).toBe(60);

    const inventory = await prisma.inventory.findUnique({
      where: { productId_locationId: { productId: product.id, locationId: location.id } },
    });
    expect(inventory?.quantity).toBe(7);

    const movements = await prisma.stockMovement.count({
      where: { productId: product.id, type: "SALE" },
    });
    expect(movements).toBe(1);
  });

  it("rolls back every line when one line lacks stock", async () => {
    const plenty = await createProduct(tenant.tenant.id);
    const scarce = await createProduct(tenant.tenant.id);
    await seedStock(tenant.tenant.id, plenty.id, location.id, 100);
    await seedStock(tenant.tenant.id, scarce.id, location.id, 1);

    const res = await request(app)
      .post("/api/sales")
      .set("Authorization", `Bearer ${cashierToken}`)
      .send(
        salePayload({
          items: [
            { productId: plenty.id, quantity: 5, unitPrice: "20.00" },
            { productId: scarce.id, quantity: 5, unitPrice: "20.00" },
          ],
        }),
      );

    expect(res.status).toBe(400);

    const inventory = await prisma.inventory.findUnique({
      where: { productId_locationId: { productId: plenty.id, locationId: location.id } },
    });
    expect(inventory?.quantity).toBe(100);
  });

  it("rejects a live sale whose discount exceeds the cap", async () => {
    const product = await createProduct(tenant.tenant.id);
    await seedStock(tenant.tenant.id, product.id, location.id, 10);

    const res = await request(app)
      .post("/api/sales")
      .set("Authorization", `Bearer ${cashierToken}`)
      .send(
        salePayload({
          items: [
            { productId: product.id, quantity: 1, unitPrice: "20.00", discountAmount: "10.00" },
          ],
        }),
      );

    expect(res.status).toBe(400);
  });

  it("flags a price discrepancy instead of rewriting the price", async () => {
    const product = await createProduct(tenant.tenant.id);
    await seedStock(tenant.tenant.id, product.id, location.id, 10);

    const res = await request(app)
      .post("/api/sales")
      .set("Authorization", `Bearer ${cashierToken}`)
      .send(
        salePayload({
          items: [{ productId: product.id, quantity: 1, unitPrice: "18.00" }],
        }),
      );

    expect(res.status).toBe(201);
    expect(res.body.data.priceDiscrepancy).toBe(true);
    expect(Number(res.body.data.total)).toBe(18);
  });

  it("rejects a product belonging to another tenant", async () => {
    const other = await createTenantWithOwner("Other Co");
    const foreignProduct = await createProduct(other.tenant.id);

    const res = await request(app)
      .post("/api/sales")
      .set("Authorization", `Bearer ${cashierToken}`)
      .send(
        salePayload({
          items: [{ productId: foreignProduct.id, quantity: 1, unitPrice: "20.00" }],
        }),
      );

    expect(res.status).toBe(400);
    await deleteTenant(other.tenant.id);
  });

  it("rejects tender below the sale total", async () => {
    const product = await createProduct(tenant.tenant.id);
    await seedStock(tenant.tenant.id, product.id, location.id, 10);

    const res = await request(app)
      .post("/api/sales")
      .set("Authorization", `Bearer ${cashierToken}`)
      .send(
        salePayload({
          amountTendered: "5.00",
          items: [{ productId: product.id, quantity: 1, unitPrice: "20.00" }],
        }),
      );

    expect(res.status).toBe(400);
  });

  it("returns 409, not 500, when a saleNumber collides within the tenant under a fresh id", async () => {
    const product = await createProduct(tenant.tenant.id);
    await seedStock(tenant.tenant.id, product.id, location.id, 10);

    const saleNumber = `SL-DUP-${randomUUID().slice(0, 8).toUpperCase()}`;

    const first = await request(app)
      .post("/api/sales")
      .set("Authorization", `Bearer ${cashierToken}`)
      .send(
        salePayload({
          saleNumber,
          items: [{ productId: product.id, quantity: 1, unitPrice: "20.00" }],
        }),
      );
    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/api/sales")
      .set("Authorization", `Bearer ${cashierToken}`)
      .send(
        salePayload({
          saleNumber,
          items: [{ productId: product.id, quantity: 1, unitPrice: "20.00" }],
        }),
      );

    expect(second.status).toBe(409);
  });

  it("scopes GET /api/sales/:id to the cashier's own sale, hides unitCost from a cashier, and lets an owner read both", async () => {
    const cashierA = await createCashier(tenant.tenant.id);
    const cashierB = await createCashier(tenant.tenant.id);
    const tokenA = tokenFor(cashierA);
    const tokenB = tokenFor(cashierB);

    const shiftResA = await request(app)
      .post("/api/shifts")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ locationId: location.id, openingFloat: "0.00" });
    const shiftResB = await request(app)
      .post("/api/shifts")
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ locationId: location.id, openingFloat: "0.00" });

    const productA = await createProduct(tenant.tenant.id);
    const productB = await createProduct(tenant.tenant.id);
    await seedStock(tenant.tenant.id, productA.id, location.id, 10);
    await seedStock(tenant.tenant.id, productB.id, location.id, 10);

    const saleA = await request(app)
      .post("/api/sales")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({
        id: randomUUID(),
        saleNumber: `SL-${randomUUID().slice(0, 12).toUpperCase()}`,
        shiftId: shiftResA.body.data.id,
        soldAt: new Date().toISOString(),
        paymentMethod: "CASH",
        amountTendered: "100.00",
        items: [{ productId: productA.id, quantity: 1, unitPrice: "20.00" }],
      });
    const saleB = await request(app)
      .post("/api/sales")
      .set("Authorization", `Bearer ${tokenB}`)
      .send({
        id: randomUUID(),
        saleNumber: `SL-${randomUUID().slice(0, 12).toUpperCase()}`,
        shiftId: shiftResB.body.data.id,
        soldAt: new Date().toISOString(),
        paymentMethod: "CASH",
        amountTendered: "100.00",
        items: [{ productId: productB.id, quantity: 1, unitPrice: "20.00" }],
      });
    expect(saleA.status).toBe(201);
    expect(saleB.status).toBe(201);

    const aReadsOwn = await request(app)
      .get(`/api/sales/${saleA.body.data.id}`)
      .set("Authorization", `Bearer ${tokenA}`);
    expect(aReadsOwn.status).toBe(200);
    expect(aReadsOwn.body.data.items[0].unitCost).toBeUndefined();

    const aReadsB = await request(app)
      .get(`/api/sales/${saleB.body.data.id}`)
      .set("Authorization", `Bearer ${tokenA}`);
    expect(aReadsB.status).toBe(404);

    const bReadsA = await request(app)
      .get(`/api/sales/${saleA.body.data.id}`)
      .set("Authorization", `Bearer ${tokenB}`);
    expect(bReadsA.status).toBe(404);

    const ownerReadsA = await request(app)
      .get(`/api/sales/${saleA.body.data.id}`)
      .set("Authorization", `Bearer ${tenant.token}`);
    expect(ownerReadsA.status).toBe(200);
    expect(ownerReadsA.body.data.items[0].unitCost).toBeDefined();

    const ownerReadsB = await request(app)
      .get(`/api/sales/${saleB.body.data.id}`)
      .set("Authorization", `Bearer ${tenant.token}`);
    expect(ownerReadsB.status).toBe(200);
    expect(ownerReadsB.body.data.items[0].unitCost).toBeDefined();
  });
});
