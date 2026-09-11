ALTER TABLE "Reservation" ADD COLUMN "specialServiceId" TEXT;
ALTER TABLE "Reservation" ADD COLUMN "turnoverMinutes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ServiceState" ADD COLUMN "specialServiceId" TEXT;

CREATE TABLE "SpecialService" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "serviceDate" TIMESTAMP(3) NOT NULL,
  "label" TEXT NOT NULL,
  "startTime" TEXT NOT NULL,
  "endTime" TEXT NOT NULL,
  "intervalMin" INTEGER NOT NULL DEFAULT 15,
  "durationMinutes" INTEGER NOT NULL DEFAULT 120,
  "turnoverMinutes" INTEGER NOT NULL DEFAULT 0,
  "position" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SpecialService_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SpecialService_branchId_serviceDate_position_key" ON "SpecialService"("branchId", "serviceDate", "position");
CREATE UNIQUE INDEX "SpecialService_branchId_serviceDate_label_key" ON "SpecialService"("branchId", "serviceDate", "label");
CREATE INDEX "SpecialService_restaurantId_branchId_serviceDate_idx" ON "SpecialService"("restaurantId", "branchId", "serviceDate");
CREATE INDEX "Reservation_specialServiceId_idx" ON "Reservation"("specialServiceId");
ALTER TABLE "SpecialService" ADD CONSTRAINT "SpecialService_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SpecialService" ADD CONSTRAINT "SpecialService_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_specialServiceId_fkey" FOREIGN KEY ("specialServiceId") REFERENCES "SpecialService"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
