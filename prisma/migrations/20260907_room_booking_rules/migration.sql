CREATE TABLE "RoomBookingRule" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "weekdays" INTEGER[] NOT NULL,
    "turns" "Turn"[] NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "reason" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RoomBookingRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RoomBookingRule_restaurantId_branchId_roomId_idx" ON "RoomBookingRule"("restaurantId", "branchId", "roomId");
CREATE INDEX "RoomBookingRule_roomId_startsAt_endsAt_idx" ON "RoomBookingRule"("roomId", "startsAt", "endsAt");

ALTER TABLE "RoomBookingRule" ADD CONSTRAINT "RoomBookingRule_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoomBookingRule" ADD CONSTRAINT "RoomBookingRule_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoomBookingRule" ADD CONSTRAINT "RoomBookingRule_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
