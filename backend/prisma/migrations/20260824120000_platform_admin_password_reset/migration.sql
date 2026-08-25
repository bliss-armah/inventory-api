CREATE TABLE "platform_admin_password_reset_tokens" (
    "id" TEXT NOT NULL,
    "platformAdminId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_admin_password_reset_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "platform_admin_password_reset_tokens_tokenHash_key"
    ON "platform_admin_password_reset_tokens"("tokenHash");

CREATE INDEX "platform_admin_password_reset_tokens_platformAdminId_idx"
    ON "platform_admin_password_reset_tokens"("platformAdminId");

ALTER TABLE "platform_admin_password_reset_tokens"
    ADD CONSTRAINT "platform_admin_password_reset_tokens_platformAdminId_fkey"
    FOREIGN KEY ("platformAdminId") REFERENCES "platform_admins"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
