import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../app";
import { createTenantWithOwner, deleteTenant, enablePos } from "./fixtures";

describe("customers", () => {
  let tenant: Awaited<ReturnType<typeof createTenantWithOwner>>;

  beforeAll(async () => {
    tenant = await createTenantWithOwner("Customers Co");
    await enablePos(tenant.tenant.id);
  });

  afterAll(async () => {
    await deleteTenant(tenant.tenant.id);
  });

  it("creates and reads back a customer", async () => {
    const createRes = await request(app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${tenant.token}`)
      .send({ name: "Ama Mensah", phone: "+233201234567" });

    expect(createRes.status).toBe(201);
    expect(createRes.body.data.name).toBe("Ama Mensah");

    const getRes = await request(app)
      .get(`/api/customers/${createRes.body.data.id}`)
      .set("Authorization", `Bearer ${tenant.token}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.data.phone).toBe("+233201234567");
  });

  it("rejects a duplicate phone number within the same tenant", async () => {
    await request(app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${tenant.token}`)
      .send({ name: "First", phone: "+233209999999" });

    const res = await request(app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${tenant.token}`)
      .send({ name: "Second", phone: "+233209999999" });

    expect(res.status).toBe(409);
  });

  it("allows many customers with no phone number", async () => {
    const first = await request(app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${tenant.token}`)
      .send({ name: "Walk-in A" });
    const second = await request(app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${tenant.token}`)
      .send({ name: "Walk-in B" });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
  });
});
