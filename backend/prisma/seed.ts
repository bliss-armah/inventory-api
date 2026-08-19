import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "../src/config/env.ts";
import { PrismaClient } from "../src/generated/prisma/client.ts";

const pool = new Pool({ connectionString: env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

function resolvePassword(provided: string | undefined): {
  password: string;
  generated: boolean;
} {
  if (provided && provided.length >= 8) {
    return { password: provided, generated: false };
  }
  return { password: randomBytes(9).toString("base64url"), generated: true };
}

function printCredentials(
  title: string,
  lines: Array<[string, string]>,
  generated: boolean,
) {
  console.log("");
  console.log("=========================================");
  console.log(` ${title}`);
  console.log("=========================================");
  for (const [label, value] of lines) {
    console.log(` ${label}: ${value}`);
  }
  if (generated) {
    console.log(" (generated — this will not be shown again; store it now)");
  }
  console.log("=========================================");
  console.log("");
}

async function seedPlatformAdmin() {
  const email = (
    process.env.SEED_PLATFORM_ADMIN_EMAIL || "admin@platform.local"
  ).toLowerCase();

  const existing = await prisma.platformAdmin.findUnique({ where: { email } });
  if (existing) {
    console.log(
      `Platform admin already exists: ${email} (password left unchanged).`,
    );
    return;
  }

  const { password, generated } = resolvePassword(
    process.env.SEED_PLATFORM_ADMIN_PASSWORD,
  );
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.platformAdmin.create({
    data: { name: "Platform Admin", email, passwordHash },
  });

  printCredentials(
    "Platform admin created",
    [
      ["Email   ", email],
      ["Password", password],
    ],
    generated,
  );
}

async function main() {
  await seedPlatformAdmin();
  console.log(
    "Sign in at /platform/login to create businesses and invite their owners.",
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
