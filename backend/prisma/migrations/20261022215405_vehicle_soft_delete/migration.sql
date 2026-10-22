-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedVin" TEXT;
