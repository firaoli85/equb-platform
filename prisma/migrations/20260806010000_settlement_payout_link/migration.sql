-- SECURITY (audit C6): a settlement receipt was identified by the PREFIX of
-- its idempotencyKey — a column the client controls on recordPayment. A
-- forged "draw-settle:…" key let an ordinary receipt be treated as payout
-- money: deletable by deletePayout, creditable onto a payout net by
-- moveDraw, and countable as "already received" by the terms settlement.
--
-- Identification now uses columns no client can reach:
--   pinnedWeekId != null      → this IS a settlement receipt
--   settlementPayoutId        → WHICH payout funded it
-- The idempotency key keeps its uniqueness role and nothing more.

ALTER TABLE "payment_events" ADD COLUMN "settlementPayoutId" TEXT;

CREATE INDEX "payment_events_settlementPayoutId_idx" ON "payment_events"("settlementPayoutId");

ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_settlementPayoutId_fkey"
  FOREIGN KEY ("settlementPayoutId") REFERENCES "payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill the existing settlements written under the old scheme, so the new
-- discriminator describes history as accurately as the key did. The key
-- format was `draw-settle:{drawId}:{payoutId}`; only rows the settlement
-- engine itself wrote carry a pinnedWeekId, so this cannot promote a forged
-- receipt that never had one.
UPDATE "payment_events" e
SET "settlementPayoutId" = split_part(e."idempotencyKey", ':', 3)
WHERE e."pinnedWeekId" IS NOT NULL
  AND e."idempotencyKey" LIKE 'draw-settle:%'
  AND split_part(e."idempotencyKey", ':', 3) IN (SELECT p."id" FROM "payouts" p);
