-- THE LEDGER HALF OF A CARRY DEDUCTION GETS A LINK TO ITS PAYOUT (D-23).
--
-- A deduction is ONE fact expressed in TWO rows: Payout.netAmount goes down,
-- and a LedgerEntry of type PAYMENT says the member settled that much of their
-- carried balance out of it.
--
-- The ledger half had no reference to the payout half, so nothing could
-- reverse it. Five paths destroy or reset a payout — deletePayout,
-- removeWinnerFromWeek, undoDraw, movePayoutToWeek (which writes netAmount
-- back to gross - fee), assignPayoutManually's replace, and removal from the
-- cycle — and every one of them left behind a PAYMENT entry reading
-- "Deducted from payout — Cycle 1 2026, number #19" pointing at a payout that
-- no longer exists, with the member's balance still reading as settled. They
-- collected the full amount AND kept the credit.
--
-- The asymmetry was visible inside deletePayout itself: it calls
-- unsettlePayout to reverse the winner-week settlement, because THAT half has
-- a foreign key (PaymentEvent.settlementPayoutId), and did nothing for the
-- carry deduction, because that half had none. This is that key.
--
-- ON DELETE SET NULL, matching settlementPayoutId. The reversal runs BEFORE
-- the delete in the same transaction; the constraint is the backstop for a
-- path that forgets, not the mechanism.

ALTER TABLE "ledger_entries" ADD COLUMN IF NOT EXISTS "payoutId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ledger_entries_payoutId_fkey'
  ) THEN
    ALTER TABLE "ledger_entries"
      ADD CONSTRAINT "ledger_entries_payoutId_fkey"
      FOREIGN KEY ("payoutId") REFERENCES "payouts"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "ledger_entries_payoutId_idx" ON "ledger_entries" ("payoutId");

-- Members may already read their own ledger rows; the new column follows the
-- same column-level grant (notes stay organizer-only).
GRANT SELECT (id, "personId", type, amount, description, "method", "occurredAt", "createdAt", "payoutId")
  ON public.ledger_entries TO authenticated;
