import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../app";
import { createCashier, createTenantWithOwner, deleteTenant, tokenFor } from "./fixtures";

describe("stock-movements read routes exclude CASHIER", () => {
  let tenant: Awaited<ReturnType<typeof createTenantWithOwner>>;
  let cashierToken: string;

  beforeAll(async () => {
    tenant = await createTenantWithOwner("Stock Movements Cost Co");
    const cashier = await createCashier(tenant.tenant.id);
    cashierToken = tokenFor(cashier);
  });

  afterAll(async () => {
    await deleteTenant(tenant.tenant.id);
  });

  it("403s a cashier and 200s an owner on GET /api/stock-movements", async () => {
    const cashierRes = await request(app)
      .get("/api/stock-movements")
      .set("Authorization", `Bearer ${cashierToken}`);
    expect(cashierRes.status).toBe(403);

    const ownerRes = await request(app)
      .get("/api/stock-movements")
      .set("Authorization", `Bearer ${tenant.token}`);
    expect(ownerRes.status).toBe(200);
  });
});
