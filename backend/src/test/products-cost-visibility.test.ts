import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../app";
import {
  createCashier,
  createProduct,
  createTenantWithOwner,
  deleteTenant,
  tokenFor,
} from "./fixtures";

describe("products read routes exclude CASHIER", () => {
  let tenant: Awaited<ReturnType<typeof createTenantWithOwner>>;
  let cashierToken: string;
  let productId: string;

  beforeAll(async () => {
    tenant = await createTenantWithOwner("Products Cost Co");
    const cashier = await createCashier(tenant.tenant.id);
    cashierToken = tokenFor(cashier);
    const product = await createProduct(tenant.tenant.id);
    productId = product.id;
  });

  afterAll(async () => {
    await deleteTenant(tenant.tenant.id);
  });

  it("403s a cashier and 200s an owner on GET /api/products", async () => {
    const cashierRes = await request(app)
      .get("/api/products")
      .set("Authorization", `Bearer ${cashierToken}`);
    expect(cashierRes.status).toBe(403);

    const ownerRes = await request(app)
      .get("/api/products")
      .set("Authorization", `Bearer ${tenant.token}`);
    expect(ownerRes.status).toBe(200);
  });

  it("403s a cashier and 200s an owner on GET /api/products/:id", async () => {
    const cashierRes = await request(app)
      .get(`/api/products/${productId}`)
      .set("Authorization", `Bearer ${cashierToken}`);
    expect(cashierRes.status).toBe(403);

    const ownerRes = await request(app)
      .get(`/api/products/${productId}`)
      .set("Authorization", `Bearer ${tenant.token}`);
    expect(ownerRes.status).toBe(200);
  });

  it("403s a cashier and 200s an owner on GET /api/products/:id/price-history", async () => {
    const cashierRes = await request(app)
      .get(`/api/products/${productId}/price-history`)
      .set("Authorization", `Bearer ${cashierToken}`);
    expect(cashierRes.status).toBe(403);

    const ownerRes = await request(app)
      .get(`/api/products/${productId}/price-history`)
      .set("Authorization", `Bearer ${tenant.token}`);
    expect(ownerRes.status).toBe(200);
  });
});
