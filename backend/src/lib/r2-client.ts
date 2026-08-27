import { S3Client } from "@aws-sdk/client-s3";
import { env } from "../config/env.ts";

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string;
  endpoint?: string;
};

export function r2Config(): R2Config | null {
  const {
    R2_ACCOUNT_ID: accountId,
    R2_ACCESS_KEY_ID: accessKeyId,
    R2_SECRET_ACCESS_KEY: secretAccessKey,
    R2_BUCKET: bucket,
    R2_PUBLIC_BASE_URL: publicBaseUrl,
    R2_ENDPOINT: endpoint,
  } = env;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) {
    return null;
  }
  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    publicBaseUrl,
    ...(endpoint ? { endpoint } : {}),
  };
}

let client: S3Client | null = null;

export function r2Client(config: R2Config): S3Client {
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: config.endpoint ?? `https://${config.accountId}.r2.cloudflarestorage.com`,
      ...(config.endpoint ? { forcePathStyle: true } : {}),
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }
  return client;
}

export function publicUrlFor(config: R2Config, key: string): string {
  return `${config.publicBaseUrl.replace(/\/+$/, "")}/${key}`;
}

export function keyFromPublicUrl(config: R2Config, url: string): string | null {
  const prefix = `${config.publicBaseUrl.replace(/\/+$/, "")}/`;
  return url.startsWith(prefix) ? url.slice(prefix.length) : null;
}
