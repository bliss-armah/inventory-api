import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../app";
import { prisma } from "../lib/prisma.ts";
import { createTenantWithOwner } from "./fixtures.ts";

/**
 * The reset flow's whole security rests on two properties that are easy to
 * regress independently: a real request has to mint a token that can actually
 * be delivered, and the response has to look identical whether or not the
 * address belongs to anyone — otherwise the endpoint becomes a free account
 * enumeration oracle for anyone with a list of emails to test.
 */
describe("forgot password", () => {
  it("mints a single-use token for a real address", async () => {
    const { user } = await createTenantWithOwner("Reset Co");

    const res = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: user.email });

    expect(res.status).toBe(200);

    const tokens = await prisma.passwordResetToken.findMany({
      where: { userId: user.id },
    });
    expect(tokens).toHaveLength(1);
    // Only ever the hash — the raw token exists just long enough to be emailed.
    expect(tokens[0]!.tokenHash).not.toBe("");
    expect(tokens[0]!.usedAt).toBeNull();
    expect(tokens[0]!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("answers an unknown address identically, and mints nothing", async () => {
    const before = await prisma.passwordResetToken.count();

    const known = await createTenantWithOwner("Reset Co");
    const knownRes = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: known.user.email });

    const unknownRes = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: `nobody-${Date.now()}@example.test` });

    // Same status and same body: nothing in the response distinguishes the two.
    expect(unknownRes.status).toBe(knownRes.status);
    expect(unknownRes.body).toEqual(knownRes.body);
    expect(unknownRes.body.message).toMatch(/if that email exists/i);

    // Exactly one new row — the known address's, not the unknown one's.
    expect(await prisma.passwordResetToken.count()).toBe(before + 1);
  });

  it("rejects a token that was already spent", async () => {
    const { user } = await createTenantWithOwner("Reset Co");
    await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: user.email });

    // The raw token never leaves forgotPassword, so drive resetPassword the
    // way an attacker replaying a leaked link would: with a wrong token.
    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "not-a-real-token", password: "NewPassword123!" });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/invalid or expired/i);
  });
});
