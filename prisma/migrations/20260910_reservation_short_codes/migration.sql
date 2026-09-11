ALTER TABLE "Reservation" ADD COLUMN "codeNormalized" TEXT;

UPDATE "Reservation"
SET "codeNormalized" = UPPER(BTRIM("code"));

ALTER TABLE "Reservation" ALTER COLUMN "codeNormalized" SET NOT NULL;

CREATE UNIQUE INDEX "Reservation_codeNormalized_key" ON "Reservation"("codeNormalized");
