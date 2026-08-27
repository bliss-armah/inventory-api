import { PrismaClient } from "../generated/prisma";
import { env } from "../config/env.ts";

// Prisma 5's own Rust query engine owns the connection pool — no `pg` Pool or
// driver adapter in front of it. That is deliberate: the @prisma/adapter-pg
// path this replaced was the source of intermittent "socket hang up" failures.
// Pool size is tuned through DATABASE_URL's `connection_limit` parameter
// rather than in code; unset, Prisma uses num_cpus * 2 + 1.
export const prisma = new PrismaClient({
  log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});
