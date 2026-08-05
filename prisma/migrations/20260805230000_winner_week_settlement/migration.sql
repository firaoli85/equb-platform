-- The winner does not pay the week they win: their contribution for that
-- week is settled FROM the payout. A settlement is a PaymentEvent PINNED to
-- the win week (allocates there only, never oldest-first) and linked from
-- the payout so undoing the draw can un-settle the week exactly.

ALTER TABLE "payment_events" ADD COLUMN "pinnedWeekId" TEXT;
ALTER TABLE "payouts" ADD COLUMN "settlementEventId" TEXT;

CREATE UNIQUE INDEX "payouts_settlementEventId_key" ON "payouts"("settlementEventId");

ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_pinnedWeekId_fkey"
  FOREIGN KEY ("pinnedWeekId") REFERENCES "weeks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_settlementEventId_fkey"
  FOREIGN KEY ("settlementEventId") REFERENCES "payment_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
