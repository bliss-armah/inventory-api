import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../app";
import { prisma } from "../lib/prisma.ts";
import { createTenantWithOwner, deleteTenant } from "./fixtures.ts";

const tenantIds: string[] = [];
afterAll(async () => {
  for (const id of tenantIds) await deleteTenant(id);
});

async function shop() {
  const created = await createTenantWithOwner("Search Co");
  tenantIds.push(created.tenant.id);
  const category = await prisma.category.create({
    data: { tenantId: created.tenant.id, name: "Grains" },
  });

  await prisma.product.createMany({
    data: [
      { tenantId: created.tenant.id, sku: "S-RICE", name: "Rice 5kg", description: "Long grain staple", unit: "bag", costPrice: 40, sellingPrice: 55, categoryId: category.id, barcode: "2000000000017" },
      { tenantId: created.tenant.id, sku: "S-OIL", name: "Cooking Oil", description: "Sunflower", unit: "bottle", costPrice: 20, sellingPrice: 30 },
      { tenantId: created.tenant.id, sku: "S-SUGAR", name: "Sugar 1kg", unit: "bag", costPrice: 5, sellingPrice: 9, categoryId: category.id },
    ],
  });
  return { ...created, category };
}

function search(token: string, query: string) {
  return request(app).get(`/api/products?${query}`).set("Authorization", `Bearer ${token}`);
}
const skus = (res: request.Response) =>
  res.body.data.items.map((item: { sku: string }) => item.sku);

describe("searching products", () => {
  it("matches the description as well as name, sku and barcode", async () => {
    const { token } = await shop();

    expect(skus(await search(token, "search=sunflower"))).toEqual(["S-OIL"]);
    expect(skus(await search(token, "search=Rice"))).toEqual(["S-RICE"]);
    expect(skus(await search(token, "search=2000000000017"))).toEqual(["S-RICE"]);
  });
});

describe("filtering products", () => {
  it("filters by a selling price range", async () => {
    const { token } = await shop();

    expect(skus(await search(token, "minPrice=10&maxPrice=40")).sort()).toEqual(["S-OIL"]);
    expect(skus(await search(token, "minPrice=50"))).toEqual(["S-RICE"]);
    expect(skus(await search(token, "maxPrice=10"))).toEqual(["S-SUGAR"]);
  });

  it("filters by whether a barcode exists", async () => {
    const { token } = await shop();

    expect(skus(await search(token, "hasBarcode=true"))).toEqual(["S-RICE"]);
    expect(skus(await search(token, "hasBarcode=false")).sort()).toEqual(["S-OIL", "S-SUGAR"]);
  });

  it("finds products with no category at all", async () => {
    const { token } = await shop();

    expect(skus(await search(token, "categoryId=none"))).toEqual(["S-OIL"]);
  });

  it("still filters by a real category id", async () => {
    const { token, category } = await shop();

    expect(skus(await search(token, `categoryId=${category.id}`)).sort()).toEqual([
      "S-RICE",
      "S-SUGAR",
    ]);
  });

  it("combines filters rather than letting the last one win", async () => {
    const { token, category } = await shop();

    expect(skus(await search(token, `categoryId=${category.id}&maxPrice=10`))).toEqual([
      "S-SUGAR",
    ]);
  });
});

describe("sorting products", () => {
  it("defaults to name ascending", async () => {
    const { token } = await shop();

    expect(skus(await search(token, ""))).toEqual(["S-OIL", "S-RICE", "S-SUGAR"]);
  });

  it("sorts by price in both directions", async () => {
    const { token } = await shop();

    expect(skus(await search(token, "sort=sellingPrice&order=asc"))).toEqual([
      "S-SUGAR", "S-OIL", "S-RICE",
    ]);
    expect(skus(await search(token, "sort=sellingPrice&order=desc"))).toEqual([
      "S-RICE", "S-OIL", "S-SUGAR",
    ]);
  });

  it("rejects a column that is not sortable rather than ignoring it", async () => {
    const { token } = await shop();

    const res = await search(token, "sort=passwordHash");

    expect(res.status).toBe(400);
  });
});
