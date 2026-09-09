CREATE TYPE "DepositStatus" AS ENUM ('pending', 'partial', 'complete');
CREATE TYPE "DepositEntryType" AS ENUM ('payment', 'refund', 'adjustment');
CREATE TYPE "DepositProofRequestStatus" AS ENUM ('awaiting_proof', 'received', 'fulfilled', 'expired', 'cancelled');

CREATE TABLE "ReservationDeposit" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "reservationId" TEXT NOT NULL,
  "requiredAmount" DECIMAL(12,2) NOT NULL,
  "paidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'ARS',
  "status" "DepositStatus" NOT NULL DEFAULT 'pending',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReservationDeposit_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "DepositEntry" (
  "id" TEXT NOT NULL,
  "depositId" TEXT NOT NULL,
  "type" "DepositEntryType" NOT NULL DEFAULT 'payment',
  "amount" DECIMAL(12,2) NOT NULL,
  "paidAt" TIMESTAMP(3) NOT NULL,
  "paymentMethod" TEXT NOT NULL,
  "reference" TEXT,
  "notes" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DepositEntry_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "DepositProofRequest" (
  "id" TEXT NOT NULL,
  "depositId" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "reservationId" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "status" "DepositProofRequestStatus" NOT NULL DEFAULT 'awaiting_proof',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'whatsapp',
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DepositProofRequest_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "DepositProof" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "entryId" TEXT,
  "objectKey" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "messageId" TEXT,
  "caption" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "reviewedByUserId" TEXT,
  CONSTRAINT "DepositProof_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReservationDeposit_reservationId_key" ON "ReservationDeposit"("reservationId");
CREATE INDEX "ReservationDeposit_restaurantId_branchId_status_idx" ON "ReservationDeposit"("restaurantId", "branchId", "status");
CREATE INDEX "DepositEntry_depositId_paidAt_idx" ON "DepositEntry"("depositId", "paidAt");
CREATE INDEX "DepositProofRequest_restaurantId_phone_status_expiresAt_idx" ON "DepositProofRequest"("restaurantId", "phone", "status", "expiresAt");
CREATE INDEX "DepositProofRequest_reservationId_idx" ON "DepositProofRequest"("reservationId");
CREATE UNIQUE INDEX "DepositProof_objectKey_key" ON "DepositProof"("objectKey");
CREATE INDEX "DepositProof_restaurantId_reviewedAt_receivedAt_idx" ON "DepositProof"("restaurantId", "reviewedAt", "receivedAt");
CREATE INDEX "DepositProof_requestId_idx" ON "DepositProof"("requestId");

ALTER TABLE "ReservationDeposit" ADD CONSTRAINT "ReservationDeposit_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReservationDeposit" ADD CONSTRAINT "ReservationDeposit_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReservationDeposit" ADD CONSTRAINT "ReservationDeposit_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DepositEntry" ADD CONSTRAINT "DepositEntry_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES "ReservationDeposit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DepositProofRequest" ADD CONSTRAINT "DepositProofRequest_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES "ReservationDeposit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DepositProof" ADD CONSTRAINT "DepositProof_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DepositProof" ADD CONSTRAINT "DepositProof_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "DepositProofRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DepositProof" ADD CONSTRAINT "DepositProof_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "DepositEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
