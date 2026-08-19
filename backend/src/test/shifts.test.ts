import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../app";
import { prisma } from "../lib/prisma";
import { LocationStatus } from "../generated/prisma/enums";
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

/**
 * A cashier is forbidden from reading /locations (PERMISSIONS.locations.view is
 * owner-only), so the till cannot name a location even when the business has
 * exactly one. These cover the server resolving it instead — and the one case
 * where it still has to ask.
 */
describe("opening a shift without naming a location", () => {
  const tenantIds: string[] = [];

  afterAll(async () => {
    for (const id of tenantIds) {
      await deleteTenant(id);
    }
  });

  async function posTenant(namePrefix: string) {
    const created = await createTenantWithOwner(namePrefix);
    tenantIds.push(created.tenant.id);
    await enablePos(created.tenant.id);
    return created;
  }

  it("uses the only active location when there is just one", async () => {
    const { tenant } = await posTenant("One Location Co");
    const only = await createLocation(tenant.id, "Solo");
    const cashier = await createCashier(tenant.id);

    const res = await request(app)
      .post("/api/shifts")
      .set("Authorization", `Bearer ${tokenFor(cashier)}`)
      .send({ openingFloat: "120.00" });

    expect(res.status).toBe(201);
    const shift = await prisma.shift.findUnique({ where: { id: res.body.data.id } });
    expect(shift?.locationId).toBe(only.id);
  });

  it("prefers the default location when several are active", async () => {
    const { tenant } = await posTenant("Defaulted Co");
    await createLocation(tenant.id, "Annex");
    const main = await createLocation(tenant.id, "Flagship");
    await prisma.location.update({
      where: { id: main.id },
      data: { isDefault: true },
    });
    const cashier = await createCashier(tenant.id);

    const res = await request(app)
      .post("/api/shifts")
      .set("Authorization", `Bearer ${tokenFor(cashier)}`)
      .send({ openingFloat: "80.00" });

    expect(res.status).toBe(201);
    const shift = await prisma.shift.findUnique({ where: { id: res.body.data.id } });
    expect(shift?.locationId).toBe(main.id);
  });

  it("asks for a location only when several are active and none is default", async () => {
    const { tenant } = await posTenant("Ambiguous Co");
    await createLocation(tenant.id, "North");
    await createLocation(tenant.id, "South");
    const cashier = await createCashier(tenant.id);

    const res = await request(app)
      .post("/api/shifts")
      .set("Authorization", `Bearer ${tokenFor(cashier)}`)
      .send({ openingFloat: "60.00" });

    expect(res.status).toBe(400);
    expect(res.body.errors?.locationId).toBeTruthy();
  });

  it("ignores inactive locations when resolving", async () => {
    const { tenant } = await posTenant("Half Closed Co");
    const live = await createLocation(tenant.id, "Open Branch");
    const shut = await createLocation(tenant.id, "Shut Branch");
    await prisma.location.update({
      where: { id: shut.id },
      data: { status: LocationStatus.INACTIVE },
    });
    const cashier = await createCashier(tenant.id);

    const res = await request(app)
      .post("/api/shifts")
      .set("Authorization", `Bearer ${tokenFor(cashier)}`)
      .send({ openingFloat: "40.00" });

    expect(res.status).toBe(201);
    const shift = await prisma.shift.findUnique({ where: { id: res.body.data.id } });
    expect(shift?.locationId).toBe(live.id);
  });

  it("rejects a shift when the business has no active location at all", async () => {
    const { tenant } = await posTenant("No Location Co");
    const cashier = await createCashier(tenant.id);

    const res = await request(app)
      .post("/api/shifts")
      .set("Authorization", `Bearer ${tokenFor(cashier)}`)
      .send({ openingFloat: "20.00" });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no active location/i);
  });

  it("still honours a location an owner names explicitly", async () => {
    const { tenant } = await posTenant("Owner Choice Co");
    const main = await createLocation(tenant.id, "Main Pick");
    const annex = await createLocation(tenant.id, "Annex Pick");
    await prisma.location.update({
      where: { id: main.id },
      data: { isDefault: true },
    });
    const cashier = await createCashier(tenant.id);

    const res = await request(app)
      .post("/api/shifts")
      .set("Authorization", `Bearer ${tokenFor(cashier)}`)
      .send({ locationId: annex.id, openingFloat: "30.00" });

    expect(res.status).toBe(201);
    const shift = await prisma.shift.findUnique({ where: { id: res.body.data.id } });
    expect(shift?.locationId).toBe(annex.id);
  });

  it("refuses a location belonging to another business", async () => {
    const { tenant } = await posTenant("Borrower Co");
    await createLocation(tenant.id, "Own Branch");
    const other = await posTenant("Lender Co");
    const foreign = await createLocation(other.tenant.id, "Foreign Branch");
    const cashier = await createCashier(tenant.id);

    const res = await request(app)
      .post("/api/shifts")
      .set("Authorization", `Bearer ${tokenFor(cashier)}`)
      .send({ locationId: foreign.id, openingFloat: "30.00" });

    expect(res.status).toBe(400);
  });
});
