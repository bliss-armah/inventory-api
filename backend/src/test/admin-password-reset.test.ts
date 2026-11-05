import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../app";
import { prisma } from "../lib/prisma";
import { Role } from "../generated/prisma";
import {
  TEST_PASSWORD,
  createPlatformAdmin,
  createTenantWithOwner,
  createTenantWithOwnerAndPassword,
  createUserWithPassword,
  deletePlatformAdmin,
  deleteTenant,
  tokenFor,
} from "./fixtures";

async function membershipOf(userId: string, tenantId: string) {
  return prisma.membership.findFirstOrThrow({ where: { userId, tenantId } });
}

function login(identifier: string, password: string) {
  return request(app).post("/api/auth/login").send({ identifier, password });
}

describe("a store owner changes a staff member's password", () => {
  let tenant: Awaited<ReturnType<typeof createTenantWithOwnerAndPassword>> & { token: string };
  let other: Awaited<ReturnType<typeof createTenantWithOwner>>;

  beforeAll(async () => {
    const created = await createTenantWithOwnerAndPassword("Reset Staff Co");
    tenant = {
      ...created,
      token: tokenFor({ id: created.user.id, tenantId: created.tenant.id, role: Role.OWNER }),
    };
    other = await createTenantWithOwner("Other Reset Co");
  });

  afterAll(async () => {
    await deleteTenant(tenant.tenant.id);
    await deleteTenant(other.tenant.id);
  });

  function setPassword(membershipId: string, body: Record<string, unknown> = {}, token = tenant.token) {
    return request(app)
      .post(`/api/users/${membershipId}/password`)
      .set("Authorization", `Bearer ${token}`)
      .send(body);
  }

  it("generates a new password, shows it once, and the old one stops working", async () => {
    const cashier = await createUserWithPassword(tenant.tenant.id, Role.CASHIER);
    const membership = await membershipOf(cashier.id, tenant.tenant.id);

    const res = await setPassword(membership.id);

    expect(res.status).toBe(200);
    expect(res.body.data.generated).toBe(true);
    expect(res.body.data.password).toHaveLength(12);
    expect(res.headers["cache-control"]).toBe("no-store");

    expect((await login(cashier.email, TEST_PASSWORD)).status).toBe(401);
    const signedIn = await login(cashier.email, res.body.data.password);
    expect(signedIn.status).toBe(200);
    expect(signedIn.body.data.status).toBe("success");
  });

  it("uses a password the owner chose and does not echo it back", async () => {
    const cashier = await createUserWithPassword(tenant.tenant.id, Role.CASHIER);
    const membership = await membershipOf(cashier.id, tenant.tenant.id);

    const res = await setPassword(membership.id, { password: "ChosenByOwner42" });

    expect(res.status).toBe(200);
    expect(res.body.data.generated).toBe(false);
    expect(res.body.data.password).toBeNull();
    expect((await login(cashier.email, "ChosenByOwner42")).status).toBe(200);
  });

  it("signs the staff member out everywhere", async () => {
    const cashier = await createUserWithPassword(tenant.tenant.id, Role.CASHIER);
    const membership = await membershipOf(cashier.id, tenant.tenant.id);
    await login(cashier.email, TEST_PASSWORD);
    expect(await prisma.refreshToken.count({ where: { userId: cashier.id, revokedAt: null } })).toBe(1);

    await setPassword(membership.id);

    expect(await prisma.refreshToken.count({ where: { userId: cashier.id, revokedAt: null } })).toBe(0);
  });

  it("rejects a password that is too short", async () => {
    const cashier = await createUserWithPassword(tenant.tenant.id, Role.CASHIER);
    const membership = await membershipOf(cashier.id, tenant.tenant.id);

    const res = await setPassword(membership.id, { password: "short" });

    expect(res.status).toBe(400);
    expect((await login(cashier.email, TEST_PASSWORD)).status).toBe(200);
  });

  it("will not change an owner's password", async () => {
    const membership = await membershipOf(tenant.user.id, tenant.tenant.id);

    const res = await setPassword(membership.id);

    expect(res.status).toBe(403);
    expect((await login(tenant.user.email, TEST_PASSWORD)).status).toBe(200);
  });

  it("will not change the password of someone who also works in another business", async () => {
    const shared = await createUserWithPassword(tenant.tenant.id, Role.CASHIER);
    await prisma.membership.create({
      data: { userId: shared.id, tenantId: other.tenant.id, role: Role.OWNER },
    });
    const membership = await membershipOf(shared.id, tenant.tenant.id);

    const res = await setPassword(membership.id);

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/another business/i);
    expect((await login(shared.email, TEST_PASSWORD)).status).toBe(200);
  });

  it("treats another business's staff member as not found", async () => {
    const stranger = await createUserWithPassword(other.tenant.id, Role.CASHIER);
    const membership = await membershipOf(stranger.id, other.tenant.id);

    const res = await setPassword(membership.id);

    expect(res.status).toBe(404);
  });

  it("is not available to a cashier", async () => {
    const cashier = await createUserWithPassword(tenant.tenant.id, Role.CASHIER);
    const colleague = await createUserWithPassword(tenant.tenant.id, Role.CASHIER);
    const membership = await membershipOf(colleague.id, tenant.tenant.id);

    const res = await setPassword(
      membership.id,
      {},
      tokenFor({ id: cashier.id, tenantId: tenant.tenant.id, role: Role.CASHIER }),
    );

    expect(res.status).toBe(403);
  });

  it("records who did it without recording the password", async () => {
    const cashier = await createUserWithPassword(tenant.tenant.id, Role.CASHIER);
    const membership = await membershipOf(cashier.id, tenant.tenant.id);

    const res = await setPassword(membership.id, { password: "NeverLogged123" });

    const entry = await prisma.activityLog.findFirstOrThrow({
      where: { tenantId: tenant.tenant.id, action: "STAFF_PASSWORD_CHANGED" },
      orderBy: { createdAt: "desc" },
    });
    expect(res.status).toBe(200);
    expect(entry.description).toContain(cashier.email);
    expect(entry.description).not.toContain("NeverLogged123");
  });
});

