import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../app";
import { prisma } from "../lib/prisma";
import { createTenantWithOwner, createLocation, createProduct, deleteTenant } from "./fixtures";

/**
 * `recordMovement()` and every workflow transition that touches inventory
 * (PO receive, transfer dispatch/receive, stock count complete) rely on
 * `SELECT ... FOR UPDATE` row locking to serialize concurrent writers on the
 * same aggregate. This suite fires real concurrent HTTP requests — not
 * sequential awaits — at two representative paths and asserts the final
 * state matches what serialized execution would produce, with no lost
 * updates and no over-application past a hard limit.
 */
describe("concurrency: locking serializes concurrent writers", () => {
  let tenant: Awaited<ReturnType<typeof createTenantWithOwner>>;

  beforeAll(async () => {
    tenant = await createTenantWithOwner("Concurrency Co");
  });

  afterAll(async () => {
    await deleteTenant(tenant.tenant.id);
  });

  it("20 concurrent stock adjustments on the same product/location all apply exactly once", async () => {
    const product = await createProduct(tenant.tenant.id);
    const location = await createLocation(tenant.tenant.id);
    const CONCURRENT_REQUESTS = 20;

    const responses = await Promise.all(
      Array.from({ length: CONCURRENT_REQUESTS }, () =>
        request(app)
          .post("/api/stock-adjustments")
          .set("Authorization", `Bearer ${tenant.token}`)
          .send({
            productId: product.id,
            locationId: location.id,
            quantity: 1,
            reason: "FOUND_INVENTORY",
          }),
      ),
    );

    expect(responses.every((res) => res.status === 201)).toBe(true);

    const inventory = await prisma.inventory.findUnique({
      where: { productId_locationId: { productId: product.id, locationId: location.id } },
    });
    expect(inventory?.quantity).toBe(CONCURRENT_REQUESTS);

    const movementCount = await prisma.stockMovement.count({
      where: { productId: product.id, locationId: location.id },
    });
    expect(movementCount).toBe(CONCURRENT_REQUESTS);
  });

  it("concurrent purchase-order receives never over-receive past what was ordered", async () => {
    const product = await createProduct(tenant.tenant.id);
    const location = await createLocation(tenant.tenant.id);
    const supplier = await prisma.supplier.create({
      data: { tenantId: tenant.tenant.id, name: "Concurrency Supplier" },
    });

    const QUANTITY_ORDERED = 10;
    const RECEIVE_ATTEMPTS = 5;
    const QUANTITY_PER_ATTEMPT = 3; // 5 * 3 = 15 > 10 ordered — some must be rejected

    const createRes = await request(app)
      .post("/api/purchase-orders")
      .set("Authorization", `Bearer ${tenant.token}`)
      .send({
        supplierId: supplier.id,
        locationId: location.id,
        items: [{ productId: product.id, quantityOrdered: QUANTITY_ORDERED, costPrice: 1 }],
      });
    expect(createRes.status).toBe(201);
    const orderId = createRes.body.data.id;

    await request(app)
      .post(`/api/purchase-orders/${orderId}/submit`)
      .set("Authorization", `Bearer ${tenant.token}`)
      .expect(200);
    await request(app)
      .post(`/api/purchase-orders/${orderId}/approve`)
      .set("Authorization", `Bearer ${tenant.token}`)
      .expect(200);

    const responses = await Promise.all(
      Array.from({ length: RECEIVE_ATTEMPTS }, () =>
        request(app)
          .post(`/api/purchase-orders/${orderId}/receive`)
          .set("Authorization", `Bearer ${tenant.token}`)
          .send({ items: [{ productId: product.id, quantity: QUANTITY_PER_ATTEMPT, costPrice: 1 }] }),
      ),
    );

    const succeeded = responses.filter((res) => res.status === 201);
    const rejected = responses.filter((res) => res.status === 400);
    expect(succeeded.length + rejected.length).toBe(RECEIVE_ATTEMPTS);
    // Exactly floor(10/3) = 3 attempts can succeed before remaining < 3.
    expect(succeeded.length).toBe(Math.floor(QUANTITY_ORDERED / QUANTITY_PER_ATTEMPT));

    const orderItem = await prisma.purchaseOrderItem.findFirst({
      where: { purchaseOrderId: orderId, productId: product.id },
    });
    expect(orderItem?.quantityReceived).toBe(succeeded.length * QUANTITY_PER_ATTEMPT);
    expect(orderItem!.quantityReceived).toBeLessThanOrEqual(QUANTITY_ORDERED);

    const movementCount = await prisma.stockMovement.count({
      where: { productId: product.id, locationId: location.id, type: "PURCHASE" },
    });
    expect(movementCount).toBe(succeeded.length);
  });
});
