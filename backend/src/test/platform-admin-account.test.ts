import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const sentEmails: Array<{ to: string; subject: string; body: string }> = [];

vi.mock("../lib/email.ts", () => ({
  sendEmail: vi.fn(async (to: string, subject: string, body: string) => {
    sentEmails.push({ to, subject, body });
  }),
}));

const { app } = await import("../app.ts");
const { prisma } = await import("../lib/prisma.ts");
const { createPlatformAdmin, deletePlatformAdmin } = await import("./fixtures.ts");

function tokenFrom(body: string): string {
  const token = body.match(/token=([A-Za-z0-9_-]+)/)?.[1];
  if (!token) throw new Error("No reset token in the email body");
  return token;
}

const createdIds: string[] = [];

async function cleanup() {
  for (const id of createdIds.splice(0)) {
    await deletePlatformAdmin(id).catch(() => undefined);
  }
}

afterEach(async () => {
  sentEmails.length = 0;
  await cleanup();
});

describe("a platform admin can recover their own password", () => {
  it("emails a single-use reset link that actually changes the password", async () => {
    const { admin } = await createPlatformAdmin();
    createdIds.push(admin.id);

    const asked = await request(app)
      .post("/api/platform/auth/forgot-password")
      .send({ email: admin.email });
    expect(asked.status).toBe(200);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]!.to).toBe(admin.email);

    const token = tokenFrom(sentEmails[0]!.body);
    const reset = await request(app)
      .post("/api/platform/auth/reset-password")
      .send({ token, password: "BrandNewPass123!" });
    expect(reset.status).toBe(200);

    const login = await request(app)
      .post("/api/platform/auth/login")
      .send({ email: admin.email, password: "BrandNewPass123!" });
    expect(login.status).toBe(200);
    expect(login.body.data.accessToken).toBeTruthy();

    const replay = await request(app)
      .post("/api/platform/auth/reset-password")
      .send({ token, password: "YetAnother123!" });
    expect(replay.status).toBe(400);
  });

  it("answers an unknown email exactly as it answers a real one", async () => {
    const { admin } = await createPlatformAdmin();
    createdIds.push(admin.id);

    const real = await request(app)
      .post("/api/platform/auth/forgot-password")
      .send({ email: admin.email });
    sentEmails.length = 0;
    const unknown = await request(app)
      .post("/api/platform/auth/forgot-password")
      .send({ email: "nobody-at-all@example.test" });

    expect(unknown.status).toBe(real.status);
    expect(unknown.body).toEqual(real.body);
    expect(sentEmails).toHaveLength(0);
  });

  it("refuses a token that was never issued", async () => {
    const res = await request(app)
      .post("/api/platform/auth/reset-password")
      .send({ token: "not-a-real-token", password: "Whatever123!" });

    expect(res.status).toBe(400);
  });
});

describe("a platform admin can create another platform admin", () => {
  it("creates the account and emails an invite rather than returning a password", async () => {
    const { admin, token } = await createPlatformAdmin();
    createdIds.push(admin.id);

    const email = `invited-${Date.now()}@example.test`;
    const res = await request(app)
      .post("/api/platform/auth/admins")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Invited Admin", email });

    expect(res.status).toBe(201);
    const invited = await prisma.platformAdmin.findUnique({ where: { email } });
    expect(invited).not.toBeNull();
    createdIds.push(invited!.id);

    expect(JSON.stringify(res.body)).not.toContain("passwordHash");
    expect(JSON.stringify(res.body)).not.toContain("password");
    expect(sentEmails.some((sent) => sent.to === email)).toBe(true);
  });

  it("lets the invited admin set a password and sign in", async () => {
    const { admin, token } = await createPlatformAdmin();
    createdIds.push(admin.id);

    const email = `invited-${Date.now()}-b@example.test`;
    await request(app)
      .post("/api/platform/auth/admins")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Invited Admin", email })
      .expect(201);

    const created = await prisma.platformAdmin.findUnique({ where: { email } });
    createdIds.push(created!.id);

    const invite = sentEmails.find((sent) => sent.to === email)!;
    await request(app)
      .post("/api/platform/auth/reset-password")
      .send({ token: tokenFrom(invite.body), password: "InvitedPass123!" })
      .expect(200);

    const login = await request(app)
      .post("/api/platform/auth/login")
      .send({ email, password: "InvitedPass123!" });
    expect(login.status).toBe(200);
  });

  it("rejects a duplicate email", async () => {
    const { admin, token } = await createPlatformAdmin();
    createdIds.push(admin.id);

    const res = await request(app)
      .post("/api/platform/auth/admins")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Clash", email: admin.email });

    expect(res.status).toBe(409);
  });

  it("refuses an unauthenticated caller", async () => {
    const res = await request(app)
      .post("/api/platform/auth/admins")
      .send({ name: "Sneaky", email: "sneaky@example.test" });

    expect(res.status).toBe(401);
  });

  it("refuses a tenant owner's token", async () => {
    const { createTenantWithOwner } = await import("./fixtures.ts");
    const tenant = await createTenantWithOwner("Not Platform Co");

    const res = await request(app)
      .post("/api/platform/auth/admins")
      .set("Authorization", `Bearer ${tenant.token}`)
      .send({ name: "Sneaky", email: "sneaky2@example.test" });

    expect(res.status).toBe(401);
  });
});
