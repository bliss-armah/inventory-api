-- AlterEnum
BEGIN;
UPDATE "users"
SET "isActive" = false,
    "role" = 'CASHIER'
WHERE "role" IN ('INVENTORY_MANAGER', 'STOREKEEPER', 'PURCHASING_OFFICER', 'AUDITOR');
CREATE TYPE "Role_new" AS ENUM ('OWNER', 'CASHIER');
ALTER TABLE "users" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");
ALTER TYPE "Role" RENAME TO "Role_old";
ALTER TYPE "Role_new" RENAME TO "Role";
DROP TYPE "public"."Role_old";
COMMIT;
