import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../app";
import { prisma } from "../lib/prisma.ts";
import { ean13CheckDigit, generateEan13, isValidEan13 } from "../lib/barcode.ts";
import { createTenantWithOwner } from "./fixtures.ts";

async function createProduct(
  token: string,
  overrides: Record<string, unknown> = {},
) {
  const res = await request(app)
    .post("/api/products")
    .set("Authorization", `Bearer ${token}`)
    .send({
      sku: `SKU-${Math.random().toString(36).slice(2, 10)}`,
      name: "Test Product",
      unit: "each",
      costPrice: 10,
      sellingPrice: 15,
      ...overrides,
    });
  return res;
}

describe("EAN-13 generation", () => {
  it("computes the check digit the way the standard does", () => {
    expect(ean13CheckDigit("400638133393")).toBe("1");
    expect(ean13CheckDigit("978020137962")).toBe("4");
    expect(ean13CheckDigit("590123412345")).toBe("7");
  });

  it("always produces a valid, in-store-prefixed code", () => {
    for (let i = 0; i < 500; i += 1) {
      const code = generateEan13();
      expect(code).toHaveLength(13);
      expect(code.startsWith("20")).toBe(true);
      expect(isValidEan13(code)).toBe(true);
    }
  });

  it("rejects a code whose check digit was mistyped", () => {
    const code = generateEan13();
    const wrongLast = String((Number(code[12]) + 1) % 10);
    expect(isValidEan13(code.slice(0, 12) + wrongLast)).toBe(false);
  });
});

