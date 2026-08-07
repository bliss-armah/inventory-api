import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../app";
import { prisma } from "../lib/prisma";
import {
  createTenantWithOwner,
  createLocation,
  createProduct,
  deleteTenant,
} from "./fixtures";

/**
 * One tenant must never be able to read or mutate another tenant's data by
 * supplying a valid-looking foreign ID (productId, locationId, ...) in a
 * request body, query string, or URL param. Tenant isolation is enforced in
 * two different ways depending on the endpoint:
 *  - IDs read from the URL (`GET/PATCH /:id`) are scoped by a `findFirst({
 *    where: { id, tenantId } })` lookup, so a cross-tenant ID just 404s.
 *  - IDs read from the request body (productId, locationId, ... on a
 *    create) are validated by `shared/ownership.ts#assertOwned`, which 400s.
 * This suite exercises one representative endpoint of each shape per
 * module that accepts foreign IDs, rather than every mutating route —
 * matching the roadmap's "prioritize by risk, not coverage" guidance.
 */
describe("cross-tenant isolation", () => {
  let tenantA: Awaited<ReturnType<typeof createTenantWithOwner>>;
  let tenantB: Awaited<ReturnType<typeof createTenantWithOwner>>;
  let productA: Awaited<ReturnType<typeof createProduct>>;
  let locationA: Awaited<ReturnType<typeof createLocation>>;
  let supplierA: { id: string };

  beforeAll(async () => {
    tenantA = await createTenantWithOwner("Tenant A");
    tenantB = await createTenantWithOwner("Tenant B");
    productA = await createProduct(tenantA.tenant.id);
    locationA = await createLocation(tenantA.tenant.id);
    supplierA = await prisma.supplier.create({
      data: { tenantId: tenantA.tenant.id, name: "Supplier A" },
    });
  });

  afterAll(async () => {
    await deleteTenant(tenantA.tenant.id);
    await deleteTenant(tenantB.tenant.id);
  });

  it("400s creating a stock adjustment against another tenant's product/location", async () => {
    const res = await request(app)
      .post("/api/stock-adjustments")
      .set("Authorization", `Bearer ${tenantB.token}`)
      .send({
        productId: productA.id,
        locationId: locationA.id,
        quantity: 5,
        reason: "FOUND_INVENTORY",
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("400s creating a purchase order against another tenant's supplier/location/product", async () => {
    const res = await request(app)
      .post("/api/purchase-orders")
      .set("Authorization", `Bearer ${tenantB.token}`)
      .send({
        supplierId: supplierA.id,
        locationId: locationA.id,
        items: [{ productId: productA.id, quantityOrdered: 1, costPrice: 1 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("400s creating a stock transfer between another tenant's locations", async () => {
    const locationA2 = await createLocation(tenantA.tenant.id, "Secondary");
    const res = await request(app)
      .post("/api/stock-transfers")
      .set("Authorization", `Bearer ${tenantB.token}`)
      .send({
        fromLocationId: locationA.id,
        toLocationId: locationA2.id,
        items: [{ productId: productA.id, quantity: 1 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("404s fetching another tenant's product by ID", async () => {
    const res = await request(app)
      .get(`/api/products/${productA.id}`)
      .set("Authorization", `Bearer ${tenantB.token}`);

    expect(res.status).toBe(404);
  });

  it("404s updating another tenant's product by ID", async () => {
    const res = await request(app)
      .patch(`/api/products/${productA.id}`)
      .set("Authorization", `Bearer ${tenantB.token}`)
      .send({ name: "Hijacked name" });

    expect(res.status).toBe(404);

    const stillIntact = await prisma.product.findUnique({ where: { id: productA.id } });
    expect(stillIntact?.name).toBe(productA.name);
  });

  it("never returns another tenant's rows in a list endpoint", async () => {
    const res = await request(app)
      .get("/api/products")
      .set("Authorization", `Bearer ${tenantB.token}`);

    expect(res.status).toBe(200);
    const ids = res.body.data.items.map((item: { id: string }) => item.id);
    expect(ids).not.toContain(productA.id);
  });
});
