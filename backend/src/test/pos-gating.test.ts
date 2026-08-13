import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../app";
import { createTenantWithOwner, deleteTenant, enablePos } from "./fixtures";

describe("POS routes are gated on enablePos", () => {
  let tenant: Awaited<ReturnType<typeof createTenantWithOwner>>;

  beforeAll(async () => {
    tenant = await createTenantWithOwner("Gating Co");
  });

  afterAll(async () => {
    await deleteTenant(tenant.tenant.id);
  });

  it("403s for a tenant that has not enabled POS", async () => {
    const res = await request(app)
      .get("/api/customers")
      .set("Authorization", `Bearer ${tenant.token}`);

    expect(res.status).toBe(403);
  });

  it("allows the route once POS is enabled", async () => {
    await enablePos(tenant.tenant.id);

    const res = await request(app)
      .get("/api/customers")
      .set("Authorization", `Bearer ${tenant.token}`);

    expect(res.status).toBe(200);
  });
});
