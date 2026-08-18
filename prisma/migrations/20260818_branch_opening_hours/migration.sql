CREATE TABLE "BranchOpeningHour" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "weekday" INTEGER NOT NULL,
  "startTime" TEXT NOT NULL,
  "endTime" TEXT NOT NULL,
  "endsNextDay" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BranchOpeningHour_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BranchOpeningHour_restaurantId_branchId_weekday_idx" ON "BranchOpeningHour"("restaurantId", "branchId", "weekday");

ALTER TABLE "BranchOpeningHour" ADD CONSTRAINT "BranchOpeningHour_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BranchOpeningHour" ADD CONSTRAINT "BranchOpeningHour_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
