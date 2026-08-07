-- D-2: THE CARRY INTENTION, PERSISTED.
--
-- Choosing "deduct it from their payout" when adding a member to a cycle used
-- to write an audit line and nothing else — so the decision could be made and
-- then never acted on, because nothing resurfaced it. It is now stored against
-- the participation and offered at payout time.
--
-- STILL AN INTENTION (D-23). These columns decide only whether the deduction
-- offer arrives PRE-TICKED. Applying it requires a fresh organizer
-- confirmation every time; nothing reads these columns as permission. That
-- rule is enforced in lib/carry-balance.ts and guarded by a test that fails if
-- any code path reduces a payout by a balance without an explicit confirmation.
--
-- Per PARTICIPATION, not per person: the same member can carry a balance into
-- two cycles and be treated differently in each.

ALTER TABLE "participations" ADD COLUMN IF NOT EXISTS "carryIntent" TEXT;
ALTER TABLE "participations" ADD COLUMN IF NOT EXISTS "carryIntentAt" TIMESTAMP(3);
ALTER TABLE "participations" ADD COLUMN IF NOT EXISTS "carryIntentAmount" INTEGER;
