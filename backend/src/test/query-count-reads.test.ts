import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../app";
import { prisma } from "../lib/prisma.ts";
import {
  createLocation,
  createTenantWithOwner,
  deleteTenant,
  enablePos,
} from "./fixtures.ts";
import { countQueries } from "./query-counter.ts";

const ENDPOINTS = [
  "/api/products",
  "/api/inventory",
  "/api/customers",
  "/api/suppliers",
  "/api/categories",
  "/api/brands",
  "/api/locations",
  "/api/users",
  "/api/stock-movements",
  "/api/stock-adjustments",
  "/api/stock-counts",
  "/api/stock-transfers",
  "/api/purchase-orders",
  "/api/orders",
  "/api/sales",
  "/api/activity",
  "/api/dashboard",
  "/api/sales/catalog",
  "/api/reports/current-stock",
  "/api/reports/low-stock",
  "/api/reports/out-of-stock",
  "/api/reports/inventory-valuation",
  "/api/reports/fast-moving",
  "/api/reports/slow-moving",
  "/api/reports/dead-stock",
  "/api/reports/sales-summary",
  "/api/reports/discounts",
  "/api/reports/purchase-history",
];

let tenantId: string;
let userId: string;
let token: string;
let locationId: string;
let categoryIds: string[];
let brandIds: string[];

beforeAll(async () => {
  const created = await createTenantWithOwner("Read Count Co");
  tenantId = created.tenant.id;
  userId = created.user.id;
  token = created.token;
  locationId = (await createLocation(tenantId)).id;
  await enablePos(tenantId);
  categoryIds = [];
  brandIds = [];
  for (let index = 0; index < 3; index += 1) {
    categoryIds.push((await prisma.category.create({ data: { tenantId, name: `Cat ${randomUUID()}` } })).id);
    brandIds.push((await prisma.brand.create({ data: { tenantId, name: `Brand ${randomUUID()}` } })).id);
  }
});

afterAll(async () => {
  await deleteTenant(tenantId);
});

async function grow(count: number) {
  for (let index = 0; index < count; index += 1) {
    const product = await prisma.product.create({
      data: {
        tenantId,
        sku: `RC-${randomUUID()}`,
        name: `Read product ${index}`,
        unit: "unit",
        costPrice: 5,
        sellingPrice: 9,
        minimumStock: 100,
        categoryId: categoryIds[index % categoryIds.length],
        brandId: brandIds[index % brandIds.length],
      },
    });
    await prisma.inventory.create({
      data: { tenantId, productId: product.id, locationId, quantity: index % 2 === 0 ? 0 : 40 },
    });
    await prisma.stockMovement.create({
      data: {
        tenantId,
        productId: product.id,
        locationId,
        userId,
        type: "PURCHASE",
        quantity: 40,
        beforeQuantity: 0,
        afterQuantity: 40,
      },
    });
    await prisma.stockAdjustment.create({
      data: {
        tenantId,
        productId: product.id,
        locationId,
        userId,
        quantity: 1,
        reason: "COUNTING_ERROR",
      },
    });
    await prisma.customer.create({ data: { tenantId, name: `Customer ${randomUUID()}` } });
    await prisma.supplier.create({ data: { tenantId, name: `Supplier ${randomUUID()}` } });
    await prisma.activityLog.create({
      data: { tenantId, userId, action: "TEST", description: "row" },
    });
    await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        id: randomUUID(),
        locationId,
        items: [{ productId: product.id, quantity: 1 }],
      });
  }
}

async function measure(url: string) {
  let status = 0;
  const report = await countQueries(async () => {
    const res = await request(app).get(url).set("Authorization", `Bearer ${token}`);
    status = res.status;
  });
  return { ...report, status };
}

describe("read endpoints run the same queries whatever the row count", () => {
  it("does not grow any list, detail or report query with more data", async () => {
    await grow(3);
    const small = new Map<string, Awaited<ReturnType<typeof measure>>>();
    for (const url of ENDPOINTS) small.set(url, await measure(url));

    await grow(12);
    const grown: string[] = [];
    for (const url of ENDPOINTS) {
      const before = small.get(url)!;
      const after = await measure(url);
      expect(after.status, `${url} status`).toBe(before.status);
      if (after.total !== before.total) {
        grown.push(`${url}: ${before.total} -> ${after.total}`);
      }
    }

    expect(grown).toEqual([]);
  });

  it("reaches every endpoint with a success status", async () => {
    const failures: string[] = [];
    for (const url of ENDPOINTS) {
      const { status } = await measure(url);
      if (status !== 200) failures.push(`${url}: ${status}`);
    }
    expect(failures).toEqual([]);
  });
});
