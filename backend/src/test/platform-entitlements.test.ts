import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../app";
import { prisma } from "../lib/prisma";
import {
  createPlatformAdmin,
  createTenantWithOwner,
  deletePlatformAdmin,
  deleteTenant,
  enablePos,
} from "./fixtures";

describe("platform admin sets a tenant's entitlements", () => {
  let tenant: Awaited<ReturnType<typeof createTenantWithOwner>>;
  let platform: Awaited<ReturnType<typeof createPlatformAdmin>>;

  beforeAll(async () => {
    tenant = await createTenantWithOwner("Entitlements Co");
    // Creates the business_settings row; createTenantWithOwner does not.
    await enablePos(tenant.tenant.id);
    platform = await createPlatformAdmin();
  });

  afterAll(async () => {
    await deleteTenant(tenant.tenant.id);
    await deletePlatformAdmin(platform.admin.id);
  });

  it("turns a feature off and on again", async () => {
    const off = await request(app)
      .patch(`/api/platform/tenants/${tenant.tenant.id}/entitlements`)
      .set("Authorization", `Bearer ${platform.token}`)
      .send({ enablePos: false });

    expect(off.status).toBe(200);
    expect(off.body.data.enablePos).toBe(false);

    const on = await request(app)
      .patch(`/api/platform/tenants/${tenant.tenant.id}/entitlements`)
      .set("Authorization", `Bearer ${platform.token}`)
      .send({ enablePos: true, enableBatchTracking: true });

    expect(on.status).toBe(200);
    expect(on.body.data.enablePos).toBe(true);
    expect(on.body.data.enableBatchTracking).toBe(true);
  });

  it("returns each tenant's current features in the list", async () => {
    // The dashboard seeds its Features dialog from this, and the relation is
    // `settings` while the Prisma accessor is `businessSettings` — a mix-up
    // the generated include types don't catch, so assert on the payload.
    const res = await request(app)
      .get("/api/platform/tenants")
      .set("Authorization", `Bearer ${platform.token}`);

    expect(res.status).toBe(200);
    const listed = res.body.data.items.find(
      (item: { id: string }) => item.id === tenant.tenant.id,
    );
    expect(listed.settings).toMatchObject({
      enablePos: expect.any(Boolean),
      inventoryMode: expect.any(String),
    });
  });

  it("refuses a tenant owner's token — a different secret entirely", async () => {
    const res = await request(app)
      .patch(`/api/platform/tenants/${tenant.tenant.id}/entitlements`)
      .set("Authorization", `Bearer ${tenant.token}`)
      .send({ enablePos: true });

    expect(res.status).toBe(401);
  });

  it("refuses an unauthenticated caller", async () => {
    const res = await request(app)
      .patch(`/api/platform/tenants/${tenant.tenant.id}/entitlements`)
      .send({ enablePos: true });

    expect(res.status).toBe(401);
  });

  it("404s an unknown tenant", async () => {
    const res = await request(app)
      .patch("/api/platform/tenants/does-not-exist/entitlements")
      .set("Authorization", `Bearer ${platform.token}`)
      .send({ enablePos: true });

    expect(res.status).toBe(404);
  });

  it("refuses single-location mode while the tenant has several locations", async () => {
    await prisma.location.createMany({
      data: [
        { tenantId: tenant.tenant.id, name: "Loc A", isDefault: true },
        { tenantId: tenant.tenant.id, name: "Loc B" },
      ],
    });

    const res = await request(app)
      .patch(`/api/platform/tenants/${tenant.tenant.id}/entitlements`)
      .set("Authorization", `Bearer ${platform.token}`)
      .send({ inventoryMode: "SINGLE_LOCATION" });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/single-location/i);
  });
});
