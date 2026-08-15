-- THE QUEUE BEHIND THE PREVIEW (2.20), phase 4b-ii.
--
-- A message that has been PREPARED and not sent needs somewhere to wait. It
-- does not wait in `message_logs`: that table answers "what did the platform
-- send to this member", and every surface reading it — their profile, the
-- conversation view, the delivery reconciliation — treats a row as a message
-- that went out. A draft parked there under a new status would show up in a
-- member's own history as something they were told.
CREATE TABLE "queued_messages" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "participationId" TEXT,
    "templateKey" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "toPhone" TEXT NOT NULL,
    "extras" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "queued_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "queued_messages_personId_idx" ON "queued_messages"("personId");
CREATE INDEX "queued_messages_createdAt_idx" ON "queued_messages"("createdAt");

-- ON DELETE CASCADE: a queued message belongs to the member it is about. Delete
-- the person (2.9 provides for it, deliberately and by typed name) and an
-- undelivered draft addressed to them is not evidence of anything.
ALTER TABLE "queued_messages" ADD CONSTRAINT "queued_messages_personId_fkey"
    FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ROW LEVEL SECURITY, stated by 20260804172404_enable_rls and missed once
-- already (see 20260812040000_agreement_rls_and_cascade). Supabase exposes the
-- public schema through PostgREST and new tables receive default grants for the
-- anon/authenticated roles, so every table gets RLS with no policies and the
-- API roles get nothing. Prisma connects as the table owner and bypasses RLS,
-- so the platform is unaffected. This table holds members' phone numbers and
-- the full text of messages about their money.
ALTER TABLE "queued_messages" ENABLE ROW LEVEL SECURITY;
