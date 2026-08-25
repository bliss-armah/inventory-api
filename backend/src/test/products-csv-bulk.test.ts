import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../app";
import { prisma } from "../lib/prisma.ts";
import { parseCsv } from "../lib/csv.ts";
import { createTenantWithOwner, deleteTenant } from "./fixtures.ts";

const tenantIds: string[] = [];

afterAll(async () => {
  for (const id of tenantIds) await deleteTenant(id);
});

async function tenant(prefix: string) {
  const created = await createTenantWithOwner(prefix);
  tenantIds.push(created.tenant.id);
  return created;
}

function importCsv(token: string, body: string) {
  return request(app)
    .post("/api/products/import.csv")
    .set("Authorization", `Bearer ${token}`)
    .set("Content-Type", "text/csv")
    .send(body);
}

const HEADER =
  "sku,barcode,name,description,category,brand,unit,costPrice,sellingPrice,minimumStock,status";

describe("importing products from CSV", () => {
  it("creates products and gives each one a barcode", async () => {
    const { tenant: t, token } = await tenant("Import Co");

    const res = await importCsv(
      token,
      `${HEADER}\nIMP-1,,Rice,,,,bag,10,15,2,ACTIVE\nIMP-2,,Oil,,,,bottle,20,26,1,ACTIVE`,
    );

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ created: 2, updated: 0, failed: 0 });

    const products = await prisma.product.findMany({ where: { tenantId: t.id } });
    expect(products).toHaveLength(2);
    expect(products.every((product) => product.barcode !== null)).toBe(true);
  });

  it("updates an existing product matched by SKU rather than duplicating it", async () => {
    const { tenant: t, token } = await tenant("Import Co");
    await importCsv(token, `${HEADER}\nIMP-1,,Rice,,,,bag,10,15,2,ACTIVE`);

    const res = await importCsv(
      token,
      `${HEADER}\nIMP-1,,Rice 5kg,,,,bag,12,19,4,ACTIVE`,
    );

    expect(res.body.data).toMatchObject({ created: 0, updated: 1, failed: 0 });
    const products = await prisma.product.findMany({ where: { tenantId: t.id } });
    expect(products).toHaveLength(1);
    expect(products[0]!.name).toBe("Rice 5kg");
    expect(Number(products[0]!.sellingPrice)).toBe(19);
  });

  it("keeps a barcode already on the product when the column is blank", async () => {
    const { tenant: t, token } = await tenant("Import Co");
    await importCsv(token, `${HEADER}\nIMP-1,,Rice,,,,bag,10,15,2,ACTIVE`);
    const before = await prisma.product.findFirst({ where: { tenantId: t.id } });

    await importCsv(token, `${HEADER}\nIMP-1,,Rice Renamed,,,,bag,10,15,2,ACTIVE`);

    const after = await prisma.product.findFirst({ where: { tenantId: t.id } });
    expect(after!.barcode).toBe(before!.barcode);
  });

  it("reports the line number and reason for each bad row, and still imports the good ones", async () => {
    const { token } = await tenant("Import Co");

    const res = await importCsv(
      token,
      [
        HEADER,
        "GOOD-1,,Rice,,,,bag,10,15,2,ACTIVE",
        "BAD-1,,,,,,,,,,",
        "GOOD-1,,Duplicate,,,,bag,1,2,0,ACTIVE",
        "BAD-2,,Ghost,,NoSuchCategory,,bag,1,2,0,ACTIVE",
      ].join("\n"),
    );

    expect(res.body.data.created).toBe(1);
    expect(res.body.data.failed).toBe(3);
    const lines = res.body.data.errors.map((error: { line: number }) => error.line);
    expect(lines).toEqual([3, 4, 5]);
    expect(JSON.stringify(res.body.data.errors)).toMatch(/already appears on line 2/);
    expect(JSON.stringify(res.body.data.errors)).toMatch(/NoSuchCategory/);
  });

  it("resolves a category by name, case-insensitively", async () => {
    const { tenant: t, token } = await tenant("Import Co");
    const category = await prisma.category.create({
      data: { tenantId: t.id, name: "Beverages" },
    });

    await importCsv(token, `${HEADER}\nIMP-1,,Coke,,bEvErAgEs,,pack,1,2,0,ACTIVE`);

    const product = await prisma.product.findFirst({ where: { tenantId: t.id } });
    expect(product!.categoryId).toBe(category.id);
  });

  it("rejects a file whose required columns are missing", async () => {
    const { token } = await tenant("Import Co");

    const res = await importCsv(token, "sku,name\nA-1,Rice");

    expect(res.body.data.created).toBe(0);
    expect(res.body.data.errors[0].message).toMatch(/missing required column/i);
  });

  it("reports an empty file rather than silently doing nothing", async () => {
    const { token } = await tenant("Import Co");

    const res = await importCsv(token, "");

    expect(res.body.data.errors[0].message).toMatch(/empty/i);
  });

  it("refuses a cashier", async () => {
    const { tenant: t } = await tenant("Import Co");
    const { createCashier, tokenFor } = await import("./fixtures.ts");
    const cashier = await createCashier(t.id);

    const res = await importCsv(tokenFor(cashier), `${HEADER}\nIMP-1,,Rice,,,,bag,1,2,0,ACTIVE`);

    expect(res.status).toBe(403);
  });
});

