-- CreateEnum
CREATE TYPE "ReservationSource" AS ENUM ('admin', 'integration', 'public_web');

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN "source" "ReservationSource" NOT NULL DEFAULT 'admin';
ALTER TABLE "Reservation" ADD COLUMN "durationMinutes" INTEGER NOT NULL DEFAULT 180;
ALTER TABLE "Branch" ADD COLUMN "publicSlug" TEXT;
ALTER TABLE "Branch" ADD COLUMN "onlineBookingDurationMinutes" INTEGER NOT NULL DEFAULT 180;
UPDATE "Branch" SET "publicSlug" = 'branch-' || "id" WHERE "publicSlug" IS NULL;
ALTER TABLE "Branch" ALTER COLUMN "publicSlug" SET NOT NULL;
CREATE UNIQUE INDEX "Branch_publicSlug_key" ON "Branch"("publicSlug");

-- Permit multiple reservations for the same table and service turn. Availability is resolved by time overlap.
DROP INDEX "ServiceState_tableId_serviceDate_turn_key";
CREATE UNIQUE INDEX "ServiceState_tableId_reservationId_key" ON "ServiceState"("tableId", "reservationId");

-- CreateTable
CREATE TABLE "OnlineBookingSettings" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "isEnabled" BOOLEAN NOT NULL DEFAULT false,
  "coverImageUrl" TEXT,
  "accentColor" TEXT NOT NULL DEFAULT '#FF5A00',
  "minAdvanceMinutes" INTEGER NOT NULL DEFAULT 60,
  "maxAdvanceDays" INTEGER NOT NULL DEFAULT 60,
  "minPartySize" INTEGER NOT NULL DEFAULT 1,
  "maxPartySize" INTEGER NOT NULL DEFAULT 12,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OnlineBookingSettings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OnlineBookingSettings_restaurantId_key" ON "OnlineBookingSettings"("restaurantId");
ALTER TABLE "OnlineBookingSettings" ADD CONSTRAINT "OnlineBookingSettings_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "OnlineBookingSchedule" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "weekday" INTEGER NOT NULL,
  "isEnabled" BOOLEAN NOT NULL DEFAULT true,
  "startTime" TEXT NOT NULL,
  "endTime" TEXT NOT NULL,
  "intervalMin" INTEGER NOT NULL DEFAULT 30,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OnlineBookingSchedule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OnlineBookingSchedule_branchId_weekday_key" ON "OnlineBookingSchedule"("branchId", "weekday");
CREATE INDEX "OnlineBookingSchedule_restaurantId_branchId_idx" ON "OnlineBookingSchedule"("restaurantId", "branchId");
ALTER TABLE "OnlineBookingSchedule" ADD CONSTRAINT "OnlineBookingSchedule_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "OnlineBookingException" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "serviceDate" TIMESTAMP(3) NOT NULL,
  "isClosed" BOOLEAN NOT NULL DEFAULT false,
  "startTime" TEXT,
  "endTime" TEXT,
  "intervalMin" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OnlineBookingException_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OnlineBookingException_branchId_serviceDate_key" ON "OnlineBookingException"("branchId", "serviceDate");
CREATE INDEX "OnlineBookingException_restaurantId_branchId_serviceDate_idx" ON "OnlineBookingException"("restaurantId", "branchId", "serviceDate");
ALTER TABLE "OnlineBookingException" ADD CONSTRAINT "OnlineBookingException_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
