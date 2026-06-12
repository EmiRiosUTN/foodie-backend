ALTER TABLE "Restaurant"
ADD COLUMN "chatModuleEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "chatClientId" TEXT,
ADD COLUMN "chatWabaId" TEXT,
ADD COLUMN "chatAccessToken" TEXT,
ADD COLUMN "chatWorkflowId" TEXT,
ADD COLUMN "chatPhoneNumberId" TEXT;
