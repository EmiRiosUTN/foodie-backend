-- CreateEnum
CREATE TYPE "AuthScope" AS ENUM ('platform', 'restaurant');

-- CreateEnum
CREATE TYPE "ExternalRequestStatus" AS ENUM ('success', 'error');

-- AlterTable
ALTER TABLE "IntegrationToken" ADD COLUMN "lastUsedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "scope" "AuthScope" NOT NULL,
    "platformUserId" TEXT,
    "restaurantUserId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalApiRequest" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "integrationTokenId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "requestHash" TEXT NOT NULL,
    "status" "ExternalRequestStatus" NOT NULL,
    "responseData" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "ExternalApiRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_scope_expiresAt_idx" ON "RefreshToken"("scope", "expiresAt");

-- CreateIndex
CREATE INDEX "RefreshToken_platformUserId_idx" ON "RefreshToken"("platformUserId");

-- CreateIndex
CREATE INDEX "RefreshToken_restaurantUserId_idx" ON "RefreshToken"("restaurantUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalApiRequest_restaurantId_action_idempotencyKey_key" ON "ExternalApiRequest"("restaurantId", "action", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ExternalApiRequest_restaurantId_createdAt_idx" ON "ExternalApiRequest"("restaurantId", "createdAt");

-- CreateIndex
CREATE INDEX "ExternalApiRequest_integrationTokenId_createdAt_idx" ON "ExternalApiRequest"("integrationTokenId", "createdAt");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_platformUserId_fkey" FOREIGN KEY ("platformUserId") REFERENCES "PlatformUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_restaurantUserId_fkey" FOREIGN KEY ("restaurantUserId") REFERENCES "RestaurantUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalApiRequest" ADD CONSTRAINT "ExternalApiRequest_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalApiRequest" ADD CONSTRAINT "ExternalApiRequest_integrationTokenId_fkey" FOREIGN KEY ("integrationTokenId") REFERENCES "IntegrationToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;
