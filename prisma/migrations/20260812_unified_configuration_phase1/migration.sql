CREATE TYPE "AdvanceUnit" AS ENUM ('days', 'weeks', 'months');
CREATE TYPE "BookingService" AS ENUM ('lunch', 'dinner');
CREATE TYPE "BookingExceptionType" AS ENUM ('closed', 'custom_hours', 'fully_booked', 'booking_disabled');

ALTER TABLE "RestaurantCustomization" ADD COLUMN "cuisineType" TEXT, ADD COLUMN "city" TEXT, ADD COLUMN "province" TEXT, ADD COLUMN "country" TEXT, ADD COLUMN "phone" TEXT, ADD COLUMN "email" TEXT, ADD COLUMN "websiteUrl" TEXT, ADD COLUMN "instagramUrl" TEXT, ADD COLUMN "assistantEnabled" BOOLEAN NOT NULL DEFAULT true, ADD COLUMN "assistantName" TEXT, ADD COLUMN "assistantRole" TEXT, ADD COLUMN "assistantLocale" TEXT NOT NULL DEFAULT 'es-AR', ADD COLUMN "assistantTone" TEXT NOT NULL DEFAULT 'calido_breve_profesional', ADD COLUMN "assistantFirstGreeting" TEXT, ADD COLUMN "assistantDisclosure" BOOLEAN NOT NULL DEFAULT true, ADD COLUMN "humanSupportPhone" TEXT, ADD COLUMN "humanSupportWhatsapp" TEXT, ADD COLUMN "humanSupportEmail" TEXT, ADD COLUMN "configVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Branch" ADD COLUMN "publicName" TEXT, ADD COLUMN "isEnabled" BOOLEAN NOT NULL DEFAULT true, ADD COLUMN "publicBookingEnabled" BOOLEAN NOT NULL DEFAULT true, ADD COLUMN "address" TEXT, ADD COLUMN "mapsUrl" TEXT, ADD COLUMN "phone" TEXT, ADD COLUMN "whatsappPhone" TEXT;
ALTER TABLE "OnlineBookingSettings" ADD COLUMN "maximumAdvanceValue" INTEGER NOT NULL DEFAULT 60, ADD COLUMN "maximumAdvanceUnit" "AdvanceUnit" NOT NULL DEFAULT 'days', ADD COLUMN "largePartyThreshold" INTEGER, ADD COLUMN "showAddress" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "showPhone" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "showMenu" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "showInstagram" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "showGoogleMaps" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "commentsEnabled" BOOLEAN NOT NULL DEFAULT true;
UPDATE "OnlineBookingSettings" SET "maximumAdvanceValue" = "maxAdvanceDays";

CREATE TABLE "BookingWindow" ("id" TEXT NOT NULL, "restaurantId" TEXT NOT NULL, "branchId" TEXT NOT NULL, "weekday" INTEGER NOT NULL, "service" "BookingService" NOT NULL, "isEnabled" BOOLEAN NOT NULL DEFAULT true, "startTime" TEXT NOT NULL, "endTime" TEXT NOT NULL, "intervalMin" INTEGER NOT NULL DEFAULT 30, CONSTRAINT "BookingWindow_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "BookingWindow_branchId_weekday_service_key" ON "BookingWindow"("branchId", "weekday", "service");
CREATE INDEX "BookingWindow_restaurantId_branchId_idx" ON "BookingWindow"("restaurantId", "branchId");
ALTER TABLE "BookingWindow" ADD CONSTRAINT "BookingWindow_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BookingWindow" ADD CONSTRAINT "BookingWindow_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
INSERT INTO "BookingWindow" ("id","restaurantId","branchId","weekday","service","isEnabled","startTime","endTime","intervalMin") SELECT 'legacy_' || "id", "restaurantId", "branchId", "weekday", CASE WHEN "startTime" < '17:00' THEN 'lunch'::"BookingService" ELSE 'dinner'::"BookingService" END, "isEnabled", "startTime", "endTime", "intervalMin" FROM "OnlineBookingSchedule";

CREATE TABLE "BookingCutoffRule" ("id" TEXT NOT NULL, "restaurantId" TEXT NOT NULL, "service" "BookingService" NOT NULL, "weekdays" INTEGER[] NOT NULL, "minimumAdvanceMinutes" INTEGER NOT NULL, "sameDayOnly" BOOLEAN NOT NULL DEFAULT false, "fallbackAction" TEXT NOT NULL DEFAULT 'walk_in', CONSTRAINT "BookingCutoffRule_pkey" PRIMARY KEY ("id"));
CREATE INDEX "BookingCutoffRule_restaurantId_idx" ON "BookingCutoffRule"("restaurantId");
ALTER TABLE "BookingCutoffRule" ADD CONSTRAINT "BookingCutoffRule_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "BookingException" ("id" TEXT NOT NULL, "restaurantId" TEXT NOT NULL, "branchId" TEXT NOT NULL, "serviceDate" TIMESTAMP(3) NOT NULL, "type" "BookingExceptionType" NOT NULL, "windows" JSONB, CONSTRAINT "BookingException_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "BookingException_branchId_serviceDate_key" ON "BookingException"("branchId", "serviceDate");
CREATE INDEX "BookingException_restaurantId_branchId_serviceDate_idx" ON "BookingException"("restaurantId", "branchId", "serviceDate");
ALTER TABLE "BookingException" ADD CONSTRAINT "BookingException_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BookingException" ADD CONSTRAINT "BookingException_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
