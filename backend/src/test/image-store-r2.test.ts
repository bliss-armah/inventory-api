import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sent: Array<{ name: string; input: Record<string, unknown> }> = [];
const created: Array<Record<string, unknown>> = [];
const signed: Array<{ input: Record<string, unknown>; options: Record<string, unknown> }> = [];

vi.mock("@aws-sdk/client-s3", () => {
  class PutObjectCommand {
    constructor(public input: Record<string, unknown>) {}
  }
  class DeleteObjectCommand {
    constructor(public input: Record<string, unknown>) {}
  }
  class GetObjectCommand {
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
  return { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand };
});

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: async (
    _client: unknown,
    command: { input: Record<string, unknown> },
    options: Record<string, unknown>,
  ) => {
    signed.push({ input: command.input, options });
    return `https://signed.example.test/${String(command.input.Key)}?X-Amz-Expires=${String(options.expiresIn)}`;
  },
}));

const R2_ENV = {
  R2_ENDPOINT: "https://acct123.r2.cloudflarestorage.com",
  R2_ACCESS_KEY_ID: "key",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET: "inventory-images",
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
  signed.length = 0;
});

afterEach(() => {
  vi.doUnmock("../config/env.ts");
  vi.resetModules();
});

describe("deciding whether R2 is configured", () => {
  it("needs every setting, not just some", async () => {
    const { r2 } = await loadWith({ R2_ENDPOINT: R2_ENV.R2_ENDPOINT, R2_BUCKET: "b" });

    expect(r2.r2Config()).toBeNull();
  });

  it("is configured once all four are present", async () => {
    const { r2 } = await loadWith(R2_ENV);

    expect(r2.r2Config()).toMatchObject({ bucket: "inventory-images" });
  });
});

describe("the S3 client", () => {
  it("talks to the configured endpoint with path-style addressing", async () => {
    const { store } = await loadWith(R2_ENV);
    await store.storeProductImage("t1", PNG);

    expect(created[0]).toMatchObject({
      region: "auto",
      endpoint: "https://acct123.r2.cloudflarestorage.com",
      forcePathStyle: true,
    });
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
  it("puts the object under a tenant key and returns the key, not a url", async () => {
    const { store } = await loadWith(R2_ENV);

    const stored = await store.storeProductImage("t1", PNG);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.name).toBe("PutObjectCommand");
    expect(sent[0]!.input).toMatchObject({
      Bucket: "inventory-images",
      ContentType: "image/png",
      CacheControl: "private, max-age=3600",
    });
    expect(stored.key).toMatch(/^products\/t1\/.+\.png$/);
    expect(stored).not.toHaveProperty("url");
  });

  it("still refuses a file that is not really an image", async () => {
    const { store } = await loadWith(R2_ENV);

    await expect(store.storeProductImage("t1", Buffer.from("<?php ?>"))).rejects.toThrow(
      /PNG, JPEG and WebP/,
    );
    expect(sent).toHaveLength(0);
  });
});

describe("reading an image back", () => {
  it("signs a time-limited url for the key rather than exposing the bucket", async () => {
    const { store } = await loadWith(R2_ENV);

    const url = await store.productImageUrl("products/t1/a.png");

    expect(signed[0]!.input).toMatchObject({
      Bucket: "inventory-images",
      Key: "products/t1/a.png",
    });
    expect(signed[0]!.options).toMatchObject({ expiresIn: 3600 });
    expect(url).toContain("X-Amz-Expires=3600");
  });

  it("serves the local path when R2 is not configured", async () => {
    const { store } = await loadWith({});

    expect(await store.productImageUrl("products/t1/a.png")).toBe("/uploads/products/t1/a.png");
    expect(signed).toHaveLength(0);
  });

  it("has nothing to sign for a product with no image", async () => {
    const { store } = await loadWith(R2_ENV);

    expect(await store.productImageUrl(null)).toBeNull();
    expect(signed).toHaveLength(0);
  });

  it("refuses a stored value that is not one of our keys", async () => {
    const { store } = await loadWith(R2_ENV);

    expect(await store.productImageUrl("https://cdn.elsewhere.test/a.png")).toBeNull();
    expect(await store.productImageUrl("products/../../etc/passwd")).toBeNull();
    expect(signed).toHaveLength(0);
  });
});

describe("removing a replaced image", () => {
  it("deletes the old object from the bucket", async () => {
    const { store } = await loadWith(R2_ENV);

    await store.deleteProductImage("products/t1/old.png");

    expect(sent[0]).toMatchObject({
      name: "DeleteObjectCommand",
      input: { Bucket: "inventory-images", Key: "products/t1/old.png" },
    });
  });

  it("leaves a value that is not one of our keys alone", async () => {
    const { store } = await loadWith(R2_ENV);

    await store.deleteProductImage("https://cdn.elsewhere.test/a.png");
    await store.deleteProductImage("products/../secrets.png");

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
