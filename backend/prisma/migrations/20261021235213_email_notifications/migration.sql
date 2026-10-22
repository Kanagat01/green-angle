-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailNotifications" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "notifyEmail" TEXT,
ADD COLUMN     "notifyEnabled" BOOLEAN NOT NULL DEFAULT false;
