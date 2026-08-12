-- A STRETCH OF WEEKS A MEMBER WAS NOT PART OF THE CYCLE (2.18).
--
-- `participations.closedAtWeek` can only TRUNCATE a window. It cannot
-- describe a HOLE in one — and the moment a stopped member is brought back,
-- the weeks they were away have to stay outside their expectation for good,
-- which is a hole. A member who stops, resumes and stops again has two.
--
-- `toWeek` NULL means the break is still open: they are stopped, and their
-- window ends at `fromWeek - 1`. Closing the break IS "they are contributing
-- again", which makes reactivation forward-only by construction.
--
-- Additive only. `status` and `closedAtWeek` stay as the denormalised current
-- state that every existing ACTIVE filter already reads.
CREATE TABLE "participation_breaks" (
    "id" TEXT NOT NULL,
    "participationId" TEXT NOT NULL,
    "fromWeek" INTEGER NOT NULL,
    "toWeek" INTEGER,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "participation_breaks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "participation_breaks_participationId_idx" ON "participation_breaks"("participationId");

ALTER TABLE "participation_breaks"
  ADD CONSTRAINT "participation_breaks_participationId_fkey"
  FOREIGN KEY ("participationId") REFERENCES "participations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- BACKFILL. Members closed before this table existed carry their stopping
-- point on the participation row; those closed by `removeFromCycle`'s "keep
-- their money records" carry NULL, and for them the honest reading is that
-- they stopped after their last payment — the fact 2.18 preserves anyway.
INSERT INTO "participation_breaks" ("id", "participationId", "fromWeek", "toWeek", "reason", "startedAt")
SELECT
  'pbk_' || p."id",
  p."id",
  COALESCE(
    p."closedAtWeek",
    (SELECT MAX(w."weekNumber")
       FROM "payments" pay
       JOIN "weeks" w ON w."id" = pay."weekId"
      WHERE pay."participationId" = p."id" AND pay."amountPaid" > 0),
    p."startWeek" - 1
  ) + 1,
  NULL,
  COALESCE(p."closeReason", 'STOPPED_CONTRIBUTING'),
  COALESCE(p."closedAt", CURRENT_TIMESTAMP)
FROM "participations" p
WHERE p."status" = 'CLOSED';
