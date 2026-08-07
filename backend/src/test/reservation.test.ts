import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../app";
import { prisma } from "../lib/prisma";
import { createTenantWithOwner, createLocation, createProduct, deleteTenant } from "./fixtures";

/**
 * Approving a stock transfer reserves stock at the source location so it
 * can't be double-committed — sold, adjusted away, or claimed by another
 * transfer — before this one actually dispatches. This suite exercises the
 * full lifecycle of that guarantee end to end via real HTTP requests.
 */
describe("stock transfer reservations", () => {
  let tenant: Awaited<ReturnType<typeof createTenantWithOwner>>;
  let fromLocation: Awaited<ReturnType<typeof createLocation>>;
  let toLocation: Awaited<ReturnType<typeof createLocation>>;
  let product: Awaited<ReturnType<typeof createProduct>>;

  beforeAll(async () => {
    tenant = await createTenantWithOwner("Reservation Co");
  });

  afterAll(async () => {
    await deleteTenant(tenant.tenant.id);
  });

  beforeEach(async () => {
    product = await createProduct(tenant.tenant.id);
    fromLocation = await createLocation(tenant.tenant.id, "Source");
    toLocation = await createLocation(tenant.tenant.id, "Destination");

    // Seed 10 units on hand at the source location the same way the app
    // itself would — through a real stock movement, not a direct DB write.
    await request(app)
      .post("/api/stock-adjustments")
      .set("Authorization", `Bearer ${tenant.token}`)
      .send({
        productId: product.id,
        locationId: fromLocation.id,
        quantity: 10,
        reason: "FOUND_INVENTORY",
      })
      .expect(201);
  });

  async function createAndApproveTransfer(quantity: number) {
    const createRes = await request(app)
      .post("/api/stock-transfers")
      .set("Authorization", `Bearer ${tenant.token}`)
      .send({
        fromLocationId: fromLocation.id,
        toLocationId: toLocation.id,
        items: [{ productId: product.id, quantity }],
      });
    expect(createRes.status).toBe(201);
    return createRes.body.data.id as string;
  }

  it("reserves stock on approval and reflects it in inventory", async () => {
    const transferId = await createAndApproveTransfer(4);

    const approveRes = await request(app)
      .post(`/api/stock-transfers/${transferId}/approve`)
      .set("Authorization", `Bearer ${tenant.token}`);
    expect(approveRes.status).toBe(200);

    const inventory = await prisma.inventory.findUnique({
      where: { productId_locationId: { productId: product.id, locationId: fromLocation.id } },
    });
    expect(inventory?.quantity).toBe(10);
    expect(inventory?.reservedQuantity).toBe(4);
  });

  it("rejects approving a second transfer once reserved stock exhausts what's available", async () => {
    const firstId = await createAndApproveTransfer(7);
    await request(app)
      .post(`/api/stock-transfers/${firstId}/approve`)
      .set("Authorization", `Bearer ${tenant.token}`)
      .expect(200);

    // 10 on hand, 7 reserved -> only 3 available; requesting 5 must fail.
    const secondId = await createAndApproveTransfer(5);
    const res = await request(app)
      .post(`/api/stock-transfers/${secondId}/approve`)
      .set("Authorization", `Bearer ${tenant.token}`);

    expect(res.status).toBe(400);

    const second = await prisma.stockTransfer.findUnique({ where: { id: secondId } });
    expect(second?.status).toBe("PENDING");

    const inventory = await prisma.inventory.findUnique({
      where: { productId_locationId: { productId: product.id, locationId: fromLocation.id } },
    });
    expect(inventory?.reservedQuantity).toBe(7); // unchanged by the failed approval
  });

  it("releases the reservation when an approved transfer is canceled", async () => {
    const transferId = await createAndApproveTransfer(6);
    await request(app)
      .post(`/api/stock-transfers/${transferId}/approve`)
      .set("Authorization", `Bearer ${tenant.token}`)
      .expect(200);

    await request(app)
      .post(`/api/stock-transfers/${transferId}/cancel`)
      .set("Authorization", `Bearer ${tenant.token}`)
      .expect(200);

    const inventory = await prisma.inventory.findUnique({
      where: { productId_locationId: { productId: product.id, locationId: fromLocation.id } },
    });
    expect(inventory?.reservedQuantity).toBe(0);
    expect(inventory?.quantity).toBe(10); // canceling never moves stock, only unreserves it
  });

  it("releases the reservation and moves stock on dispatch", async () => {
    const transferId = await createAndApproveTransfer(6);
    await request(app)
      .post(`/api/stock-transfers/${transferId}/approve`)
      .set("Authorization", `Bearer ${tenant.token}`)
      .expect(200);

    await request(app)
      .post(`/api/stock-transfers/${transferId}/dispatch`)
      .set("Authorization", `Bearer ${tenant.token}`)
      .expect(200);

    const inventory = await prisma.inventory.findUnique({
      where: { productId_locationId: { productId: product.id, locationId: fromLocation.id } },
    });
    expect(inventory?.reservedQuantity).toBe(0);
    expect(inventory?.quantity).toBe(4); // 10 - 6 dispatched
  });

  it("refuses an unrelated stock adjustment that would eat into reserved stock", async () => {
    const transferId = await createAndApproveTransfer(8);
    await request(app)
      .post(`/api/stock-transfers/${transferId}/approve`)
      .set("Authorization", `Bearer ${tenant.token}`)
      .expect(200);

    // 10 on hand, 8 reserved -> only 2 available; a -3 DAMAGE adjustment
    // would drop quantity to 7, below the 8 reserved for the transfer.
    const res = await request(app)
      .post("/api/stock-adjustments")
      .set("Authorization", `Bearer ${tenant.token}`)
      .send({
        productId: product.id,
        locationId: fromLocation.id,
        quantity: -3,
        reason: "DAMAGE",
      });

    expect(res.status).toBe(400);

    const inventory = await prisma.inventory.findUnique({
      where: { productId_locationId: { productId: product.id, locationId: fromLocation.id } },
    });
    expect(inventory?.quantity).toBe(10); // rejected, unchanged
  });
});