describe("POST /api/products/:id/barcode", () => {
  it("assigns a scannable barcode to a product whose barcode was cleared", async () => {
    const { token } = await createTenantWithOwner("Barcode Co");
    const created = await createProduct(token);
    expect(created.status).toBe(201);
    await prisma.product.update({
      where: { id: created.body.data.id },
      data: { barcode: null },
    });

    const res = await request(app)
      .post(`/api/products/${created.body.data.id}/barcode`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(isValidEan13(res.body.data.barcode)).toBe(true);

    const stored = await prisma.product.findUnique({
      where: { id: created.body.data.id },
    });
    expect(stored?.barcode).toBe(res.body.data.barcode);
  });

  it("refuses to overwrite a barcode a product already has", async () => {
    const { token } = await createTenantWithOwner("Barcode Co");
    const created = await createProduct(token, { barcode: "4006381333931" });

    const res = await request(app)
      .post(`/api/products/${created.body.data.id}/barcode`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already has a barcode/i);
  });

  it("404s on another tenant's product", async () => {
    const mine = await createTenantWithOwner("Barcode Co");
    const theirs = await createTenantWithOwner("Other Co");
    const created = await createProduct(theirs.token);

    const res = await request(app)
      .post(`/api/products/${created.body.data.id}/barcode`)
      .set("Authorization", `Bearer ${mine.token}`);

    expect(res.status).toBe(404);
  });
});

describe("barcode uniqueness", () => {
  it("rejects a duplicate barcode, and says barcode rather than SKU", async () => {
    const { token } = await createTenantWithOwner("Barcode Co");
    const barcode = generateEan13();

    const first = await createProduct(token, { barcode });
    expect(first.status).toBe(201);

    const second = await createProduct(token, { barcode });
    expect(second.status).toBe(409);
    expect(second.body.message).toMatch(/barcode/i);
    expect(second.body.errors?.barcode).toBeDefined();
    expect(second.body.errors?.sku).toBeUndefined();
  });

  it("still reports a duplicate SKU as a SKU problem", async () => {
    const { token } = await createTenantWithOwner("Barcode Co");
    const sku = `SKU-${Math.random().toString(36).slice(2, 10)}`;

    expect((await createProduct(token, { sku })).status).toBe(201);

    const second = await createProduct(token, { sku });
    expect(second.status).toBe(409);
    expect(second.body.errors?.sku).toBeDefined();
  });

  it("lets two tenants use the same barcode", async () => {
    const a = await createTenantWithOwner("Barcode Co");
    const b = await createTenantWithOwner("Other Co");
    const barcode = generateEan13();

    expect((await createProduct(a.token, { barcode })).status).toBe(201);
    expect((await createProduct(b.token, { barcode })).status).toBe(201);
  });

  it("treats a blank barcode as absent, so many products can omit it", async () => {
    const { token } = await createTenantWithOwner("Barcode Co");

    expect((await createProduct(token, { barcode: "" })).status).toBe(201);
    expect((await createProduct(token, { barcode: "   " })).status).toBe(201);

    const blanks = await prisma.product.count({ where: { barcode: "" } });
    expect(blanks).toBe(0);
  });
});

describe("every product gets a barcode without anyone asking", () => {
  it("assigns one at creation when none was supplied", async () => {
    const { token } = await createTenantWithOwner("Auto Barcode Co");

    const created = await createProduct(token);

    expect(created.status).toBe(201);
    expect(isValidEan13(created.body.data.barcode)).toBe(true);
    expect(created.body.data.barcode.startsWith("20")).toBe(true);
  });

  it("keeps a manufacturer barcode the caller supplied", async () => {
    const { token } = await createTenantWithOwner("Auto Barcode Co");

    const created = await createProduct(token, { barcode: "4006381333931" });

    expect(created.body.data.barcode).toBe("4006381333931");
  });

  it("treats a blank barcode as absent and generates one anyway", async () => {
    const { token } = await createTenantWithOwner("Auto Barcode Co");

    const created = await createProduct(token, { barcode: "   " });

    expect(created.status).toBe(201);
    expect(isValidEan13(created.body.data.barcode)).toBe(true);
  });

  it("gives every product a distinct barcode", async () => {
    const { token } = await createTenantWithOwner("Auto Barcode Co");

    const codes = new Set<string>();
    for (let index = 0; index < 8; index += 1) {
      codes.add((await createProduct(token)).body.data.barcode);
    }

    expect(codes.size).toBe(8);
  });
});

describe("POST /api/products/barcodes/generate-missing", () => {
  it("fills only the products that have none, and reports how many", async () => {
    const { tenant, token } = await createTenantWithOwner("Backfill Co");
    const kept = await createProduct(token, { barcode: "4006381333931" });
    const blanked = [
      (await createProduct(token)).body.data.id,
      (await createProduct(token)).body.data.id,
      (await createProduct(token)).body.data.id,
    ];
    await prisma.product.updateMany({
      where: { id: { in: blanked } },
      data: { barcode: null },
    });

    const res = await request(app)
      .post("/api/products/barcodes/generate-missing")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.generated).toBe(3);

    const remaining = await prisma.product.count({
      where: { tenantId: tenant.id, barcode: null },
    });
    expect(remaining).toBe(0);

    const untouched = await prisma.product.findUnique({
      where: { id: kept.body.data.id },
    });
    expect(untouched?.barcode).toBe("4006381333931");
  });

  it("is a no-op when nothing is missing", async () => {
    const { token } = await createTenantWithOwner("Backfill Co");
    await createProduct(token);

    const res = await request(app)
      .post("/api/products/barcodes/generate-missing")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.generated).toBe(0);
  });

  it("leaves another tenant's products alone", async () => {
    const mine = await createTenantWithOwner("Backfill Mine");
    const theirs = await createTenantWithOwner("Backfill Theirs");
    const theirProduct = (await createProduct(theirs.token)).body.data.id;
    await prisma.product.update({
      where: { id: theirProduct },
      data: { barcode: null },
    });
    await createProduct(mine.token);

    await request(app)
      .post("/api/products/barcodes/generate-missing")
      .set("Authorization", `Bearer ${mine.token}`)
      .expect(200);

    const stillNull = await prisma.product.findUnique({ where: { id: theirProduct } });
    expect(stillNull?.barcode).toBeNull();
  });
});
