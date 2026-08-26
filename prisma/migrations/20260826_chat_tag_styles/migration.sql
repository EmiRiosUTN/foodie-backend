CREATE TABLE "ChatTagStyle" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "tagName" TEXT NOT NULL,
  "color" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChatTagStyle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChatTagStyle_restaurantId_tagName_key" ON "ChatTagStyle"("restaurantId", "tagName");
CREATE INDEX "ChatTagStyle_restaurantId_idx" ON "ChatTagStyle"("restaurantId");

ALTER TABLE "ChatTagStyle" ADD CONSTRAINT "ChatTagStyle_restaurantId_fkey"
  FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
