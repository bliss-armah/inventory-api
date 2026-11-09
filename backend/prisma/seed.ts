import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
// Side-effect import: loads the single server/.env and derives DATABASE_URL,
// which the generated client reads from the environment when constructed.
import "../src/config/env.ts";
import { isPhoneLike, normalizePhone } from "../src/lib/phone.ts";
import { PrismaClient } from "../src/generated/prisma";

const prisma = new PrismaClient();

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

function resolvePhone(): string | null {
  const raw = (process.env.SEED_PLATFORM_ADMIN_PHONE || "0245289983").trim();
  if (!raw) return null;
  if (!isPhoneLike(raw)) {
    throw new Error("SEED_PLATFORM_ADMIN_PHONE is not a valid phone number");
  }
  return normalizePhone(raw);
}

async function seedPlatformAdmin() {
  const email = (
    process.env.SEED_PLATFORM_ADMIN_EMAIL || "admin@platform.local"
  ).toLowerCase();
  const phone = resolvePhone();

  const existing = await prisma.platformAdmin.findUnique({ where: { email } });
  if (existing) {
    if (phone && !existing.phone) {
      await prisma.platformAdmin.update({ where: { id: existing.id }, data: { phone } });
      console.log(`Platform admin already exists: ${email}. Phone number added (password left unchanged).`);
      return;
    }
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
    data: { name: "Platform Admin", email, ...(phone ? { phone } : {}), passwordHash },
  });

  printCredentials(
    "Platform admin created",
    [
      ["Email   ", email],
      ...(phone ? ([["Phone   ", phone]] as Array<[string, string]>) : []),
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
  });
