ALTER TABLE "Room" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "Room_restaurantId_isActive_idx" ON "Room"("restaurantId", "isActive");

