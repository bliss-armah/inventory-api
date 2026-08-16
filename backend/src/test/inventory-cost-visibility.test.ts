import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../app";
import { createCashier, createTenantWithOwner, deleteTenant, tokenFor } from "./fixtures";

describe("inventory read routes exclude CASHIER", () => {
  let tenant: Awaited<ReturnType<typeof createTenantWithOwner>>;
  let cashierToken: string;

  beforeAll(async () => {
    tenant = await createTenantWithOwner("Inventory Cost Co");
    const cashier = await createCashier(tenant.tenant.id);
    cashierToken = tokenFor(cashier);
  });

  afterAll(async () => {
    await deleteTenant(tenant.tenant.id);
  });

  it("403s a cashier and 200s an owner on GET /api/inventory", async () => {
    const cashierRes = await request(app)
      .get("/api/inventory")
      .set("Authorization", `Bearer ${cashierToken}`);
    expect(cashierRes.status).toBe(403);

    const ownerRes = await request(app)
      .get("/api/inventory")
      .set("Authorization", `Bearer ${tenant.token}`);
    expect(ownerRes.status).toBe(200);
  });
});
