/**
 * Stands in for prisma.config.ts, which is a Prisma 7 feature — 5.x has no
 * config file and its CLI only auto-loads a .env sitting in the backend dir or
 * in prisma/. This project keeps one .env a level up (server/.env) with
 * DATABASE_URL derived from POSTGRES_USER/PASSWORD/DB/PORT, so resolve it here
 * and hand it to the CLI in the environment. That keeps `prisma migrate`,
 * `prisma studio` and `prisma db seed` working without anyone passing a
 * connection string by hand.
 *
 * Deliberately not importing config/env.ts: this also has to run where no .env
 * exists (`prisma generate` during `docker build`), where full validation would
 * fail the image build. `prisma generate` needs no connection string.
 *
 * Run via the npm scripts — it resolves the `prisma` binary off PATH, which npm
 * populates with node_modules/.bin.
 */
import { spawnSync } from "node:child_process";
import { resolveDatabaseUrl } from "../src/config/database-url.ts";

const databaseUrl = resolveDatabaseUrl();

const result = spawnSync("prisma", process.argv.slice(2), {
  stdio: "inherit",
  env: databaseUrl
    ? { ...process.env, DATABASE_URL: databaseUrl }
    : process.env,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