describe("exporting products to CSV", () => {
  it("round-trips through import without changing anything", async () => {
    const { token } = await tenant("Export Co");
    await importCsv(
      token,
      `${HEADER}\nEXP-1,,"Rice, premium",,,,bag,10,15,2,ACTIVE`,
    );

    const exported = await request(app)
      .get("/api/products/export.csv")
      .set("Authorization", `Bearer ${token}`);

    expect(exported.status).toBe(200);
    expect(exported.headers["content-type"]).toMatch(/text\/csv/);

    const table = parseCsv(exported.text);
    expect(table[0]).toEqual(
      "sku,barcode,name,description,category,brand,unit,costPrice,sellingPrice,minimumStock,status".split(","),
    );
    expect(table[1]![2]).toBe("Rice, premium");

    const again = await importCsv(token, exported.text);
    expect(again.body.data).toMatchObject({ created: 0, failed: 0 });
  });

  it("only exports the caller's own products", async () => {
    const mine = await tenant("Export Mine");
    const theirs = await tenant("Export Theirs");
    await importCsv(mine.token, `${HEADER}\nMINE-1,,Mine,,,,bag,1,2,0,ACTIVE`);
    await importCsv(theirs.token, `${HEADER}\nTHEIRS-1,,Theirs,,,,bag,1,2,0,ACTIVE`);

    const exported = await request(app)
      .get("/api/products/export.csv")
      .set("Authorization", `Bearer ${mine.token}`);

    expect(exported.text).toMatch(/MINE-1/);
    expect(exported.text).not.toMatch(/THEIRS-1/);
  });
});

describe("bulk updating products", () => {
  async function seed(token: string) {
    await importCsv(
      token,
      `${HEADER}\nB-1,,One,,,,bag,10,20,0,ACTIVE\nB-2,,Two,,,,bag,10,30,0,ACTIVE`,
    );
  }

  function bulk(token: string, body: Record<string, unknown>) {
    return request(app)
      .patch("/api/products/bulk")
      .set("Authorization", `Bearer ${token}`)
      .send(body);
  }

  it("raises prices by a percentage, rounded to the minor unit", async () => {
    const { tenant: t, token } = await tenant("Bulk Co");
    await seed(token);
    const ids = (await prisma.product.findMany({ where: { tenantId: t.id } })).map((p) => p.id);

    const res = await bulk(token, {
      productIds: ids,
      priceChange: { field: "sellingPrice", mode: "increaseByPercent", value: 10 },
    });

    expect(res.status).toBe(200);
    const after = await prisma.product.findMany({
      where: { tenantId: t.id },
      orderBy: { sku: "asc" },
    });
    expect(Number(after[0]!.sellingPrice)).toBe(22);
    expect(Number(after[1]!.sellingPrice)).toBe(33);
  });

  it("sets a price outright and never below zero on a large decrease", async () => {
    const { tenant: t, token } = await tenant("Bulk Co");
    await seed(token);
    const ids = (await prisma.product.findMany({ where: { tenantId: t.id } })).map((p) => p.id);

    await bulk(token, {
      productIds: ids,
      priceChange: { field: "costPrice", mode: "decreaseByPercent", value: 150 },
    }).expect(200);

    const after = await prisma.product.findMany({ where: { tenantId: t.id } });
    expect(after.every((product) => Number(product.costPrice) === 0)).toBe(true);
  });

  it("changes status for every product named", async () => {
    const { tenant: t, token } = await tenant("Bulk Co");
    await seed(token);
    const ids = (await prisma.product.findMany({ where: { tenantId: t.id } })).map((p) => p.id);

    await bulk(token, { productIds: ids, status: "INACTIVE" }).expect(200);

    const after = await prisma.product.findMany({ where: { tenantId: t.id } });
    expect(after.every((product) => product.status === "INACTIVE")).toBe(true);
  });

  it("refuses when any product belongs to another business, changing nothing", async () => {
    const mine = await tenant("Bulk Mine");
    const theirs = await tenant("Bulk Theirs");
    await seed(mine.token);
    await importCsv(theirs.token, `${HEADER}\nT-1,,Theirs,,,,bag,10,20,0,ACTIVE`);

    const mineIds = (await prisma.product.findMany({ where: { tenantId: mine.tenant.id } })).map(
      (p) => p.id,
    );
    const theirProduct = await prisma.product.findFirst({
      where: { tenantId: theirs.tenant.id },
    });

    const res = await bulk(mine.token, {
      productIds: [...mineIds, theirProduct!.id],
      status: "INACTIVE",
    });

    expect(res.status).toBe(404);
    const untouched = await prisma.product.findMany({ where: { tenantId: mine.tenant.id } });
    expect(untouched.every((product) => product.status === "ACTIVE")).toBe(true);
  });

  it("requires at least one change", async () => {
    const { tenant: t, token } = await tenant("Bulk Co");
    await seed(token);
    const ids = (await prisma.product.findMany({ where: { tenantId: t.id } })).map((p) => p.id);

    const res = await bulk(token, { productIds: ids });

    expect(res.status).toBe(400);
  });

  it("refuses a cashier", async () => {
    const { tenant: t, token } = await tenant("Bulk Co");
    await seed(token);
    const { createCashier, tokenFor } = await import("./fixtures.ts");
    const cashier = await createCashier(t.id);
    const ids = (await prisma.product.findMany({ where: { tenantId: t.id } })).map((p) => p.id);

    const res = await bulk(tokenFor(cashier), { productIds: ids, status: "INACTIVE" });

    expect(res.status).toBe(403);
  });
});
