import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

/**
 * Both transports are captured rather than mocked away wholesale, so
 * lib/otp-delivery.ts's channel routing is exercised for real — a code that
 * went out over the wrong channel shows up here as an empty array on the
 * channel the test expected.
 */
const sentSms: Array<{ to: string; body: string }> = [];
const sentEmails: Array<{ to: string; subject: string; body: string }> = [];

vi.mock("../lib/sms.ts", () => ({
  sendSms: vi.fn(async (to: string, body: string) => {
    sentSms.push({ to, body });
  }),
}));
vi.mock("../lib/email.ts", () => ({
  sendEmail: vi.fn(async (to: string, subject: string, body: string) => {
    sentEmails.push({ to, subject, body });
  }),
}));

const { app } = await import("../app.ts");
const { prisma } = await import("../lib/prisma.ts");
const {
  createTenantWithOwnerAndPassword,
  createUserWithPassword,
  deleteTenant,
  TEST_PASSWORD,
} = await import("./fixtures.ts");
const { Role, OtpChannel } = await import("../generated/prisma");

function codeFrom(body: string | undefined): string {
  const code = body?.match(/(\d{6})/)?.[1];
  if (!code) throw new Error("No OTP code captured — was the code actually sent?");
  return code;
}

const lastSmsCode = () => codeFrom(sentSms.at(-1)?.body);
const lastEmailCode = () => codeFrom(sentEmails.at(-1)?.body);

function rememberDeviceCookieValue(res: request.Response): string | undefined {
  const cookies = res.headers["set-cookie"];
  const raw = (Array.isArray(cookies) ? cookies : cookies ? [cookies] : []).find((c) =>
    c.startsWith("rememberDevice="),
  );
  return raw?.split(";")[0]?.split("=")[1];
}

/** Puts a user in the "already set up, SMS channel" state. */
function enableSmsTwoFactor(userId: string, phone: string) {
  return prisma.user.update({
    where: { id: userId },
    data: {
      phone,
      twoFactorEnabled: true,
      twoFactorConfirmedAt: new Date(),
      twoFactorChannel: OtpChannel.SMS,
    },
  });
}

/**
 * OWNER accounts must complete 2FA before they get a real session; every
 * other role is opt-in. This suite exercises the whole lifecycle through
 * real HTTP requests against the actual Express app, mocking only the two
 * delivery transports (not the OTP/token logic itself) so codes can be
 * captured instead of scraped from console output.
 */
