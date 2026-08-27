import { describe, expect, it, vi } from "vitest";

vi.mock("../config/env.ts", () => ({
  env: {
    NODE_ENV: "test",
    R2_ACCOUNT_ID: "local",
    R2_ACCESS_KEY_ID: "testkey",
    R2_SECRET_ACCESS_KEY: "testsecret123",
    R2_BUCKET: "inventory-images",
    R2_PUBLIC_BASE_URL: "http://localhost:9100/inventory-images",
    R2_ENDPOINT: "http://localhost:9100",
  },
  isProduction: false,
}));

const { storeProductImage, deleteProductImage, imageStorageBackend } = await import(
  "../lib/image-store.ts"
);

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 3),
]);

const ENDPOINT = "http://localhost:9100";

async function serverIsUp(): Promise<boolean> {
  try {
    const res = await fetch(`${ENDPOINT}/minio/health/live`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const available = await serverIsUp();

describe.skipIf(!available)("the store against a real S3-compatible server", () => {
  it("uploads, serves the exact bytes back, then removes on replace", async () => {
    expect(imageStorageBackend()).toBe("r2");

    const { url } = await storeProductImage("tenant-wire", PNG);
    expect(url).toContain("/products/tenant-wire/");

    const fetched = await fetch(url);
    expect(fetched.status).toBe(200);
    expect(fetched.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await fetched.arrayBuffer()).equals(PNG)).toBe(true);

    await deleteProductImage(url);
    expect((await fetch(url)).status).toBe(404);
  });
});
