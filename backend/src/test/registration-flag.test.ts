import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../app";

/**
 * Businesses are onboarded by a platform admin (POST /api/platform/tenants),
 * so self-service signup is off unless someone deliberately turns it on. The
 * route stays mounted and refuses explicitly rather than 404ing, so the
 * failure reads as "not allowed" instead of "this app has no signup".
 */
describe("public registration flag", () => {
  it("403s registration while the flag is off", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({
        businessName: "Flag Test Co",
        ownerName: "Flag Owner",
        email: `flag-${Date.now()}@example.test`,
        phone: "+10000000000",
        password: "TestPassword123!",
        country: "Testland",
        timeZone: "UTC",
      });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/registration/i);
  });

  it("refuses before validating, so a bad payload still reads as forbidden", async () => {
    const res = await request(app).post("/api/auth/register").send({});

    expect(res.status).toBe(403);
  });
});
