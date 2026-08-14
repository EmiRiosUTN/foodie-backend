ALTER TABLE "OnlineBookingSettings"
  ADD COLUMN "agencyPartyThreshold" INTEGER,
  ADD COLUMN "remindersEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "reminderPartySizeFrom" INTEGER,
  ADD COLUMN "reminderHoursBefore" INTEGER;
