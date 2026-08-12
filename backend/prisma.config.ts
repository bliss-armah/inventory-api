// Uses config/database-url.ts rather than bare `dotenv/config` so the Prisma
// CLI reads the single server/.env and gets DATABASE_URL derived from
// POSTGRES_USER/PASSWORD/DB/PORT — `prisma migrate`, `prisma studio` and
// `db:seed` all work without anyone passing a connection string by hand.
// Deliberately not config/env.ts: this file is also evaluated during
// `docker build`, where no .env exists and full validation would fail the
// image build. `prisma generate` needs no connection string.
import { resolveDatabaseUrl } from "./src/config/database-url.ts";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: resolveDatabaseUrl(),
  },
});
