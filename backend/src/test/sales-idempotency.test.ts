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

describe("sale creation is idempotent on the client-generated id", () => {
  let tenant: Awaited<ReturnType<typeof createTenantWithOwner>>;
  let location: Awaited<ReturnType<typeof createLocation>>;
  let cashierToken: string;
  let shiftId: string;

  beforeAll(async () => {
    tenant = await createTenantWithOwner("Idempotency Co");
    location = await createLocation(tenant.tenant.id);
    await enablePos(tenant.tenant.id);

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

  it("commits once and returns 200 when the same sale is posted twice", async () => {
    const product = await createProduct(tenant.tenant.id);
    await seedStock(tenant.tenant.id, product.id, location.id, 10);

    const payload = {
      id: randomUUID(),
      saleNumber: `SL-${randomUUID().slice(0, 12).toUpperCase()}`,
      shiftId,
      soldAt: new Date().toISOString(),
      paymentMethod: "CASH",
      amountTendered: "100.00",
      items: [{ productId: product.id, quantity: 2, unitPrice: "20.00" }],
    };

    const first = await request(app)
      .post("/api/sales")
      .set("Authorization", `Bearer ${cashierToken}`)
      .send(payload);
    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/api/sales")
      .set("Authorization", `Bearer ${cashierToken}`)
      .send(payload);
    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(payload.id);

    const inventory = await prisma.inventory.findUnique({
      where: { productId_locationId: { productId: product.id, locationId: location.id } },
    });
    expect(inventory?.quantity).toBe(8);

    const movements = await prisma.stockMovement.count({
      where: { productId: product.id, type: "SALE" },
    });
    expect(movements).toBe(1);
  });

  it("decrements exactly once when the same sale is posted concurrently", async () => {
    const product = await createProduct(tenant.tenant.id);
    await seedStock(tenant.tenant.id, product.id, location.id, 10);

    const payload = {
      id: randomUUID(),
      saleNumber: `SL-${randomUUID().slice(0, 12).toUpperCase()}`,
      shiftId,
      soldAt: new Date().toISOString(),
      paymentMethod: "CASH",
      amountTendered: "100.00",
      items: [{ productId: product.id, quantity: 1, unitPrice: "20.00" }],
    };

    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        request(app)
          .post("/api/sales")
          .set("Authorization", `Bearer ${cashierToken}`)
          .send(payload),
      ),
    );

    expect(responses.every((res) => res.status === 200 || res.status === 201)).toBe(true);

    const inventory = await prisma.inventory.findUnique({
      where: { productId_locationId: { productId: product.id, locationId: location.id } },
    });
    expect(inventory?.quantity).toBe(9);
  });

  it("rejects a sale over the discount cap and leaves no trace of it", async () => {
    await enablePos(tenant.tenant.id, 5);
    const product = await createProduct(tenant.tenant.id);
    await seedStock(tenant.tenant.id, product.id, location.id, 10);
    const saleId = randomUUID();

    const res = await request(app)
      .post("/api/sales")
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({
        id: saleId,
        saleNumber: `SL-${randomUUID().slice(0, 12).toUpperCase()}`,
        shiftId,
        soldAt: new Date(Date.now() - 3600_000).toISOString(),
        paymentMethod: "CASH",
        amountTendered: "100.00",
        items: [
          { productId: product.id, quantity: 1, unitPrice: "20.00", discountAmount: "10.00" },
        ],
      });

    expect(res.status).toBe(400);
    expect(await prisma.sale.findUnique({ where: { id: saleId } })).toBeNull();

    const inventory = await prisma.inventory.findUnique({
      where: { productId_locationId: { productId: product.id, locationId: location.id } },
    });
    expect(inventory?.quantity).toBe(10);
  });
});
