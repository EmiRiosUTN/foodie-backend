CREATE TABLE "RestaurantCustomization" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "description" TEXT,
  "address" TEXT,
  "mapsUrl" TEXT,
  "menuUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RestaurantCustomization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RestaurantSpecial" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "price" DECIMAL(10,2),
  "imageUrl" TEXT,
  "externalUrl" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RestaurantSpecial_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RestaurantCustomization_restaurantId_key" ON "RestaurantCustomization"("restaurantId");
CREATE INDEX "RestaurantSpecial_restaurantId_isActive_startsAt_endsAt_idx" ON "RestaurantSpecial"("restaurantId", "isActive", "startsAt", "endsAt");
ALTER TABLE "RestaurantCustomization" ADD CONSTRAINT "RestaurantCustomization_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RestaurantSpecial" ADD CONSTRAINT "RestaurantSpecial_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
