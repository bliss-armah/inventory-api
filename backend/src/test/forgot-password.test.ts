import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../app";

describe("self-service password reset is gone", () => {
  it("has no forgot-password route for store accounts", async () => {
    const res = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "someone@example.test" });

    expect(res.status).toBe(404);
  });

  it("has no forgot-password route for platform admins", async () => {
    const res = await request(app)
      .post("/api/platform/auth/forgot-password")
      .send({ email: "someone@example.test" });

    expect(res.status).not.toBe(200);
    expect(res.body.message).not.toMatch(/reset link/i);
  });

  it("still rejects a made-up set-password token used by invitations", async () => {
    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "not-a-real-token", password: "NewPassword123!" });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/invalid or expired/i);
  });
});