describe("two-factor authentication", () => {
  const tenantIds: string[] = [];

  afterEach(() => {
    sentSms.length = 0;
    sentEmails.length = 0;
  });

  afterAll(async () => {
    for (const id of tenantIds) {
      await deleteTenant(id);
    }
  });

  it("emails a fresh OWNER a login code instead of demanding setup first", async () => {
    const { tenant, user } = await createTenantWithOwnerAndPassword();
    tenantIds.push(tenant.id);

    // No confirmed channel and no phone on the account, yet the login still
    // resolves to a destination: the address that was just typed in.
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ identifier: user.email, password: TEST_PASSWORD });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.data.status).toBe("otp_required");
    expect(loginRes.body.data.channel).toBe("EMAIL");
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails.at(0)?.to).toBe(user.email);
    expect(sentSms).toHaveLength(0);

    const verifyRes = await request(app)
      .post("/api/auth/2fa/verify")
      .set("Authorization", `Bearer ${loginRes.body.data.mfaToken}`)
      .send({ code: lastEmailCode(), rememberDevice: false });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.data.accessToken).toBeTruthy();
  });

  it("routes the code by identifier, not by the channel stored on the account", async () => {
    const { tenant, user } = await createTenantWithOwnerAndPassword();
    tenantIds.push(tenant.id);
    await enableSmsTwoFactor(user.id, "+15550000020");

    // Confirmed channel is SMS, but this login came in over email.
    const byEmail = await request(app)
      .post("/api/auth/login")
      .send({ identifier: user.email, password: TEST_PASSWORD });
    expect(byEmail.body.data.channel).toBe("EMAIL");
    expect(sentEmails).toHaveLength(1);
    expect(sentSms).toHaveLength(0);

    const byPhone = await request(app)
      .post("/api/auth/login")
      .send({ identifier: "+15550000020", password: TEST_PASSWORD });
    expect(byPhone.body.data.channel).toBe("SMS");
    expect(sentSms).toHaveLength(1);
    expect(sentEmails).toHaveLength(1);
  });

  it("sets up over email without touching the phone number", async () => {
    const { tenant, user } = await createTenantWithOwnerAndPassword();
    tenantIds.push(tenant.id);

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ identifier: user.email, password: TEST_PASSWORD });
    const mfaToken = loginRes.body.data.mfaToken;
    sentEmails.length = 0;

    // No phone in the body at all — an email setup must use the account's own
    // address, not one the caller nominates.
    const sendCodeRes = await request(app)
      .post("/api/auth/2fa/setup/send-code")
      .set("Authorization", `Bearer ${mfaToken}`)
      .send({ channel: "EMAIL" });
    expect(sendCodeRes.status).toBe(200);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails.at(0)?.to).toBe(user.email);
    expect(sentSms).toHaveLength(0);

    const confirmRes = await request(app)
      .post("/api/auth/2fa/setup/confirm")
      .set("Authorization", `Bearer ${mfaToken}`)
      .send({ code: lastEmailCode() });
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.data.status).toBe("success");

    const updated = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updated?.twoFactorChannel).toBe(OtpChannel.EMAIL);
    expect(updated?.phone).toBeNull();
  });

  it("logs in by phone number as well as by email", async () => {
    const { tenant, user } = await createTenantWithOwnerAndPassword();
    tenantIds.push(tenant.id);
    await enableSmsTwoFactor(user.id, "+15550000010");

    // Deliberately typed with the punctuation a human would use — it has to
    // normalise to the stored "+15550000010" to resolve the account.
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ identifier: "+1 (555) 000-0010", password: TEST_PASSWORD });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.data.status).toBe("otp_required");
    expect(loginRes.body.data.channel).toBe("SMS");

    const verifyRes = await request(app)
      .post("/api/auth/2fa/verify")
      .set("Authorization", `Bearer ${loginRes.body.data.mfaToken}`)
      .send({ code: lastSmsCode(), rememberDevice: false });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.data.accessToken).toBeTruthy();
  });

  it("rejects an unknown phone and a malformed identifier the same way as a bad password", async () => {
    const unknownPhone = await request(app)
      .post("/api/auth/login")
      .send({ identifier: "+15559999999", password: TEST_PASSWORD });
    expect(unknownPhone.status).toBe(401);

    const malformed = await request(app)
      .post("/api/auth/login")
      .send({ identifier: "not-an-email-or-phone", password: TEST_PASSWORD });
    expect(malformed.status).toBe(401);
    // Must not leak that the identifier was the problem rather than the password.
    expect(malformed.body.message).toBe(unknownPhone.body.message);
  });

  it("refuses to attach a phone number already used by another account", async () => {
    const { tenant, user: first } = await createTenantWithOwnerAndPassword();
    tenantIds.push(tenant.id);
    await enableSmsTwoFactor(first.id, "+15550000011");

    const { tenant: otherTenant, user: second } =
      await createTenantWithOwnerAndPassword();
    tenantIds.push(otherTenant.id);

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ identifier: second.email, password: TEST_PASSWORD });
    const mfaToken = loginRes.body.data.mfaToken;

    const sendCodeRes = await request(app)
      .post("/api/auth/2fa/setup/send-code")
      .set("Authorization", `Bearer ${mfaToken}`)
      .send({ channel: "SMS", phone: "+15550000011" });
    expect(sendCodeRes.status).toBe(409);
    // Nothing should have gone out to a number the caller doesn't own.
    expect(sentSms).toHaveLength(0);
  });

  it("still accepts the legacy `email` field so existing clients keep working", async () => {
    const { tenant, user } = await createTenantWithOwnerAndPassword();
    tenantIds.push(tenant.id);

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: TEST_PASSWORD });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.data.status).toBe("otp_required");
    expect(loginRes.body.data.channel).toBe("EMAIL");
  });

  it("requires an OTP (not setup) once already configured, and locks out after 5 wrong attempts", async () => {
    const { tenant, user } = await createTenantWithOwnerAndPassword();
    tenantIds.push(tenant.id);
    await enableSmsTwoFactor(user.id, "+15550000002");

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ identifier: "+15550000002", password: TEST_PASSWORD });
    expect(loginRes.body.data.status).toBe("otp_required");
    const mfaToken = loginRes.body.data.mfaToken;
    expect(sentSms).toHaveLength(1);

    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await request(app)
        .post("/api/auth/2fa/verify")
        .set("Authorization", `Bearer ${mfaToken}`)
        .send({ code: "000000", rememberDevice: false });
      expect(res.status).toBe(401);
    }

    const lockedOutRes = await request(app)
      .post("/api/auth/2fa/verify")
      .set("Authorization", `Bearer ${mfaToken}`)
      .send({ code: lastSmsCode(), rememberDevice: false });
    expect(lockedOutRes.status).toBe(400);
    expect(lockedOutRes.body.message).toMatch(/too many/i);
  });

  it("remembers a device across logins and slides its expiry, skipping the OTP prompt", async () => {
    const { tenant, user } = await createTenantWithOwnerAndPassword();
    tenantIds.push(tenant.id);
    await enableSmsTwoFactor(user.id, "+15550000003");

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ identifier: "+15550000003", password: TEST_PASSWORD });
    const mfaToken = loginRes.body.data.mfaToken;

    const verifyRes = await request(app)
      .post("/api/auth/2fa/verify")
      .set("Authorization", `Bearer ${mfaToken}`)
      .send({ code: lastSmsCode(), rememberDevice: true });
    expect(verifyRes.status).toBe(200);
    const deviceCookie = rememberDeviceCookieValue(verifyRes);
    expect(deviceCookie).toBeTruthy();

    const before = await prisma.rememberedDevice.findFirst({ where: { userId: user.id } });
    expect(before).not.toBeNull();

    const secondLoginRes = await request(app)
      .post("/api/auth/login")
      .set("Cookie", `rememberDevice=${deviceCookie}`)
      .send({ identifier: "+15550000003", password: TEST_PASSWORD });
    expect(secondLoginRes.status).toBe(200);
    expect(secondLoginRes.body.data.status).toBe("success");
    expect(secondLoginRes.body.data.accessToken).toBeTruthy();
    // No new code should have gone out — the whole point of the remembered device.
    expect(sentSms).toHaveLength(1);

    const after = await prisma.rememberedDevice.findUnique({ where: { id: before!.id } });
    expect(after!.expiresAt.getTime()).toBeGreaterThan(before!.expiresAt.getTime());
  });

  it("accepts a backup code once and rejects it on reuse", async () => {
    const { tenant, user } = await createTenantWithOwnerAndPassword();
    tenantIds.push(tenant.id);
    await enableSmsTwoFactor(user.id, "+15550000004");
    await prisma.twoFactorBackupCode.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        // sha256("TESTBACKUP01"), matching hashOpaqueToken's algorithm.
        codeHash: (await import("../lib/tokens.ts")).hashOpaqueToken("TESTBACKUP01"),
      },
    });

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ identifier: user.email, password: TEST_PASSWORD });
    const mfaToken = loginRes.body.data.mfaToken;

    const firstUse = await request(app)
      .post("/api/auth/2fa/verify")
      .set("Authorization", `Bearer ${mfaToken}`)
      .send({ backupCode: "TESTBACKUP01", rememberDevice: false });
    expect(firstUse.status).toBe(200);

    const secondLoginRes = await request(app)
      .post("/api/auth/login")
      .send({ identifier: user.email, password: TEST_PASSWORD });
    const secondMfaToken = secondLoginRes.body.data.mfaToken;

    const secondUse = await request(app)
      .post("/api/auth/2fa/verify")
      .set("Authorization", `Bearer ${secondMfaToken}`)
      .send({ backupCode: "TESTBACKUP01", rememberDevice: false });
    expect(secondUse.status).toBe(401);
  });

  it("does not gate a non-owner role without opt-in, but lets them opt in and disable", async () => {
    const { tenant, user: owner } = await createTenantWithOwnerAndPassword();
    tenantIds.push(tenant.id);
    const cashier = await createUserWithPassword(tenant.id, Role.CASHIER);

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ identifier: cashier.email, password: TEST_PASSWORD });
    expect(loginRes.body.data.status).toBe("success");
    const fullToken = loginRes.body.data.accessToken;

    await request(app)
      .post("/api/auth/2fa/setup/send-code")
      .set("Authorization", `Bearer ${fullToken}`)
      .send({ channel: "SMS", phone: "+15550000005" })
      .expect(200);

    const confirmRes = await request(app)
      .post("/api/auth/2fa/setup/confirm")
      .set("Authorization", `Bearer ${fullToken}`)
      .send({ code: lastSmsCode() });
    expect(confirmRes.status).toBe(200);
    // Already had a session — confirming setup must not mint a new one.
    expect(confirmRes.body.data.status).toBe("enabled");
    expect(confirmRes.body.data.accessToken).toBeUndefined();

    const disableRes = await request(app)
      .post("/api/auth/2fa/disable")
      .set("Authorization", `Bearer ${fullToken}`)
      .send({ password: TEST_PASSWORD });
    expect(disableRes.status).toBe(200);

    const updated = await prisma.user.findUnique({ where: { id: cashier.id } });
    expect(updated?.twoFactorEnabled).toBe(false);
    expect(updated?.twoFactorChannel).toBeNull();

    void owner;
  });

  it("blocks an OWNER from disabling two-factor authentication", async () => {
    const { tenant, user } = await createTenantWithOwnerAndPassword();
    tenantIds.push(tenant.id);
    await enableSmsTwoFactor(user.id, "+15550000006");

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ identifier: "+15550000006", password: TEST_PASSWORD });
    const mfaToken = loginRes.body.data.mfaToken;
    const verifyRes = await request(app)
      .post("/api/auth/2fa/verify")
      .set("Authorization", `Bearer ${mfaToken}`)
      .send({ code: lastSmsCode(), rememberDevice: false });
    const fullToken = verifyRes.body.data.accessToken;

    const disableRes = await request(app)
      .post("/api/auth/2fa/disable")
      .set("Authorization", `Bearer ${fullToken}`)
      .send({ password: TEST_PASSWORD });
    expect(disableRes.status).toBe(403);
  });

  it("never accepts a pending-auth (mfaToken) against a normal route, or a full token against /2fa/verify", async () => {
    const { tenant, user } = await createTenantWithOwnerAndPassword();
    tenantIds.push(tenant.id);
    const cashier = await createUserWithPassword(tenant.id, Role.CASHIER);

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ identifier: user.email, password: TEST_PASSWORD });
    const mfaToken = loginRes.body.data.mfaToken;

    const crossUseRes = await request(app)
      .get("/api/products")
      .set("Authorization", `Bearer ${mfaToken}`);
    expect(crossUseRes.status).toBe(401);

    const cashierLoginRes = await request(app)
      .post("/api/auth/login")
      .send({ identifier: cashier.email, password: TEST_PASSWORD });
    const fullToken = cashierLoginRes.body.data.accessToken;

    const reverseUseRes = await request(app)
      .post("/api/auth/2fa/verify")
      .set("Authorization", `Bearer ${fullToken}`)
      .send({ code: "000000", rememberDevice: false });
    expect(reverseUseRes.status).toBe(401);
  });
});
