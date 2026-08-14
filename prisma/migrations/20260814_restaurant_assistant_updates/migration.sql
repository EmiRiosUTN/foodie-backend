CREATE TYPE "AssistantUpdateCategory" AS ENUM ('menu', 'hours', 'event', 'promotion', 'general');
CREATE TYPE "AssistantUpdateValidity" AS ENUM ('indefinite', 'single_date', 'range');

CREATE TABLE "RestaurantAssistantUpdate" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "category" "AssistantUpdateCategory" NOT NULL DEFAULT 'general',
  "content" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "validityType" "AssistantUpdateValidity" NOT NULL DEFAULT 'indefinite',
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RestaurantAssistantUpdate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RestaurantAssistantUpdate_restaurantId_isActive_position_idx" ON "RestaurantAssistantUpdate"("restaurantId", "isActive", "position");
CREATE INDEX "RestaurantAssistantUpdate_restaurantId_isActive_startsAt_endsAt_idx" ON "RestaurantAssistantUpdate"("restaurantId", "isActive", "startsAt", "endsAt");

ALTER TABLE "RestaurantAssistantUpdate" ADD CONSTRAINT "RestaurantAssistantUpdate_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
