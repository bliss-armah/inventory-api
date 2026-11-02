import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { isProduction } from "../config/env.ts";
import { detectImage } from "./image-format.ts";
import { r2Client, r2Config, signedDownloadUrl } from "./r2-client.ts";

export { MAX_IMAGE_BYTES, detectImage } from "./image-format.ts";

export const UPLOAD_ROOT = path.resolve(import.meta.dirname, "../../uploads");
export const KEY_PREFIX = "products/";
const LOCAL_URL_PREFIX = "/uploads/";

export type StoredImage = { key: string };

export function objectKeyFor(tenantId: string, bytes: Buffer, ext: string): string {
  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  return `${KEY_PREFIX}${tenantId}/${digest}-${randomUUID().slice(0, 8)}.${ext}`;
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
      CacheControl: "private, max-age=3600",
    }),
  );

  return { key };
}

async function storeOnDisk(tenantId: string, bytes: Buffer): Promise<StoredImage> {
  const { ext } = detectImage(bytes);
  const key = objectKeyFor(tenantId, bytes, ext);
  const target = path.join(UPLOAD_ROOT, key);

  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);

  return { key };
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
      "Product image storage is not configured. Set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET.",
    );
  }
  return storeOnDisk(tenantId, bytes);
}

function isStorageKey(value: string): boolean {
  return value.startsWith(KEY_PREFIX) && !value.includes("..");
}

export async function productImageUrl(key: string | null): Promise<string | null> {
  if (!key || !isStorageKey(key)) return null;

  const config = r2Config();
  if (config) {
    return signedDownloadUrl(config, key);
  }
  return `${LOCAL_URL_PREFIX}${key}`;
}

export async function deleteProductImage(key: string | null): Promise<void> {
  if (!key || !isStorageKey(key)) return;

  try {
    const config = r2Config();
    if (config) {
      await r2Client(config).send(
        new DeleteObjectCommand({ Bucket: config.bucket, Key: key }),
      );
      return;
    }

    await rm(path.join(UPLOAD_ROOT, key), { force: true });
  } catch (error) {
    console.error(`Could not remove the replaced image ${key}:`, error);
  }
}

export function imageStorageBackend(): "r2" | "local" {
  return r2Config() ? "r2" : "local";
}
