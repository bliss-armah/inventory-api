import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../app";
import { createTenantWithOwner, deleteTenant } from "./fixtures";
import { prisma } from "../lib/prisma";

describe("business settings — discount cap", () => {
  let tenant: Awaited<ReturnType<typeof createTenantWithOwner>>;

  beforeAll(async () => {
    tenant = await createTenantWithOwner("Cap Co");
    await prisma.businessSettings.create({
      data: {
        tenantId: tenant.tenant.id,
      },
    });
  });

  afterAll(async () => {
    await deleteTenant(tenant.tenant.id);
  });

  it("defaults to zero, which disables discounts", async () => {
    const res = await request(app)
      .get("/api/tenants/me/settings")
      .set("Authorization", `Bearer ${tenant.token}`);

    expect(res.status).toBe(200);
    expect(Number(res.body.data.maxDiscountPercent)).toBe(0);
  });

  it("accepts a cap and returns it on the next read", async () => {
    const patch = await request(app)
      .patch("/api/tenants/me/settings")
      .set("Authorization", `Bearer ${tenant.token}`)
      .send({ maxDiscountPercent: "12.50" });

    expect(patch.status).toBe(200);
    expect(Number(patch.body.data.maxDiscountPercent)).toBe(12.5);

    const read = await request(app)
      .get("/api/tenants/me/settings")
      .set("Authorization", `Bearer ${tenant.token}`);

    expect(Number(read.body.data.maxDiscountPercent)).toBe(12.5);
  });

  it("rejects a cap above 100, a negative cap, and three decimal places", async () => {
    for (const maxDiscountPercent of ["100.01", "-5.00", "12.505"]) {
      const res = await request(app)
        .patch("/api/tenants/me/settings")
        .set("Authorization", `Bearer ${tenant.token}`)
        .send({ maxDiscountPercent });

      expect(res.status).toBe(400);
    }

    const read = await request(app)
      .get("/api/tenants/me/settings")
      .set("Authorization", `Bearer ${tenant.token}`);

    expect(Number(read.body.data.maxDiscountPercent)).toBe(12.5);
  });
});
