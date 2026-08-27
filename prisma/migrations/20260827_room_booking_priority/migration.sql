ALTER TABLE "Room" ADD COLUMN "bookingPriority" INTEGER NOT NULL DEFAULT 1;

WITH ranked_rooms AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "branchId" ORDER BY "createdAt" ASC, "id" ASC) AS priority
  FROM "Room"
)
UPDATE "Room" AS room
SET "bookingPriority" = ranked_rooms.priority
FROM ranked_rooms
WHERE room."id" = ranked_rooms."id";

CREATE INDEX "Room_branchId_bookingPriority_idx" ON "Room"("branchId", "bookingPriority");
