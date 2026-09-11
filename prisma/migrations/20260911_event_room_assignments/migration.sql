-- Additive migration: existing reservations keep their current primary room.
CREATE TABLE "ReservationRoomAssignment" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "allocatedCovers" INTEGER NOT NULL,
    "usage" TEXT NOT NULL DEFAULT 'partial',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReservationRoomAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReservationRoomAssignment_reservationId_roomId_key"
ON "ReservationRoomAssignment"("reservationId", "roomId");

CREATE INDEX "ReservationRoomAssignment_roomId_idx"
ON "ReservationRoomAssignment"("roomId");

ALTER TABLE "ReservationRoomAssignment"
ADD CONSTRAINT "ReservationRoomAssignment_reservationId_fkey"
FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReservationRoomAssignment"
ADD CONSTRAINT "ReservationRoomAssignment_roomId_fkey"
FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
