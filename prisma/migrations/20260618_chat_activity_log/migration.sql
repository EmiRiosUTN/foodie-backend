CREATE TABLE "ChatActivityLog" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "restaurantUserId" TEXT,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "chatClientId" TEXT,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "messageType" TEXT NOT NULL,
    "messageContent" TEXT,
    "templateId" TEXT,
    "templateName" TEXT,
    "templateParameters" JSONB,
    "fileName" TEXT,
    "fileMimeType" TEXT,
    "fileSize" INTEGER,
    "externalMessageId" TEXT,
    "externalResponse" JSONB,
    "errorMessage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatActivityLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChatActivityLog_restaurantId_createdAt_idx" ON "ChatActivityLog"("restaurantId", "createdAt");
CREATE INDEX "ChatActivityLog_restaurantUserId_createdAt_idx" ON "ChatActivityLog"("restaurantUserId", "createdAt");
CREATE INDEX "ChatActivityLog_chatId_createdAt_idx" ON "ChatActivityLog"("chatId", "createdAt");

ALTER TABLE "ChatActivityLog" ADD CONSTRAINT "ChatActivityLog_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatActivityLog" ADD CONSTRAINT "ChatActivityLog_restaurantUserId_fkey" FOREIGN KEY ("restaurantUserId") REFERENCES "RestaurantUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
