ALTER TABLE "Customer"
ADD COLUMN "reservationCount" INTEGER NOT NULL DEFAULT 0;

UPDATE "Customer" c
SET "reservationCount" = counts.total
FROM (
  SELECT "customerId", COUNT(*)::INTEGER AS total
  FROM "Reservation"
  WHERE "customerId" IS NOT NULL
  GROUP BY "customerId"
) AS counts
WHERE c."id" = counts."customerId";
