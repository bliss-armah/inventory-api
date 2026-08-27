import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sent: Array<{ name: string; input: Record<string, unknown> }> = [];

vi.mock("@aws-sdk/client-s3", () => {
  class PutObjectCommand {
    constructor(public input: Record<string, unknown>) {}
  }
  class DeleteObjectCommand {
    constructor(public input: Record<string, unknown>) {}
  }
  class S3Client {
    constructor(public config: Record<string, unknown>) {
      created.push(config);
    }
    async send(command: { constructor: { name: string }; input: Record<string, unknown> }) {
      sent.push({ name: command.constructor.name, input: command.input });
      return {};
    }
  }
  return { S3Client, PutObjectCommand, DeleteObjectCommand };
});

const created: Array<Record<string, unknown>> = [];

const R2_ENV = {
  R2_ACCOUNT_ID: "acct123",
  R2_ACCESS_KEY_ID: "key",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET: "inventory-images",
  R2_PUBLIC_BASE_URL: "https://images.example.test",
};

async function loadWith(envPatch: Record<string, unknown>, isProduction = false) {
  vi.resetModules();
  vi.doMock("../config/env.ts", () => ({
    env: { NODE_ENV: isProduction ? "production" : "test", ...envPatch },
    isProduction,
  }));
  return {
    store: await import("../lib/image-store.ts"),
    r2: await import("../lib/r2-client.ts"),
  };
}

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32, 7),
]);

beforeEach(() => {
  sent.length = 0;
  created.length = 0;
});

afterEach(() => {
  vi.doUnmock("../config/env.ts");
  vi.resetModules();
});

describe("deciding whether R2 is configured", () => {
  it("needs every setting, not just some", async () => {
    const { r2 } = await loadWith({ R2_ACCOUNT_ID: "acct123", R2_BUCKET: "b" });

    expect(r2.r2Config()).toBeNull();
  });

  it("is configured once all five are present", async () => {
    const { r2 } = await loadWith(R2_ENV);

    expect(r2.r2Config()).toMatchObject({ bucket: "inventory-images" });
  });
});

describe("public URLs", () => {
  it("joins the base and key without doubling the slash", async () => {
    const { r2 } = await loadWith({
      ...R2_ENV,
      R2_PUBLIC_BASE_URL: "https://images.example.test/",
    });
    const config = r2.r2Config()!;

    expect(r2.publicUrlFor(config, "products/t1/a.png")).toBe(
      "https://images.example.test/products/t1/a.png",
    );
  });

  it("recovers the key from a URL it produced", async () => {
    const { r2 } = await loadWith(R2_ENV);
    const config = r2.r2Config()!;
    const url = r2.publicUrlFor(config, "products/t1/a.png");

    expect(r2.keyFromPublicUrl(config, url)).toBe("products/t1/a.png");
  });

  it("refuses to derive a key from someone else's host", async () => {
    const { r2 } = await loadWith(R2_ENV);
    const config = r2.r2Config()!;

    expect(r2.keyFromPublicUrl(config, "https://evil.test/products/t1/a.png")).toBeNull();
  });
});

describe("object keys", () => {
  it("scopes every key to its tenant", async () => {
    const { store } = await loadWith(R2_ENV);

    expect(store.objectKeyFor("tenant-1", PNG, "png")).toMatch(/^products\/tenant-1\/.+\.png$/);
  });

  it("never collides for the same bytes uploaded twice", async () => {
    const { store } = await loadWith(R2_ENV);

    expect(store.objectKeyFor("t1", PNG, "png")).not.toBe(store.objectKeyFor("t1", PNG, "png"));
  });
});

describe("uploading to R2", () => {
  it("points the S3 client at the account's R2 endpoint", async () => {
    const { store } = await loadWith(R2_ENV);
    await store.storeProductImage("t1", PNG);

    expect(created[0]).toMatchObject({
      region: "auto",
      endpoint: "https://acct123.r2.cloudflarestorage.com",
    });
  });

  it("puts the object with the sniffed content type and an immutable cache", async () => {
    const { store } = await loadWith(R2_ENV);

    const { url } = await store.storeProductImage("t1", PNG);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.name).toBe("PutObjectCommand");
    expect(sent[0]!.input).toMatchObject({
      Bucket: "inventory-images",
      ContentType: "image/png",
      CacheControl: "public, max-age=31536000, immutable",
    });
    expect(url).toMatch(/^https:\/\/images\.example\.test\/products\/t1\//);
  });

  it("still refuses a file that is not really an image", async () => {
    const { store } = await loadWith(R2_ENV);

    await expect(store.storeProductImage("t1", Buffer.from("<?php ?>"))).rejects.toThrow(
      /PNG, JPEG and WebP/,
    );
    expect(sent).toHaveLength(0);
  });
});

describe("removing a replaced image", () => {
  it("deletes the old object from the bucket", async () => {
    const { store } = await loadWith(R2_ENV);

    await store.deleteProductImage("https://images.example.test/products/t1/old.png");

    expect(sent[0]).toMatchObject({
      name: "DeleteObjectCommand",
      input: { Bucket: "inventory-images", Key: "products/t1/old.png" },
    });
  });

  it("leaves a URL from another host alone", async () => {
    const { store } = await loadWith(R2_ENV);

    await store.deleteProductImage("https://cdn.elsewhere.test/a.png");

    expect(sent).toHaveLength(0);
  });

  it("does nothing when the product had no image", async () => {
    const { store } = await loadWith(R2_ENV);

    await store.deleteProductImage(null);

    expect(sent).toHaveLength(0);
  });
});

describe("when R2 is not configured", () => {
  it("refuses to store anything in production rather than writing to a disposable disk", async () => {
    const { store } = await loadWith({}, true);

    await expect(store.storeProductImage("t1", PNG)).rejects.toThrow(/not configured/i);
  });

  it("reports which backend is in use", async () => {
    expect((await loadWith(R2_ENV)).store.imageStorageBackend()).toBe("r2");
    expect((await loadWith({})).store.imageStorageBackend()).toBe("local");
  });
});
