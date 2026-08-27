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
const {
  createTenantWithOwner,
  createTenantWithOwnerAndPassword,
  createUserWithPassword,
  tokenFor,
  TEST_PASSWORD,
} = await import("./fixtures.ts");
const { Role } = await import("../generated/prisma");

/** Pulls the raw invitation token back out of the email that was "sent". */
function inviteTokenFor(email: string): string {
  const body = sentEmails.filter((sent) => sent.to === email).at(-1)?.body;
  const token = body?.match(/accept-invite\?token=([A-Za-z0-9_-]+)/)?.[1];
  if (!token) {
    throw new Error(`No invitation email captured for ${email}`);
  }
  return token;
}

/**
 * The fixtures already register every tenant they create with the shared
 * end-of-file sweep, so this only exists to keep the call sites reading as
 * `await track(createTenantWithOwner(...))` alongside the ones that need it.
 */
async function track<T>(fixture: Promise<T>) {
  return fixture;
}

describe("staff emails are scoped to the business", () => {
  afterEach(() => {
    sentEmails.length = 0;
  });

  it("lets two businesses invite the same email address", async () => {
    const first = await track(createTenantWithOwner("Alpha Co"));
    const second = await track(createTenantWithOwner("Beta Co"));
    const shared = `shared-${Date.now()}@example.test`;

    const firstInvite = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${first.token}`)
      .send({ name: "Shared Person", email: shared, role: Role.CASHIER });
    expect(firstInvite.status).toBe(201);

    // The bug this whole model exists to fix: before memberships, the globally
    // unique users.email meant the second business got a 409 about an account
    // it could not see anywhere in its own staff list.
    const secondInvite = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${second.token}`)
      .send({ name: "Shared Person", email: shared, role: Role.CASHIER });
    expect(secondInvite.status).toBe(201);
  });

  it("rejects a second invitation to someone already on this staff list", async () => {
    const { tenant, token } = await track(createTenantWithOwner("Gamma Co"));
    const member = await createUserWithPassword(tenant.id, Role.CASHIER);

    const res = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Dup", email: member.email, role: Role.CASHIER });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already on your staff list/i);
  });

  it("shows only this business's staff, and its own pending invitations", async () => {
    const first = await track(createTenantWithOwner("Delta Co"));
    const second = await track(createTenantWithOwner("Epsilon Co"));
    const outsider = await createUserWithPassword(second.tenant.id, Role.CASHIER);

    await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${first.token}`)
      .send({
        name: "Pending Person",
        email: `pending-${Date.now()}@example.test`,
        role: Role.CASHIER,
      });

    const res = await request(app)
      .get("/api/users")
      .set("Authorization", `Bearer ${first.token}`);

    expect(res.status).toBe(200);
    const emails = res.body.data.items.map((row: { email: string }) => row.email);
    expect(emails).toContain(first.user.email);
    expect(emails).not.toContain(outsider.email);
    expect(res.body.data.pendingInvites).toHaveLength(1);
  });
});

describe("accepting a staff invitation", () => {
  afterEach(() => {
    sentEmails.length = 0;
  });

  it("creates an identity and a membership for an address with no account", async () => {
    const { tenant, token } = await track(createTenantWithOwner("Zeta Co"));
    const email = `newcomer-${Date.now()}@example.test`;

    await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Newcomer", email, role: Role.CASHIER });

    const described = await request(app).get(
      `/api/auth/invites/${inviteTokenFor(email)}`,
    );
    expect(described.status).toBe(200);
    expect(described.body.data.hasAccount).toBe(false);
    expect(described.body.data.businessName).toBe(tenant.businessName);

    const accepted = await request(app).post("/api/auth/invites/accept").send({
      token: inviteTokenFor(email),
      password: "NewcomerPass123!",
    });

    expect(accepted.status).toBe(201);
    expect(accepted.body.data.status).toBe("success");
    expect(accepted.body.data.user.tenantId).toBe(tenant.id);
    expect(accepted.body.data.user.role).toBe(Role.CASHIER);

    // The invitation is spent, not left lying around as a second way in.
    const remaining = await prisma.staffInvite.count({
      where: { tenantId: tenant.id },
    });
    expect(remaining).toBe(0);
  });

  it("adds a business to an existing account once its password is proven", async () => {
    const home = await track(createTenantWithOwnerAndPassword("Eta Co"));
    const other = await track(createTenantWithOwner("Theta Co"));

    await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${other.token}`)
      .send({ name: "Moonlighter", email: home.user.email, role: Role.CASHIER });

    const described = await request(app).get(
      `/api/auth/invites/${inviteTokenFor(home.user.email)}`,
    );
    expect(described.body.data.hasAccount).toBe(true);

    const wrongPassword = await request(app)
      .post("/api/auth/invites/accept")
      .send({
        token: inviteTokenFor(home.user.email),
        password: "NotTheRightOne123!",
      });
    expect(wrongPassword.status).toBe(401);

    const accepted = await request(app).post("/api/auth/invites/accept").send({
      token: inviteTokenFor(home.user.email),
      password: TEST_PASSWORD,
    });
    expect(accepted.status).toBe(201);

    // One identity, two memberships — not a second account.
    const identities = await prisma.user.count({
      where: { email: home.user.email },
    });
    expect(identities).toBe(1);
    const memberships = await prisma.membership.findMany({
      where: { user: { email: home.user.email } },
    });
    expect(memberships).toHaveLength(2);
  });

  it("refuses an expired invitation", async () => {
    const { tenant, token } = await track(createTenantWithOwner("Iota Co"));
    const email = `stale-${Date.now()}@example.test`;

    await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Stale", email, role: Role.CASHIER });

    await prisma.staffInvite.updateMany({
      where: { tenantId: tenant.id, email },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await request(app)
      .post("/api/auth/invites/accept")
      .send({ token: inviteTokenFor(email), password: "Whatever123!" });
    expect(res.status).toBe(400);
  });
});

