import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../app";
import { prisma } from "../lib/prisma";
import {
  createTenantWithOwner,
  createLocation,
  createCashier,
  tokenFor,
  deleteTenant,
  enablePos,
} from "./fixtures";

describe("shifts", () => {
  let tenant: Awaited<ReturnType<typeof createTenantWithOwner>>;
  let location: Awaited<ReturnType<typeof createLocation>>;

  beforeAll(async () => {
    tenant = await createTenantWithOwner("Shifts Co");
    location = await createLocation(tenant.tenant.id);
    await enablePos(tenant.tenant.id);
  });

  afterAll(async () => {
    await deleteTenant(tenant.tenant.id);
  });

  it("opens a shift and reports it as current", async () => {
    const cashier = await createCashier(tenant.tenant.id);
    const token = tokenFor(cashier);

    const openRes = await request(app)
      .post("/api/shifts")
      .set("Authorization", `Bearer ${token}`)
      .send({ locationId: location.id, openingFloat: "100.00" });

    expect(openRes.status).toBe(201);

    const currentRes = await request(app)
      .get("/api/shifts/current")
      .set("Authorization", `Bearer ${token}`);

    expect(currentRes.body.data.id).toBe(openRes.body.data.id);
  });

  it("allows exactly one open shift per cashier under concurrent attempts", async () => {
    const cashier = await createCashier(tenant.tenant.id);
    const token = tokenFor(cashier);

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app)
          .post("/api/shifts")
          .set("Authorization", `Bearer ${token}`)
          .send({ locationId: location.id, openingFloat: "50.00" }),
      ),
    );

    const created = responses.filter((res) => res.status === 201);
    expect(created).toHaveLength(1);

    const openCount = await prisma.shift.count({
      where: { cashierId: cashier.id, status: "OPEN" },
    });
    expect(openCount).toBe(1);
  });

  it("computes expected cash and variance on close", async () => {
    const cashier = await createCashier(tenant.tenant.id);
    const token = tokenFor(cashier);

    const openRes = await request(app)
      .post("/api/shifts")
      .set("Authorization", `Bearer ${token}`)
      .send({ locationId: location.id, openingFloat: "200.00" });

    const closeRes = await request(app)
      .post(`/api/shifts/${openRes.body.data.id}/close`)
      .set("Authorization", `Bearer ${token}`)
      .send({ countedCash: "195.00" });

    expect(closeRes.status).toBe(200);
    expect(Number(closeRes.body.data.expectedCash)).toBe(200);
    expect(Number(closeRes.body.data.variance)).toBe(-5);
  });

  it("refuses to close another cashier's shift", async () => {
    const owner = tenant.token;
    const cashier = await createCashier(tenant.tenant.id);
    const openRes = await request(app)
      .post("/api/shifts")
      .set("Authorization", `Bearer ${tokenFor(cashier)}`)
      .send({ locationId: location.id, openingFloat: "10.00" });

    const res = await request(app)
      .post(`/api/shifts/${openRes.body.data.id}/close`)
      .set("Authorization", `Bearer ${owner}`)
      .send({ countedCash: "10.00" });

    expect(res.status).toBe(400);
  });

  it("keeps the partial unique index enforcing one open shift per cashier", async () => {
    const rows = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes WHERE indexname = 'shifts_one_open_per_cashier'
    `;
    expect(rows).toHaveLength(1);
  });
});
