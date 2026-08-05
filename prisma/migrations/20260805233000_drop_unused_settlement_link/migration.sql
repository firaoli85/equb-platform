-- The settlement receipt is tied to its payout via the idempotency key
-- `draw-settle:{drawId}:{payoutId}` — the payouts.settlementEventId column
-- added an hour earlier duplicated that linkage and is removed unused.

ALTER TABLE "payouts" DROP CONSTRAINT "payouts_settlementEventId_fkey";
DROP INDEX "payouts_settlementEventId_key";
ALTER TABLE "payouts" DROP COLUMN "settlementEventId";
