-- The original online-bookings migration was already applied before the
-- duration refinement was introduced. Keep this follow-up idempotent so both
-- existing and freshly provisioned databases reach the same schema.
ALTER TABLE "Reservation" ADD COLUMN IF NOT EXISTS "durationMinutes" INTEGER NOT NULL DEFAULT 180;
ALTER TABLE "Branch" ADD COLUMN IF NOT EXISTS "onlineBookingDurationMinutes" INTEGER NOT NULL DEFAULT 180;

DROP INDEX IF EXISTS "ServiceState_tableId_serviceDate_turn_key";
CREATE UNIQUE INDEX IF NOT EXISTS "ServiceState_tableId_reservationId_key" ON "ServiceState"("tableId", "reservationId");
