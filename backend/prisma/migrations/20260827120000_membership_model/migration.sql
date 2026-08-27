-- Global identity + per-tenant membership.
--
-- Before: `users` carried tenantId/role/isActive, and `users.email` was
-- globally unique — so one business claiming an address silently blocked
-- every other business from ever adding that person, with no way to see why.
-- After: `users` is a pure identity (email/phone/password/2FA) and access to a
-- business lives in `memberships`, one row per (person, tenant).

-- 1. Memberships, backfilled one-for-one from the columns being dropped.
CREATE TABLE "memberships" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

INSERT INTO "memberships" ("id", "userId", "tenantId", "role", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "id", "tenantId", "role", "isActive", "createdAt", "updatedAt"
FROM "users";

CREATE UNIQUE INDEX "memberships_userId_tenantId_key" ON "memberships"("userId", "tenantId");
CREATE INDEX "memberships_tenantId_idx" ON "memberships"("tenantId");

ALTER TABLE "memberships" ADD CONSTRAINT "memberships_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Staff invitations. No `users` row exists until one is accepted, which is
--    what keeps "already has an account somewhere else" invisible to the
--    inviting owner.
CREATE TABLE "staff_invites" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "invitedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "staff_invites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "staff_invites_tokenHash_key" ON "staff_invites"("tokenHash");
CREATE UNIQUE INDEX "staff_invites_tenantId_email_key" ON "staff_invites"("tenantId", "email");
CREATE INDEX "staff_invites_tenantId_idx" ON "staff_invites"("tenantId");

ALTER TABLE "staff_invites" ADD CONSTRAINT "staff_invites_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "staff_invites" ADD CONSTRAINT "staff_invites_invitedByUserId_fkey"
    FOREIGN KEY ("invitedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. pending_two_factor_auth -> pending_logins. Same opaque-token role, but it
--    now spans the whole multi-step login, so it gains twoFactorAt and loses
--    the tenant it could no longer know at issue time.
ALTER TABLE "pending_two_factor_auth" RENAME TO "pending_logins";
ALTER TABLE "pending_logins" RENAME CONSTRAINT "pending_two_factor_auth_pkey" TO "pending_logins_pkey";
ALTER TABLE "pending_logins" RENAME CONSTRAINT "pending_two_factor_auth_userId_fkey" TO "pending_logins_userId_fkey";
ALTER INDEX "pending_two_factor_auth_tokenHash_key" RENAME TO "pending_logins_tokenHash_key";
ALTER INDEX "pending_two_factor_auth_userId_idx" RENAME TO "pending_logins_userId_idx";
ALTER TABLE "pending_logins" DROP CONSTRAINT "pending_two_factor_auth_tenantId_fkey";
ALTER TABLE "pending_logins" DROP COLUMN "tenantId";
ALTER TABLE "pending_logins" ADD COLUMN "twoFactorAt" TIMESTAMP(3);

-- 4. The remaining token tables hang off the identity, not a business, so the
--    denormalised tenantId comes off. They still cascade from "users".
ALTER TABLE "password_reset_tokens" DROP CONSTRAINT "password_reset_tokens_tenantId_fkey";
ALTER TABLE "password_reset_tokens" DROP COLUMN "tenantId";
ALTER TABLE "otp_challenges" DROP CONSTRAINT "otp_challenges_tenantId_fkey";
ALTER TABLE "otp_challenges" DROP COLUMN "tenantId";
ALTER TABLE "remembered_devices" DROP CONSTRAINT "remembered_devices_tenantId_fkey";
ALTER TABLE "remembered_devices" DROP COLUMN "tenantId";
ALTER TABLE "two_factor_backup_codes" DROP CONSTRAINT "two_factor_backup_codes_tenantId_fkey";
ALTER TABLE "two_factor_backup_codes" DROP COLUMN "tenantId";

-- 5. Finally, `users` becomes a pure identity. refresh_tokens keeps its
--    tenantId: a session really is scoped to one business.
ALTER TABLE "users" DROP CONSTRAINT "users_tenantId_fkey";
DROP INDEX "users_tenantId_idx";
ALTER TABLE "users" DROP COLUMN "tenantId";
ALTER TABLE "users" DROP COLUMN "role";
ALTER TABLE "users" DROP COLUMN "isActive";
