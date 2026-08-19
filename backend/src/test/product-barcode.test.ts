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
  it("assigns a scannable barcode to a product that has none", async () => {
    const { token } = await createTenantWithOwner("Barcode Co");
    const created = await createProduct(token);
    expect(created.status).toBe(201);

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
