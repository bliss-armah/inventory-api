import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { isProduction } from "../config/env.ts";
import { detectImage } from "./image-format.ts";
import { keyFromPublicUrl, publicUrlFor, r2Client, r2Config } from "./r2-client.ts";

export { MAX_IMAGE_BYTES, detectImage } from "./image-format.ts";

export const UPLOAD_ROOT = path.resolve(import.meta.dirname, "../../uploads");
const LOCAL_URL_PREFIX = "/uploads/";

export type StoredImage = { url: string };

export function objectKeyFor(tenantId: string, bytes: Buffer, ext: string): string {
  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  return `products/${tenantId}/${digest}-${randomUUID().slice(0, 8)}.${ext}`;
}

async function storeInR2(tenantId: string, bytes: Buffer): Promise<StoredImage> {
  const config = r2Config()!;
  const { ext, mime } = detectImage(bytes);
  const key = objectKeyFor(tenantId, bytes, ext);

  await r2Client(config).send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: bytes,
      ContentType: mime,
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );

  return { url: publicUrlFor(config, key) };
}

async function storeOnDisk(tenantId: string, bytes: Buffer): Promise<StoredImage> {
  const { ext } = detectImage(bytes);
  const filename = objectKeyFor(tenantId, bytes, ext).split("/").pop()!;

  await mkdir(path.join(UPLOAD_ROOT, tenantId), { recursive: true });
  await writeFile(path.join(UPLOAD_ROOT, tenantId, filename), bytes);

  return { url: `${LOCAL_URL_PREFIX}${tenantId}/${filename}` };
}

export async function storeProductImage(
  tenantId: string,
  bytes: Buffer,
): Promise<StoredImage> {
  if (r2Config()) {
    return storeInR2(tenantId, bytes);
  }
  if (isProduction) {
    throw new Error(
      "Product image storage is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET and R2_PUBLIC_BASE_URL.",
    );
  }
  return storeOnDisk(tenantId, bytes);
}

export async function deleteProductImage(url: string | null): Promise<void> {
  if (!url) return;

  try {
    const config = r2Config();
    if (config) {
      const key = keyFromPublicUrl(config, url);
      if (!key) return;
      await r2Client(config).send(
        new DeleteObjectCommand({ Bucket: config.bucket, Key: key }),
      );
      return;
    }

    if (!url.startsWith(LOCAL_URL_PREFIX)) return;
    const relative = url.slice(LOCAL_URL_PREFIX.length);
    if (relative.includes("..")) return;
    await rm(path.join(UPLOAD_ROOT, relative), { force: true });
  } catch (error) {
    console.error(`Could not remove the replaced image ${url}:`, error);
  }
}

export function imageStorageBackend(): "r2" | "local" {
  return r2Config() ? "r2" : "local";
}
