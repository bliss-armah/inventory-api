-- CreateEnum
CREATE TYPE "OtpChannel" AS ENUM ('EMAIL', 'SMS');

-- AlterTable
ALTER TABLE "otp_challenges" DROP COLUMN "phone",
ADD COLUMN     "channel" "OtpChannel" NOT NULL,
ADD COLUMN     "destination" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "twoFactorChannel" "OtpChannel";

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