describe("one business's decisions don't reach another", () => {
  it("deactivating a membership leaves the person's other business alone", async () => {
    const first = await track(createTenantWithOwner("Kappa Co"));
    const second = await track(createTenantWithOwner("Lambda Co"));

    const person = await createUserWithPassword(first.tenant.id, Role.CASHIER);
    await prisma.membership.create({
      data: {
        userId: person.id,
        tenantId: second.tenant.id,
        role: Role.CASHIER,
      },
    });

    const membershipHere = await prisma.membership.findUniqueOrThrow({
      where: {
        userId_tenantId: { userId: person.id, tenantId: first.tenant.id },
      },
    });

    const res = await request(app)
      .patch(`/api/users/${membershipHere.id}`)
      .set("Authorization", `Bearer ${first.token}`)
      .send({ isActive: false });
    expect(res.status).toBe(200);

    const elsewhere = await prisma.membership.findUniqueOrThrow({
      where: {
        userId_tenantId: { userId: person.id, tenantId: second.tenant.id },
      },
    });
    expect(elsewhere.isActive).toBe(true);
  });

  it("refuses to touch a membership belonging to another business", async () => {
    const first = await track(createTenantWithOwner("Mu Co"));
    const second = await track(createTenantWithOwner("Nu Co"));
    const outsider = await createUserWithPassword(second.tenant.id, Role.CASHIER);
    const theirMembership = await prisma.membership.findFirstOrThrow({
      where: { userId: outsider.id },
    });

    const res = await request(app)
      .patch(`/api/users/${theirMembership.id}`)
      .set("Authorization", `Bearer ${first.token}`)
      .send({ role: Role.OWNER });

    expect(res.status).toBe(404);
  });

  it("won't let a business remove its last active owner", async () => {
    const { tenant, user, token } = await track(createTenantWithOwner("Xi Co"));
    const membership = await prisma.membership.findFirstOrThrow({
      where: { userId: user.id, tenantId: tenant.id },
    });

    const res = await request(app)
      .delete(`/api/users/${membership.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/last active owner/i);
  });

  it("removes a membership without deleting the person", async () => {
    const first = await track(createTenantWithOwner("Omicron Co"));
    const person = await createUserWithPassword(first.tenant.id, Role.CASHIER);
    const membership = await prisma.membership.findFirstOrThrow({
      where: { userId: person.id },
    });

    const res = await request(app)
      .delete(`/api/users/${membership.id}`)
      .set("Authorization", `Bearer ${first.token}`);
    expect(res.status).toBe(200);

    expect(
      await prisma.membership.count({ where: { id: membership.id } }),
    ).toBe(0);
    expect(await prisma.user.count({ where: { id: person.id } })).toBe(1);
  });
});

describe("signing in to one of several businesses", () => {
  /**
   * A cashier rather than an owner, so 2FA doesn't need satisfying first —
   * the 2FA-then-selection ordering has its own test below.
   */
  async function cashierInTwoBusinesses() {
    const first = await track(createTenantWithOwner("Pi Co"));
    const second = await track(createTenantWithOwner("Rho Co"));
    const person = await createUserWithPassword(first.tenant.id, Role.CASHIER);
    await prisma.membership.create({
      data: {
        userId: person.id,
        tenantId: second.tenant.id,
        role: Role.CASHIER,
      },
    });
    return { first, second, person };
  }

  it("asks which business, then issues a session for the one chosen", async () => {
    const { first, second, person } = await cashierInTwoBusinesses();

    const login = await request(app)
      .post("/api/auth/login")
      .send({ identifier: person.email, password: TEST_PASSWORD });

    expect(login.status).toBe(200);
    expect(login.body.data.status).toBe("select_business");
    expect(
      login.body.data.businesses.map((b: { tenantId: string }) => b.tenantId).sort(),
    ).toEqual([first.tenant.id, second.tenant.id].sort());
    // No session yet — the picker is not a way around the last step.
    expect(login.body.data.accessToken).toBeUndefined();

    const chosen = await request(app)
      .post("/api/auth/select-business")
      .set("Authorization", `Bearer ${login.body.data.mfaToken}`)
      .send({ tenantId: second.tenant.id });

    expect(chosen.status).toBe(200);
    expect(chosen.body.data.user.tenantId).toBe(second.tenant.id);
    expect(chosen.body.data.accessToken).toBeTruthy();
  });

  it("refuses a business the account has no membership in", async () => {
    const { person } = await cashierInTwoBusinesses();
    const stranger = await track(createTenantWithOwner("Sigma Co"));

    const login = await request(app)
      .post("/api/auth/login")
      .send({ identifier: person.email, password: TEST_PASSWORD });

    const res = await request(app)
      .post("/api/auth/select-business")
      .set("Authorization", `Bearer ${login.body.data.mfaToken}`)
      .send({ tenantId: stranger.tenant.id });

    expect(res.status).toBe(403);
  });

  it("spends the selection token, so it can't be replayed", async () => {
    const { second, person } = await cashierInTwoBusinesses();

    const login = await request(app)
      .post("/api/auth/login")
      .send({ identifier: person.email, password: TEST_PASSWORD });
    const mfaToken = login.body.data.mfaToken;

    await request(app)
      .post("/api/auth/select-business")
      .set("Authorization", `Bearer ${mfaToken}`)
      .send({ tenantId: second.tenant.id });

    const replay = await request(app)
      .post("/api/auth/select-business")
      .set("Authorization", `Bearer ${mfaToken}`)
      .send({ tenantId: second.tenant.id });
    expect(replay.status).toBe(401);
  });

  it("logs straight in when there is only one business", async () => {
    const { tenant } = await track(createTenantWithOwner("Tau Co"));
    const solo = await createUserWithPassword(tenant.id, Role.CASHIER);

    const login = await request(app)
      .post("/api/auth/login")
      .send({ identifier: solo.email, password: TEST_PASSWORD });

    expect(login.body.data.status).toBe("success");
    expect(login.body.data.user.tenantId).toBe(tenant.id);
  });

  it("moves an existing session to another of the caller's businesses", async () => {
    const { first, second, person } = await cashierInTwoBusinesses();
    const token = tokenFor({
      id: person.id,
      tenantId: first.tenant.id,
      role: Role.CASHIER,
    });

    const res = await request(app)
      .post("/api/auth/switch-business")
      .set("Authorization", `Bearer ${token}`)
      .send({ tenantId: second.tenant.id });

    expect(res.status).toBe(200);
    expect(res.body.data.user.tenantId).toBe(second.tenant.id);
  });

  it("won't switch into a business the caller doesn't belong to", async () => {
    const { first, person } = await cashierInTwoBusinesses();
    const stranger = await track(createTenantWithOwner("Upsilon Co"));
    const token = tokenFor({
      id: person.id,
      tenantId: first.tenant.id,
      role: Role.CASHIER,
    });

    const res = await request(app)
      .post("/api/auth/switch-business")
      .set("Authorization", `Bearer ${token}`)
      .send({ tenantId: stranger.tenant.id });

    expect(res.status).toBe(403);
  });

  it("holds the business list back until the second factor is satisfied", async () => {
    // An owner always needs 2FA, so login stops at otp_required and the
    // pending token it hands out must not be usable for selection yet.
    const owner = await track(createTenantWithOwnerAndPassword("Phi Co"));
    const other = await track(createTenantWithOwner("Chi Co"));
    await prisma.membership.create({
      data: {
        userId: owner.user.id,
        tenantId: other.tenant.id,
        role: Role.CASHIER,
      },
    });

    const login = await request(app)
      .post("/api/auth/login")
      .send({ identifier: owner.user.email, password: TEST_PASSWORD });

    expect(login.body.data.status).not.toBe("select_business");
    expect(login.body.data.businesses).toBeUndefined();

    const premature = await request(app)
      .post("/api/auth/select-business")
      .set("Authorization", `Bearer ${login.body.data.mfaToken}`)
      .send({ tenantId: other.tenant.id });

    expect(premature.status).toBe(401);
  });
});

describe("an invitation is not a way past the second factor", () => {
  afterEach(() => {
    sentEmails.length = 0;
  });

  it("makes an existing owner produce their factor before joining", async () => {
    // The invitee already owns a business, so 2FA is mandatory for the
    // account. Holding an emailed invitation proves the address, not the
    // factor — accepting must not hand back a session.
    const home = await track(createTenantWithOwnerAndPassword("Psi Co"));
    const other = await track(createTenantWithOwner("Omega Co"));

    await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${other.token}`)
      .send({ name: "Owner Elsewhere", email: home.user.email, role: Role.CASHIER });

    const accepted = await request(app).post("/api/auth/invites/accept").send({
      token: inviteTokenFor(home.user.email),
      password: TEST_PASSWORD,
    });

    expect(accepted.status).toBe(201);
    expect(accepted.body.data.status).not.toBe("success");
    expect(accepted.body.data.accessToken).toBeUndefined();
    expect(accepted.body.data.mfaToken).toBeTruthy();

    // The membership is still created — the join happened, the session didn't.
    const memberships = await prisma.membership.count({
      where: { user: { email: home.user.email } },
    });
    expect(memberships).toBe(2);
  });

  it("walks someone invited as an owner through setting one up", async () => {
    const { token } = await track(createTenantWithOwner("Alpha Prime Co"));
    const email = `fresh-owner-${Date.now()}@example.test`;

    await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Fresh Owner", email, role: Role.OWNER });

    const accepted = await request(app).post("/api/auth/invites/accept").send({
      token: inviteTokenFor(email),
      password: "FreshOwnerPass123!",
    });

    expect(accepted.status).toBe(201);
    expect(accepted.body.data.status).not.toBe("success");
    expect(accepted.body.data.mfaToken).toBeTruthy();
  });

  it("won't let someone who owns a business elsewhere turn 2FA off here", async () => {
    const owned = await track(createTenantWithOwner("Beta Prime Co"));
    const here = await track(createTenantWithOwner("Gamma Prime Co"));

    // Cashier in this business, owner in another: the session's role says
    // CASHIER, but the account still owns something.
    await prisma.membership.create({
      data: {
        userId: owned.user.id,
        tenantId: here.tenant.id,
        role: Role.CASHIER,
      },
    });
    const cashierHere = tokenFor({
      id: owned.user.id,
      tenantId: here.tenant.id,
      role: Role.CASHIER,
    });

    const res = await request(app)
      .post("/api/auth/2fa/disable")
      .set("Authorization", `Bearer ${cashierHere}`)
      .send({ password: TEST_PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/own a business/i);
  });
});
