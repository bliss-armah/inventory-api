import path from "node:path";
import { config as loadEnv } from "dotenv";


export const ENV_FILE = path.resolve(import.meta.dirname, "../../../.env");

export function resolveDatabaseUrl(): string | undefined {
  loadEnv({ path: ENV_FILE });

  const { DATABASE_URL, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB } =
    process.env;

  if (DATABASE_URL) return DATABASE_URL;
  if (!POSTGRES_USER || !POSTGRES_PASSWORD || !POSTGRES_DB) return undefined;

  const port = process.env.POSTGRES_PORT ?? "5435";
  return `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${port}/${POSTGRES_DB}?schema=public`;
}
