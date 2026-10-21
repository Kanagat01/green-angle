-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Вручную: у существующих машин «обновлено» = последняя смена статуса (или создание)
UPDATE "Vehicle" v
   SET "updatedAt" = GREATEST(
     v."createdAt",
     COALESCE((SELECT max(l."changedAt") FROM "VehicleStatusLog" l WHERE l."vehicleId" = v."id"), v."createdAt")
   );
