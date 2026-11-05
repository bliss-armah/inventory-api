ALTER TABLE "platform_admins" ADD COLUMN "phone" TEXT;

CREATE UNIQUE INDEX "platform_admins_phone_key" ON "platform_admins"("phone");
