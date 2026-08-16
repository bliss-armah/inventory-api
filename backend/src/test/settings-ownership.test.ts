import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../app";
import { createTenantWithOwner, deleteTenant, enablePos } from "./fixtures";

/**
 * Which features a business has is assigned by the platform operator when the
 * business is onboarded, not chosen by the business. The owner keeps the one
 * setting that is genuinely shop-floor policy: the discount cap.
 *
 * These reject rather than silently ignore an entitlement key, because a
 * request that looks accepted but changes nothing is worse than a refusal —
 * the UI would show a saved state that isn't real.
 */
describe("an owner cannot provision their own entitlements", () => {
  let tenant: Awaited<ReturnType<typeof createTenantWithOwner>>;

  beforeAll(async () => {
    tenant = await createTenantWithOwner("Entitlement Guard Co");
    // createTenantWithOwner makes no business_settings row, and the update is
    // an update rather than an upsert — without this the route 500s on a
    // missing record instead of exercising the validation this file is about.
    await enablePos(tenant.tenant.id);
  });

  afterAll(async () => {
    await deleteTenant(tenant.tenant.id);
  });

  it("rejects enablePos with a field error rather than ignoring it", async () => {
    const res = await request(app)
      .patch("/api/tenants/me/settings")
      .set("Authorization", `Bearer ${tenant.token}`)
      .send({ enablePos: true });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain("enablePos");
  });

  it("rejects inventoryMode too", async () => {
    const res = await request(app)
      .patch("/api/tenants/me/settings")
      .set("Authorization", `Bearer ${tenant.token}`)
      .send({ inventoryMode: "MULTIPLE_LOCATIONS" });

    expect(res.status).toBe(400);
  });

  it("rejects batch and expiry tracking", async () => {
    const res = await request(app)
      .patch("/api/tenants/me/settings")
      .set("Authorization", `Bearer ${tenant.token}`)
      .send({ enableBatchTracking: true, enableExpiryTracking: true });

    expect(res.status).toBe(400);
  });

  it("rejects a valid cap smuggled in alongside an entitlement", async () => {
    const res = await request(app)
      .patch("/api/tenants/me/settings")
      .set("Authorization", `Bearer ${tenant.token}`)
      .send({ maxDiscountPercent: "5", enablePos: true });

    expect(res.status).toBe(400);
  });

  it("still accepts the discount cap on its own", async () => {
    const res = await request(app)
      .patch("/api/tenants/me/settings")
      .set("Authorization", `Bearer ${tenant.token}`)
      .send({ maxDiscountPercent: "12.50" });

    expect(res.status).toBe(200);
    // Compared numerically: the column is Decimal(5,2) and Prisma's string
    // form ("12.5" vs "12.50") is not what this test is about.
    expect(Number(res.body.data.maxDiscountPercent)).toBe(12.5);
  });
});
