import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../app";
import { prisma } from "../lib/prisma";
import { createPlatformAdmin, deletePlatformAdmin, deleteTenant } from "./fixtures";

/**
 * Onboarding is a platform-admin act: the business, its owner, and the features
 * it is provisioned for are created together. The owner never receives a
 * password — they get an invite link and set their own, which is why these
 * assert on a token row rather than on any credential in the response.
 */
describe("platform admin creates a business", () => {
  let platform: Awaited<ReturnType<typeof createPlatformAdmin>>;
  const createdTenantIds: string[] = [];
  const email = `invited-owner-${Date.now()}@example.test`;

  beforeAll(async () => {
    platform = await createPlatformAdmin();
  });

  afterAll(async () => {
    for (const id of createdTenantIds) {
      await deleteTenant(id);
    }
    await deletePlatformAdmin(platform.admin.id);
  });

  it("creates tenant, owner and entitlements, and issues exactly one invite", async () => {
    const res = await request(app)
      .post("/api/platform/tenants")
      .set("Authorization", `Bearer ${platform.token}`)
      .send({
        businessName: "Invited Co",
        ownerName: "Invited Owner",
        email,
        phone: "+10000000000",
        country: "Testland",
        timeZone: "UTC",
        enablePos: true,
        enableBatchTracking: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.tenant.businessName).toBe("Invited Co");
    createdTenantIds.push(res.body.data.tenant.id);

    const settings = await prisma.businessSettings.findUnique({
      where: { tenantId: res.body.data.tenant.id },
    });
    expect(settings?.enablePos).toBe(true);
    expect(settings?.enableBatchTracking).toBe(true);
    // Not requested, so it must stay at the column default rather than
    // inheriting whatever the caller happened to omit.
    expect(settings?.enableExpiryTracking).toBe(false);

    const owner = await prisma.user.findUnique({ where: { email } });
    expect(owner?.role).toBe("OWNER");

    const tokens = await prisma.passwordResetToken.findMany({
      where: { userId: owner!.id },
    });
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.usedAt).toBeNull();
    // Comfortably longer than a password reset's 1h, so an onboarding
    // conversation can outlive the email sitting unread.
    expect(tokens[0]!.expiresAt.getTime() - Date.now()).toBeGreaterThan(
      24 * 60 * 60 * 1000,
    );
  });

  it("never returns a credential for the new owner", async () => {
    const res = await request(app)
      .post("/api/platform/tenants")
      .set("Authorization", `Bearer ${platform.token}`)
      .send({
        businessName: "No Credential Co",
        ownerName: "Quiet Owner",
        email: `quiet-${Date.now()}@example.test`,
        phone: "+10000000000",
        country: "Testland",
        timeZone: "UTC",
      });

    expect(res.status).toBe(201);
    createdTenantIds.push(res.body.data.tenant.id);
    expect(JSON.stringify(res.body)).not.toContain("passwordHash");
    expect(res.body.data.owner.password).toBeUndefined();
  });

  it("409s on an email that already exists", async () => {
    const res = await request(app)
      .post("/api/platform/tenants")
      .set("Authorization", `Bearer ${platform.token}`)
      .send({
        businessName: "Duplicate Co",
        ownerName: "Duplicate Owner",
        email,
        phone: "+10000000000",
        country: "Testland",
        timeZone: "UTC",
      });

    expect(res.status).toBe(409);
  });

  it("refuses an unauthenticated caller", async () => {
    const res = await request(app).post("/api/platform/tenants").send({
      businessName: "Anon Co",
      ownerName: "Anon Owner",
      email: `anon-${Date.now()}@example.test`,
      phone: "+10000000000",
      country: "Testland",
      timeZone: "UTC",
    });

    expect(res.status).toBe(401);
  });

  it("400s a payload missing the owner's email", async () => {
    const res = await request(app)
      .post("/api/platform/tenants")
      .set("Authorization", `Bearer ${platform.token}`)
      .send({
        businessName: "Incomplete Co",
        ownerName: "Nameless",
        phone: "+10000000000",
        country: "Testland",
        timeZone: "UTC",
      });

    expect(res.status).toBe(400);
  });
});
