import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../app";
import { prisma } from "../lib/prisma.ts";
import { detectImage, MAX_IMAGE_BYTES } from "../lib/image-format.ts";
import { UPLOAD_ROOT } from "../lib/image-store.ts";
import { createTenantWithOwner, createProduct, createCashier, tokenFor, deleteTenant } from "./fixtures.ts";

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.alloc(4),
  Buffer.from("WEBP", "ascii"),
  Buffer.alloc(64, 1),
]);

const tenantIds: string[] = [];
afterAll(async () => {
  for (const id of tenantIds) await deleteTenant(id);
});

async function shop() {
  const created = await createTenantWithOwner("Image Co");
  tenantIds.push(created.tenant.id);
  const product = await createProduct(created.tenant.id);
  return { ...created, product };
}

describe("detectImage", () => {
  it("recognises the formats a shop actually uploads", () => {
    expect(detectImage(PNG).ext).toBe("png");
    expect(detectImage(JPEG).ext).toBe("jpg");
    expect(detectImage(WEBP).ext).toBe("webp");
  });

  it("rejects a file that only claims to be an image", () => {
    expect(() => detectImage(Buffer.from("<?php echo 1; ?>"))).toThrow(/PNG, JPEG and WebP/);
  });

  it("rejects an empty upload", () => {
    expect(() => detectImage(Buffer.alloc(0))).toThrow(/empty/i);
  });

  it("rejects anything over the size limit", () => {
    const huge = Buffer.concat([PNG, Buffer.alloc(MAX_IMAGE_BYTES)]);
    expect(() => detectImage(huge)).toThrow(/2 MB/);
  });
});

describe("uploading a product image", () => {
  it("stores the file and points the product at it", async () => {
    const { token, product } = await shop();

    const res = await request(app)
      .post(`/api/products/${product.id}/image`)
      .set("Authorization", `Bearer ${token}`)
      .set("Content-Type", "image/png")
      .send(PNG);

    expect(res.status).toBe(200);
    expect(res.body.data.imageUrl).toMatch(/^\/uploads\/.+\.png$/);

    const stored = await prisma.product.findUnique({ where: { id: product.id } });
    expect(stored!.imageUrl).toBe(res.body.data.imageUrl);
  });

  it("serves the stored file back", async () => {
    const { token, product } = await shop();
    const upload = await request(app)
      .post(`/api/products/${product.id}/image`)
      .set("Authorization", `Bearer ${token}`)
      .set("Content-Type", "image/png")
      .send(PNG);

    const fetched = await request(app).get(upload.body.data.imageUrl);

    expect(fetched.status).toBe(200);
  });

  it("keeps each tenant's uploads in its own folder", async () => {
    const mine = await shop();
    const theirs = await shop();

    const a = await request(app)
      .post(`/api/products/${mine.product.id}/image`)
      .set("Authorization", `Bearer ${mine.token}`)
      .set("Content-Type", "image/png")
      .send(PNG);
    const b = await request(app)
      .post(`/api/products/${theirs.product.id}/image`)
      .set("Authorization", `Bearer ${theirs.token}`)
      .set("Content-Type", "image/png")
      .send(PNG);

    expect(a.body.data.imageUrl).toContain(mine.tenant.id);
    expect(b.body.data.imageUrl).toContain(theirs.tenant.id);
    expect(a.body.data.imageUrl).not.toBe(b.body.data.imageUrl);
  });

  it("refuses a disguised non-image", async () => {
    const { token, product } = await shop();

    const res = await request(app)
      .post(`/api/products/${product.id}/image`)
      .set("Authorization", `Bearer ${token}`)
      .set("Content-Type", "image/png")
      .send(Buffer.from("<?php echo 1; ?>"));

    expect(res.status).toBe(400);
  });

  it("refuses a cashier", async () => {
    const { tenant, product } = await shop();
    const cashier = await createCashier(tenant.id);

    const res = await request(app)
      .post(`/api/products/${product.id}/image`)
      .set("Authorization", `Bearer ${tokenFor(cashier)}`)
      .set("Content-Type", "image/png")
      .send(PNG);

    expect(res.status).toBe(403);
  });

  it("replaces the old file rather than leaving it behind", async () => {
    const { existsSync } = await import("node:fs");
    const path = await import("node:path");
    const { token, product } = await shop();

    const first = await request(app)
      .post(`/api/products/${product.id}/image`)
      .set("Authorization", `Bearer ${token}`)
      .set("Content-Type", "image/png")
      .send(PNG);
    const firstOnDisk = path.join(
      UPLOAD_ROOT,
      first.body.data.imageUrl.replace("/uploads/", ""),
    );
    expect(existsSync(firstOnDisk)).toBe(true);

    const second = await request(app)
      .post(`/api/products/${product.id}/image`)
      .set("Authorization", `Bearer ${token}`)
      .set("Content-Type", "image/jpeg")
      .send(JPEG);

    expect(second.body.data.imageUrl).not.toBe(first.body.data.imageUrl);
    expect(existsSync(firstOnDisk)).toBe(false);
  });

  it("does not store anything for a product that is not ours", async () => {
    const mine = await shop();
    const theirs = await shop();

    const res = await request(app)
      .post(`/api/products/${theirs.product.id}/image`)
      .set("Authorization", `Bearer ${mine.token}`)
      .set("Content-Type", "image/png")
      .send(PNG);

    expect(res.status).toBe(404);
    const stored = await prisma.product.findUnique({ where: { id: theirs.product.id } });
    expect(stored!.imageUrl).toBeNull();
  });
});
