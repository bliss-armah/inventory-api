import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";

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

describe("set-password tokens", () => {
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

describe("platform admin sign-in by email or phone", () => {
  async function adminWithPhone(phone: string) {
    const { admin } = await createPlatformAdmin();
    createdIds.push(admin.id);
    await prisma.platformAdmin.update({
      where: { id: admin.id },
      data: { phone, passwordHash: await bcrypt.hash("PlatformPass123!", 4) },
    });
    return admin;
  }

  const signIn = (identifier: string, password = "PlatformPass123!") =>
    request(app).post("/api/platform/auth/login").send({ identifier, password });

  it("signs in with the email", async () => {
    const admin = await adminWithPhone("+233200000101");
    const res = await signIn(admin.email);
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.admin.phone).toBe("+233200000101");
  });

  it("signs in with the phone number, however it is typed", async () => {
    await adminWithPhone("+233200000102");
    for (const typed of ["+233200000102", "+233 20 000 0102", "+233-200-000-102"]) {
      const res = await signIn(typed);
      expect(res.status, typed).toBe(200);
    }
  });

  it("still accepts the old email field", async () => {
    const admin = await adminWithPhone("+233200000103");
    const res = await request(app)
      .post("/api/platform/auth/login")
      .send({ email: admin.email, password: "PlatformPass123!" });
    expect(res.status).toBe(200);
  });

  it("answers a wrong password, an unknown phone and a malformed identifier the same way", async () => {
    const admin = await adminWithPhone("+233200000104");
    const wrong = await signIn(admin.email, "not-the-password");
    const unknown = await signIn("+233200999999");
    const malformed = await signIn("not an identifier");

    for (const res of [wrong, unknown, malformed]) {
      expect(res.status).toBe(401);
      expect(res.body.message).toBe("Invalid credentials");
    }
  });

  it("refuses a deactivated admin", async () => {
    const admin = await adminWithPhone("+233200000105");
    await prisma.platformAdmin.update({ where: { id: admin.id }, data: { isActive: false } });

    expect((await signIn("+233200000105")).status).toBe(401);
  });

  it("creates a colleague with a phone number and rejects a duplicate one", async () => {
    const { admin, token } = await createPlatformAdmin();
    createdIds.push(admin.id);
    const phone = "+233 20 000 0106";

    const first = await request(app)
      .post("/api/platform/auth/admins")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Colleague One", email: `colleague-${Date.now()}@example.test`, phone });
    const duplicate = await request(app)
      .post("/api/platform/auth/admins")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Colleague Two", email: `colleague-two-${Date.now()}@example.test`, phone });
    createdIds.push(first.body.data.id);

    expect(first.status).toBe(201);
    expect(first.body.data.phone).toBe("+233200000106");
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.message).toMatch(/phone/i);
  });
});
