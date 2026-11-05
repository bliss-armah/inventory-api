import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../app";
import { prisma } from "../lib/prisma";
import {
  createCashier,
  createLocation,
  createProduct,
  createTenantWithOwner,
  deleteTenant,
  seedStock,
  tokenFor,
} from "./fixtures";

describe("bulk stock adjustments", { retry: 0 }, () => {
  let tenant: Awaited<ReturnType<typeof createTenantWithOwner>>;
  let other: Awaited<ReturnType<typeof createTenantWithOwner>>;
  let location: Awaited<ReturnType<typeof createLocation>>;

  beforeAll(async () => {
    tenant = await createTenantWithOwner("Bulk Adjust Co");
    other = await createTenantWithOwner("Other Bulk Co");
    location = await createLocation(tenant.tenant.id);
  });

  afterAll(async () => {
    await deleteTenant(tenant.tenant.id);
    await deleteTenant(other.tenant.id);
  });

  async function stocked(quantity: number) {
    const product = await createProduct(tenant.tenant.id);
    await seedStock(tenant.tenant.id, product.id, location.id, quantity);
    return product;
  }

  async function quantityOf(productId: string) {
    const row = await prisma.inventory.findUniqueOrThrow({
      where: { productId_locationId: { productId, locationId: location.id } },
    });
    return row.quantity;
  }

  function bulk(token: string, body: Record<string, unknown>) {
    return request(app)
      .post("/api/stock-adjustments/bulk")
      .set("Authorization", `Bearer ${token}`)
      .send({ locationId: location.id, reason: "COUNTING_ERROR", ...body });
  }

  it("applies signed changes to many products in one request", async () => {
    const a = await stocked(10);
    const b = await stocked(10);

    const res = await bulk(tenant.token, {
      mode: "DELTA",
      items: [
        { productId: a.id, quantity: 5 },
        { productId: b.id, quantity: -4 },
      ],
    });

    expect(res.status).toBe(201);
    expect(res.body.data.changed).toBe(2);
    expect(await quantityOf(a.id)).toBe(15);
    expect(await quantityOf(b.id)).toBe(6);
    expect(await prisma.stockAdjustment.count({ where: { productId: { in: [a.id, b.id] } } })).toBe(2);
    expect(await prisma.stockMovement.count({ where: { productId: { in: [a.id, b.id] }, type: "ADJUSTMENT" } })).toBe(2);
  });

  it("sets stock to the counted quantity and records only the difference", async () => {
    const a = await stocked(10);
    const b = await stocked(7);

    const res = await bulk(tenant.token, {
      mode: "SET",
      items: [
        { productId: a.id, quantity: 12 },
        { productId: b.id, quantity: 7 },
      ],
    });

    expect(res.status).toBe(201);
    expect(res.body.data.changed).toBe(1);
    expect(res.body.data.unchanged).toBe(1);
    expect(await quantityOf(a.id)).toBe(12);
    expect(await quantityOf(b.id)).toBe(7);
    const adjustment = await prisma.stockAdjustment.findFirstOrThrow({ where: { productId: a.id } });
    expect(adjustment.quantity).toBe(2);
    expect(await prisma.stockAdjustment.count({ where: { productId: b.id } })).toBe(0);
  });

  it("rolls everything back when one line would take stock below zero", async () => {
    const plenty = await stocked(10);
    const scarce = await stocked(2);

    const res = await bulk(tenant.token, {
      mode: "DELTA",
      items: [
        { productId: plenty.id, quantity: 5 },
        { productId: scarce.id, quantity: -5 },
      ],
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain(scarce.name);
    expect(await quantityOf(plenty.id)).toBe(10);
    expect(await quantityOf(scarce.id)).toBe(2);
    expect(await prisma.stockAdjustment.count({ where: { productId: { in: [plenty.id, scarce.id] } } })).toBe(0);
  });

  it("merges repeated products into one change", async () => {
    const a = await stocked(10);

    const res = await bulk(tenant.token, {
      mode: "DELTA",
      items: [
        { productId: a.id, quantity: 3 },
        { productId: a.id, quantity: 4 },
      ],
    });

    expect(res.status).toBe(201);
    expect(await quantityOf(a.id)).toBe(17);
    expect(await prisma.stockAdjustment.count({ where: { productId: a.id } })).toBe(1);
  });

  it("rejects a zero change and a negative counted quantity", async () => {
    const a = await stocked(10);

    const zero = await bulk(tenant.token, { mode: "DELTA", items: [{ productId: a.id, quantity: 0 }] });
    const negative = await bulk(tenant.token, { mode: "SET", items: [{ productId: a.id, quantity: -1 }] });

    expect(zero.status).toBe(400);
    expect(negative.status).toBe(400);
    expect(await quantityOf(a.id)).toBe(10);
  });

  it("refuses another business's products", async () => {
    const foreign = await createProduct(other.tenant.id);

    const res = await bulk(tenant.token, {
      mode: "DELTA",
      items: [{ productId: foreign.id, quantity: 1 }],
    });

    expect(res.status).toBe(400);
  });

  it("is owner-only", async () => {
    const a = await stocked(10);
    const cashier = await createCashier(tenant.tenant.id);

    const res = await bulk(tokenFor(cashier), {
      mode: "DELTA",
      items: [{ productId: a.id, quantity: 1 }],
    });

    expect(res.status).toBe(403);
    expect(await quantityOf(a.id)).toBe(10);
  });

  it("requires at least one line", async () => {
    const res = await bulk(tenant.token, { mode: "DELTA", items: [] });
    expect(res.status).toBe(400);
  });
});
