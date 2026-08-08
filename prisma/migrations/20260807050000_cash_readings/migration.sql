-- What the organizer ACTUALLY holds, at a moment in time.
--
-- The one stored fact in the cash-position feature (ground truth 2.14):
-- everything it is compared against is derived from money that already
-- happened. Additive only — no existing table is touched.
--
-- No foreign key on cycle_id, deliberately: a reading is about HIM, not about
-- one cycle, and deleting a cycle must never take his cash history with it
-- (the same reasoning as cycle_archives).
CREATE TABLE "cash_readings" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT,
    "totalAmount" INTEGER NOT NULL,
    "bankAmount" INTEGER,
    "cashAmount" INTEGER,
    "readAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_readings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cash_readings_readAt_idx" ON "cash_readings"("readAt");
CREATE INDEX "cash_readings_cycleId_idx" ON "cash_readings"("cycleId");
