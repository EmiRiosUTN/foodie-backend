ALTER TYPE "RestaurantRole" ADD VALUE IF NOT EXISTS 'cashier';
ALTER TYPE "RestaurantRole" ADD VALUE IF NOT EXISTS 'kitchen';

ALTER TABLE "Restaurant"
ADD COLUMN IF NOT EXISTS "chatAuthEmail" TEXT,
ADD COLUMN IF NOT EXISTS "chatAuthSecret" TEXT;

ALTER TABLE "RestaurantUser"
ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;

ALTER TABLE "RestaurantUser"
ADD CONSTRAINT "RestaurantUser_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "RestaurantUser"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AuditLog"
ADD COLUMN IF NOT EXISTS "restaurantUserId" TEXT;

ALTER TABLE "AuditLog"
ADD CONSTRAINT "AuditLog_restaurantUserId_fkey"
FOREIGN KEY ("restaurantUserId") REFERENCES "RestaurantUser"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "AuditLog_restaurantUserId_createdAt_idx" ON "AuditLog"("restaurantUserId", "createdAt");
