import "dotenv/config";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { Pool } from "../node_modules/@types/pg/index";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { Role } from "../src/generated/prisma/enums.ts";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
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

async function seedDemoTenant() {
  const email = (
    process.env.SEED_DEMO_OWNER_EMAIL || "owner@demo.local"
  ).toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(
      `Demo tenant owner already exists: ${email} (password left unchanged).`,
    );
    return;
  }

  const { password, generated } = resolvePassword(
    process.env.SEED_DEMO_OWNER_PASSWORD,
  );
  const passwordHash = await bcrypt.hash(password, 12);
  const businessName = process.env.SEED_DEMO_BUSINESS_NAME || "Demo Store";

  const { tenant } = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        businessName,
        phone: "+233200000000",
        email,
        country: "Ghana",
        timeZone: "Africa/Accra",
      },
    });
    const owner = await tx.user.create({
      data: {
        tenantId: tenant.id,
        name: "Demo Owner",
        email,
        passwordHash,
        role: Role.OWNER,
      },
    });
    await tx.location.create({
      data: { tenantId: tenant.id, name: "Main Store", isDefault: true },
    });
    await tx.businessSettings.create({ data: { tenantId: tenant.id } });
    return { tenant, owner };
  });

  printCredentials(
    "Demo tenant created",
    [
      ["Business", tenant.businessName],
      ["Email   ", email],
      ["Password", password],
    ],
    generated,
  );
}

async function main() {
  await seedPlatformAdmin();
  await seedDemoTenant();
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
