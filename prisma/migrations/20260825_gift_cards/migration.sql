CREATE TYPE "GiftCardProductType" AS ENUM ('FIXED_MENU', 'OPEN_AMOUNT');
CREATE TYPE "GiftCardPaymentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');
CREATE TYPE "GiftCardOrderStatus" AS ENUM ('PENDING_PAYMENT', 'PAID', 'CANCELLED');
CREATE TYPE "GiftCardStatus" AS ENUM ('ACTIVE', 'REDEEMED', 'EXPIRED', 'CANCELLED');

CREATE TABLE "GiftCardProduct" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "GiftCardProductType" NOT NULL,
  "description" TEXT NOT NULL,
  "price" DECIMAL(12,2),
  "minAmount" DECIMAL(12,2),
  "maxAmount" DECIMAL(12,2),
  "partySize" INTEGER,
  "currency" TEXT NOT NULL DEFAULT 'ARS',
  "validityDays" INTEGER NOT NULL DEFAULT 180,
  "excludedDates" TEXT[] NOT NULL,
  "restrictions" JSONB,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GiftCardProduct_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GiftCardOrder" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "productId" TEXT,
  "type" "GiftCardProductType" NOT NULL,
  "purchaserName" TEXT NOT NULL,
  "purchaserPhone" TEXT NOT NULL,
  "recipientName" TEXT,
  "message" TEXT,
  "partySize" INTEGER,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'ARS',
  "paymentMethod" TEXT NOT NULL DEFAULT 'TRANSFER',
  "paymentStatus" "GiftCardPaymentStatus" NOT NULL DEFAULT 'PENDING',
  "status" "GiftCardOrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
  "paymentReference" TEXT,
  "paymentConfirmedAt" TIMESTAMP(3),
  "paymentConfirmedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GiftCardOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GiftCard" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "displayCode" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "originalAmount" DECIMAL(12,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'ARS',
  "status" "GiftCardStatus" NOT NULL DEFAULT 'ACTIVE',
  "validFrom" TIMESTAMP(3) NOT NULL,
  "validUntil" TIMESTAMP(3) NOT NULL,
  "imageUrl" TEXT,
  "pdfUrl" TEXT,
  "qrUrl" TEXT,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "redeemedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GiftCard_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GiftCardRedemption" (
  "id" TEXT NOT NULL,
  "giftCardId" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "redeemedBy" TEXT NOT NULL,
  "reservationId" TEXT,
  "notes" TEXT,
  "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GiftCardRedemption_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "GiftCardProduct" ADD COLUMN "paymentAlias" TEXT;
ALTER TABLE "GiftCardProduct" ADD COLUMN "paymentCbu" TEXT;
ALTER TABLE "GiftCardProduct" ADD COLUMN "paymentHolder" TEXT;

CREATE UNIQUE INDEX "GiftCard_displayCode_key" ON "GiftCard"("displayCode");
CREATE UNIQUE INDEX "GiftCard_tokenHash_key" ON "GiftCard"("tokenHash");
CREATE UNIQUE INDEX "GiftCard_orderId_key" ON "GiftCard"("orderId");
CREATE INDEX "GiftCardProduct_restaurantId_isActive_idx" ON "GiftCardProduct"("restaurantId", "isActive");
CREATE INDEX "GiftCardOrder_restaurantId_status_createdAt_idx" ON "GiftCardOrder"("restaurantId", "status", "createdAt");
CREATE INDEX "GiftCardOrder_restaurantId_paymentStatus_idx" ON "GiftCardOrder"("restaurantId", "paymentStatus");
CREATE INDEX "GiftCard_restaurantId_status_createdAt_idx" ON "GiftCard"("restaurantId", "status", "createdAt");
CREATE INDEX "GiftCardRedemption_restaurantId_redeemedAt_idx" ON "GiftCardRedemption"("restaurantId", "redeemedAt");

ALTER TABLE "GiftCardProduct" ADD CONSTRAINT "GiftCardProduct_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GiftCardOrder" ADD CONSTRAINT "GiftCardOrder_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GiftCardOrder" ADD CONSTRAINT "GiftCardOrder_productId_fkey" FOREIGN KEY ("productId") REFERENCES "GiftCardProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GiftCard" ADD CONSTRAINT "GiftCard_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GiftCard" ADD CONSTRAINT "GiftCard_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "GiftCardOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GiftCardRedemption" ADD CONSTRAINT "GiftCardRedemption_giftCardId_fkey" FOREIGN KEY ("giftCardId") REFERENCES "GiftCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GiftCardRedemption" ADD CONSTRAINT "GiftCardRedemption_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
