import "../src/config/env.ts";
import { prisma } from "../src/lib/prisma.ts";
import { hashPassword } from "../src/lib/password.ts";
import { classifyIdentifier } from "../src/lib/identifier.ts";
import * as platformAuthRepository from "../src/modules/platform-auth/platform-auth.repository.ts";

const MIN_LENGTH = 8;
const MAX_LENGTH = 72;

async function main() {
  const login = (
    process.env.ADMIN_LOGIN ||
    process.env.ADMIN_EMAIL ||
    process.env.SEED_PLATFORM_ADMIN_EMAIL ||
    ""
  ).trim();
  const password = process.env.NEW_PASSWORD ?? "";

  const identifier = classifyIdentifier(login);
  if (!identifier) {
    throw new Error("Set ADMIN_LOGIN to the platform admin's email address or phone number");
  }
  if (password.length < MIN_LENGTH || password.length > MAX_LENGTH) {
    throw new Error(`Set NEW_PASSWORD to a password of ${MIN_LENGTH}-${MAX_LENGTH} characters`);
  }

  const admin = await platformAuthRepository.findByIdentifier(identifier);
  if (!admin) {
    throw new Error(`No platform admin with the login ${login}`);
  }

  await platformAuthRepository.updatePassword(admin.id, await hashPassword(password));
  await platformAuthRepository.revokeAllRefreshTokensForAdmin(admin.id);
  console.log(`Password updated for ${admin.email}. Existing sessions were signed out.`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
