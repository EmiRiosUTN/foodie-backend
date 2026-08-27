CREATE TABLE "RoomBookingBlock" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "serviceDate" TIMESTAMP(3) NOT NULL,
  "turn" "Turn" NOT NULL,
  "reason" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RoomBookingBlock_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RoomBookingBlock_roomId_serviceDate_turn_key" ON "RoomBookingBlock"("roomId", "serviceDate", "turn");
CREATE INDEX "RoomBookingBlock_restaurantId_branchId_serviceDate_turn_idx" ON "RoomBookingBlock"("restaurantId", "branchId", "serviceDate", "turn");
ALTER TABLE "RoomBookingBlock" ADD CONSTRAINT "RoomBookingBlock_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoomBookingBlock" ADD CONSTRAINT "RoomBookingBlock_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoomBookingBlock" ADD CONSTRAINT "RoomBookingBlock_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