describe("the platform admin changes a store owner's password", () => {
  let platform: Awaited<ReturnType<typeof createPlatformAdmin>>;
  let tenant: Awaited<ReturnType<typeof createTenantWithOwnerAndPassword>> & { token: string };

  beforeAll(async () => {
    platform = await createPlatformAdmin();
    const created = await createTenantWithOwnerAndPassword("Platform Reset Co");
    tenant = {
      ...created,
      token: tokenFor({ id: created.user.id, tenantId: created.tenant.id, role: Role.OWNER }),
    };
  });

  afterAll(async () => {
    await deleteTenant(tenant.tenant.id);
    await deletePlatformAdmin(platform.admin.id);
  });

  function setOwnerPassword(tenantId: string, body: Record<string, unknown> = {}, token = platform.token) {
    return request(app)
      .post(`/api/platform/tenants/${tenantId}/owner-password`)
      .set("Authorization", `Bearer ${token}`)
      .send(body);
  }

  it("generates a new password for the only owner", async () => {
    const res = await setOwnerPassword(tenant.tenant.id);

    expect(res.status).toBe(200);
    expect(res.body.data.generated).toBe(true);
    expect(res.body.data.owner.email).toBe(tenant.user.email);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect((await login(tenant.user.email, TEST_PASSWORD)).status).toBe(401);
    expect((await login(tenant.user.email, res.body.data.password)).status).toBe(200);
  });

  it("uses a password the platform admin chose", async () => {
    const res = await setOwnerPassword(tenant.tenant.id, { password: "ChosenByPlatform9" });

    expect(res.status).toBe(200);
    expect(res.body.data.password).toBeNull();
    expect((await login(tenant.user.email, "ChosenByPlatform9")).status).toBe(200);
  });

  it("signs the owner out everywhere", async () => {
    await login(tenant.user.email, "ChosenByPlatform9");
    await setOwnerPassword(tenant.tenant.id);

    expect(await prisma.refreshToken.count({ where: { userId: tenant.user.id, revokedAt: null } })).toBe(0);
  });

  it("asks which owner when there is more than one", async () => {
    const second = await createUserWithPassword(tenant.tenant.id, Role.OWNER);

    const ambiguous = await setOwnerPassword(tenant.tenant.id);
    const chosen = await setOwnerPassword(tenant.tenant.id, { userId: second.id });

    expect(ambiguous.status).toBe(400);
    expect(chosen.status).toBe(200);
    expect(chosen.body.data.owner.id).toBe(second.id);
    expect((await login(second.email, TEST_PASSWORD)).status).toBe(401);

    await prisma.membership.deleteMany({ where: { userId: second.id } });
  });

  it("refuses to treat a cashier as the owner", async () => {
    const cashier = await createUserWithPassword(tenant.tenant.id, Role.CASHIER);

    const res = await setOwnerPassword(tenant.tenant.id, { userId: cashier.id });

    expect(res.status).toBe(400);
  });

  it("404s an unknown business", async () => {
    const res = await setOwnerPassword("no-such-tenant");
    expect(res.status).toBe(404);
  });

  it("is closed to a store owner's token and to no token at all", async () => {
    const asOwner = await setOwnerPassword(tenant.tenant.id, {}, tenant.token);
    const anonymous = await request(app).post(`/api/platform/tenants/${tenant.tenant.id}/owner-password`).send({});

    expect(asOwner.status).toBe(401);
    expect(anonymous.status).toBe(401);
  });
});
