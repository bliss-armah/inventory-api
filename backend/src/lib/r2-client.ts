import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../config/env.ts";

const DOWNLOAD_EXPIRY_SECONDS = 3600;

export type R2Config = {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

export function r2Config(): R2Config | null {
  const {
    R2_ENDPOINT: endpoint,
    R2_ACCESS_KEY_ID: accessKeyId,
    R2_SECRET_ACCESS_KEY: secretAccessKey,
    R2_BUCKET: bucket,
  } = env;

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    return null;
  }
  return { endpoint, accessKeyId, secretAccessKey, bucket };
}

let client: S3Client | null = null;

export function r2Client(config: R2Config): S3Client {
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: config.endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }
  return client;
}

export function signedDownloadUrl(config: R2Config, key: string): Promise<string> {
  return getSignedUrl(
    r2Client(config),
    new GetObjectCommand({ Bucket: config.bucket, Key: key }),
    { expiresIn: DOWNLOAD_EXPIRY_SECONDS },
  );
}
