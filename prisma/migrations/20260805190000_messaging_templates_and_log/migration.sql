-- State-aware messaging (2.20 / 2.21 / 2.28): organizer-editable templates
-- and the append-only log of every message that left (or failed leaving).
-- Same security posture as every other table: RLS enabled with NO policies —
-- messaging is organizer-only and served through server actions; the Data
-- API roles get nothing. people."noMessages" is the hardship flag (2.20);
-- it is deliberately NOT added to the authenticated column grant.

CREATE TYPE "MessageTrigger" AS ENUM ('AUTOMATIC', 'MANUAL');
CREATE TYPE "MessageSendStatus" AS ENUM ('SENT', 'FAILED');

CREATE TABLE "message_templates" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "metaTemplateSid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "message_templates_key_key" ON "message_templates"("key");

CREATE TABLE "message_logs" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "templateId" TEXT,
    "templateKey" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'WHATSAPP',
    "toPhone" TEXT NOT NULL,
    "trigger" "MessageTrigger" NOT NULL,
    "status" "MessageSendStatus" NOT NULL,
    "providerSid" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "message_logs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "message_logs_personId_fkey" FOREIGN KEY ("personId")
        REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "message_logs_templateId_fkey" FOREIGN KEY ("templateId")
        REFERENCES "message_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "message_logs_personId_idx" ON "message_logs"("personId");
CREATE INDEX "message_logs_createdAt_idx" ON "message_logs"("createdAt");

ALTER TABLE "people" ADD COLUMN "noMessages" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "message_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "message_logs" ENABLE ROW LEVEL SECURITY;
