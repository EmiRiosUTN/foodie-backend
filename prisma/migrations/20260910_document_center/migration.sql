CREATE TYPE "DepositProofReviewStatus" AS ENUM ('pending_review', 'approved', 'rejected');
CREATE TYPE "DocumentCategory" AS ENUM ('deposit_proof', 'cv', 'price_list', 'menu', 'invoice', 'contract', 'supplier', 'other');
CREATE TYPE "DocumentOrigin" AS ENUM ('chat', 'manual', 'n8n');
CREATE TYPE "DocumentStatus" AS ENUM ('inbox', 'active', 'archived');

CREATE TABLE "Document" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "branchId" TEXT,
  "category" "DocumentCategory" NOT NULL DEFAULT 'other',
  "suggestedCategory" "DocumentCategory",
  "suggestionConfidence" DOUBLE PRECISION,
  "origin" "DocumentOrigin" NOT NULL,
  "status" "DocumentStatus" NOT NULL DEFAULT 'inbox',
  "objectKey" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "contactName" TEXT,
  "contactPhone" TEXT,
  "externalMessageId" TEXT,
  "caption" TEXT,
  "depositProofRequestId" TEXT,
  "createdByUserId" TEXT,
  "archivedAt" TIMESTAMP(3),
  "archivedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "DepositProof" ADD COLUMN "reviewStatus" "DepositProofReviewStatus" NOT NULL DEFAULT 'pending_review';
ALTER TABLE "DepositProof" ADD COLUMN "rejectionReason" TEXT;
ALTER TABLE "DepositProof" ADD COLUMN "documentId" TEXT;

CREATE UNIQUE INDEX "Document_objectKey_key" ON "Document"("objectKey");
CREATE UNIQUE INDEX "Document_restaurantId_externalMessageId_key" ON "Document"("restaurantId", "externalMessageId");
CREATE INDEX "Document_restaurantId_status_category_createdAt_idx" ON "Document"("restaurantId", "status", "category", "createdAt");
CREATE INDEX "Document_restaurantId_contactPhone_idx" ON "Document"("restaurantId", "contactPhone");
CREATE UNIQUE INDEX "DepositProof_documentId_key" ON "DepositProof"("documentId");

ALTER TABLE "Document" ADD CONSTRAINT "Document_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Document" ADD CONSTRAINT "Document_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DepositProof" ADD CONSTRAINT "DepositProof_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
