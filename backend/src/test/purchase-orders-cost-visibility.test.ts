import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../app";
import { prisma } from "../lib/prisma";
import {
  createCashier,
  createLocation,
  createProduct,
  createTenantWithOwner,
  deleteTenant,
  tokenFor,
} from "./fixtures";

describe("purchase-orders read routes exclude CASHIER", () => {
  let tenant: Awaited<ReturnType<typeof createTenantWithOwner>>;
  let cashierToken: string;
  let purchaseOrderId: string;

  beforeAll(async () => {
    tenant = await createTenantWithOwner("Purchase Orders Cost Co");
    const cashier = await createCashier(tenant.tenant.id);
    cashierToken = tokenFor(cashier);

    const location = await createLocation(tenant.tenant.id);
    const product = await createProduct(tenant.tenant.id);
    const supplier = await prisma.supplier.create({
      data: { tenantId: tenant.tenant.id, name: "Supplier Co" },
    });

    const createRes = await request(app)
      .post("/api/purchase-orders")
      .set("Authorization", `Bearer ${tenant.token}`)
      .send({
        supplierId: supplier.id,
        locationId: location.id,
        items: [{ productId: product.id, quantityOrdered: 5, costPrice: 10 }],
      });
    expect(createRes.status).toBe(201);
    purchaseOrderId = createRes.body.data.id;
  });

  afterAll(async () => {
    await deleteTenant(tenant.tenant.id);
  });

  it("403s a cashier and 200s an owner on GET /api/purchase-orders", async () => {
    const cashierRes = await request(app)
      .get("/api/purchase-orders")
      .set("Authorization", `Bearer ${cashierToken}`);
    expect(cashierRes.status).toBe(403);

    const ownerRes = await request(app)
      .get("/api/purchase-orders")
      .set("Authorization", `Bearer ${tenant.token}`);
    expect(ownerRes.status).toBe(200);
  });

  it("403s a cashier and 200s an owner on GET /api/purchase-orders/:id", async () => {
    const cashierRes = await request(app)
      .get(`/api/purchase-orders/${purchaseOrderId}`)
      .set("Authorization", `Bearer ${cashierToken}`);
    expect(cashierRes.status).toBe(403);

    const ownerRes = await request(app)
      .get(`/api/purchase-orders/${purchaseOrderId}`)
      .set("Authorization", `Bearer ${tenant.token}`);
    expect(ownerRes.status).toBe(200);
  });
});
