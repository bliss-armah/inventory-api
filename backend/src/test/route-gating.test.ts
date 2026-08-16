import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../app";
import {
  createCashier,
  createTenantWithOwner,
  deleteTenant,
  enablePos,
  tokenFor,
} from "./fixtures";

/**
 * Read routes that used to carry `authenticate` with no `authorize(...)`, so
 * every authenticated role reached them. With only OWNER and CASHIER left,
 * an ungated route is an open door to the whole back office — these assert
 * the door is now shut for a cashier and still open for the owner.
 */
const OWNER_ONLY_READS = [
  "/api/brands",
  "/api/categories",
  "/api/locations",
  "/api/suppliers",
  "/api/stock-adjustments",
  "/api/stock-counts",
  "/api/stock-transfers",
  "/api/tenants/me",
  "/api/tenants/me/settings",
];

describe("owner-only read routes", () => {
  let tenant: Awaited<ReturnType<typeof createTenantWithOwner>>;
  let cashierToken: string;

  beforeAll(async () => {
    tenant = await createTenantWithOwner("Gated Reads Co");
    await enablePos(tenant.tenant.id);
    cashierToken = tokenFor(await createCashier(tenant.tenant.id));
  });

  afterAll(async () => {
    await deleteTenant(tenant.tenant.id);
  });

  it("403s a cashier on every owner-only read route", async () => {
    for (const path of OWNER_ONLY_READS) {
      const res = await request(app)
        .get(path)
        .set("Authorization", `Bearer ${cashierToken}`);

      expect(res.status, path).toBe(403);
    }
  });

  it("still serves the owner on every one of those routes", async () => {
    for (const path of OWNER_ONLY_READS) {
      const res = await request(app)
        .get(path)
        .set("Authorization", `Bearer ${tenant.token}`);

      expect(res.status, path).toBe(200);
    }
  });

  it("401s an unauthenticated caller before role checks apply", async () => {
    const res = await request(app).get("/api/brands");

    expect(res.status).toBe(401);
  });
});
