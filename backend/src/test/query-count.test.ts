import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../app";
import { prisma } from "../lib/prisma.ts";
import {
  createLocation,
  createProduct,
  createTenantWithOwner,
  deleteTenant,
  enablePos,
  seedStock,
} from "./fixtures.ts";
import { countQueries } from "./query-counter.ts";

const SMALL = 3;
const LARGE = 12;

let tenantId: string;
let token: string;
let locationId: string;

beforeAll(async () => {
  const created = await createTenantWithOwner("Query Count Co");
  tenantId = created.tenant.id;
  token = created.token;
  locationId = (await createLocation(tenantId)).id;
  await enablePos(tenantId);
});

afterAll(async () => {
  await deleteTenant(tenantId);
});

async function stockedProducts(count: number) {
  return Promise.all(
    Array.from({ length: count }, async () => {
      const product = await createProduct(tenantId);
      await seedStock(tenantId, product.id, locationId, 50);
      return product;
    }),
  );
}

function auth(req: request.Test) {
  return req.set("Authorization", `Bearer ${token}`);
}

describe("query count does not grow with the number of rows", () => {
  it("bulk product status change", async () => {
    const small = await stockedProducts(SMALL);
    const large = await stockedProducts(LARGE);

    const run = (products: Array<{ id: string }>) =>
      countQueries(() =>
        auth(request(app).patch("/api/products/bulk")).send({
          productIds: products.map((product) => product.id),
          status: "INACTIVE",
        }),
      );

    const smallReport = await run(small);
    const largeReport = await run(large);

    expect(largeReport.total).toBe(smallReport.total);
  });

  it("bulk product price change reads the products once", async () => {
    const small = await stockedProducts(SMALL);
    const large = await stockedProducts(LARGE);

    const run = (products: Array<{ id: string }>) =>
      countQueries(() =>
        auth(request(app).patch("/api/products/bulk")).send({
          productIds: products.map((product) => product.id),
          priceChange: { field: "sellingPrice", mode: "set", value: 99 },
        }),
      );

    const smallReport = await run(small);
    const largeReport = await run(large);

    expect(largeReport.selects).toBe(smallReport.selects);
  });

  it("CSV import looks up existing products once", async () => {
    const header =
      "sku,barcode,name,description,category,brand,unit,costPrice,sellingPrice,minimumStock,status";
    const rows = (prefix: string, count: number, price: number) =>
      [
        header,
        ...Array.from(
          { length: count },
          (_, index) => `${prefix}-${index},,Item ${index},,,,unit,5,${price},0,ACTIVE`,
        ),
      ].join("\n");
    const importCsv = (body: string) =>
      countQueries(() =>
        auth(request(app).post("/api/products/import.csv"))
          .set("Content-Type", "text/csv")
          .send(body),
      );

    await importCsv(rows("QS", SMALL, 10));
    await importCsv(rows("QL", LARGE, 10));

    const smallReport = await importCsv(rows("QS", SMALL, 20));
    const largeReport = await importCsv(rows("QL", LARGE, 20));

    expect(largeReport.selects).toBe(smallReport.selects);
  });

  it("generating missing barcodes checks for collisions once", async () => {
    const run = async (count: number) => {
      await prisma.product.createMany({
        data: Array.from({ length: count }, () => ({
          tenantId,
          sku: `NB-${randomUUID()}`,
          name: "No barcode",
          unit: "unit",
          costPrice: 1,
          sellingPrice: 2,
        })),
      });
      return countQueries(() =>
        auth(request(app).post("/api/products/barcodes/generate-missing")),
      );
    };

    const smallReport = await run(SMALL);
    const largeReport = await run(LARGE);

    expect(largeReport.selects).toBe(smallReport.selects);
  });

  it("saving order picking writes once for lines picked to the same quantity", async () => {
    const run = async (count: number) => {
      const products = await stockedProducts(count);
      const created = await auth(request(app).post("/api/orders")).send({
        id: randomUUID(),
        locationId,
        items: products.map((product) => ({ productId: product.id, quantity: 1 })),
      });
      expect(created.status).toBe(201);
      const items: Array<{ id: string }> = created.body.data.items;
      return countQueries(() =>
        auth(request(app).put(`/api/orders/${created.body.data.id}/picking`)).send({
          items: items.map((item) => ({ itemId: item.id, pickedQuantity: 1 })),
        }),
      );
    };

    const smallReport = await run(SMALL);
    const largeReport = await run(LARGE);

    expect(largeReport.total).toBe(smallReport.total);
  });

  it("saving stock count entries writes once for all items", async () => {
    const run = async (count: number) => {
      const products = await stockedProducts(count);
      const created = await auth(request(app).post("/api/stock-counts")).send({ locationId });
      expect(created.status).toBe(201);
      const counted = products.slice(0, count);
      return countQueries(() =>
        auth(request(app).patch(`/api/stock-counts/${created.body.data.id}/items`)).send({
          items: counted.map((product) => ({ productId: product.id, physicalQuantity: 7 })),
        }),
      );
    };

    const smallReport = await run(SMALL);
    const largeReport = await run(LARGE);

    expect(largeReport.total).toBe(smallReport.total);
  });
});
