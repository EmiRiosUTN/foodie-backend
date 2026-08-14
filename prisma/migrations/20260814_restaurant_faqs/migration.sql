CREATE TABLE "RestaurantFaq" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "topic" TEXT NOT NULL,
  "question" TEXT NOT NULL,
  "answer" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RestaurantFaq_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RestaurantFaq_restaurantId_isActive_position_idx" ON "RestaurantFaq"("restaurantId", "isActive", "position");

ALTER TABLE "RestaurantFaq" ADD CONSTRAINT "RestaurantFaq_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
