-- The life of a carried balance (2.18).
--
-- FORGIVEN: the organizer may write a balance off, in full or in part (2.2 —
-- his call, real life). It clears the balance exactly like a payment, but it
-- is a DIFFERENT fact: nobody paid it. Recording it as a PAYMENT would make
-- the history lie, so it gets its own type and the story shows it as forgiven.
ALTER TYPE "LedgerEntryType" ADD VALUE IF NOT EXISTS 'FORGIVEN';

-- How the money arrived, and the day it actually happened — a balance is
-- often settled long after the cycle ended, and "when" is part of the story.
ALTER TABLE "ledger_entries" ADD COLUMN IF NOT EXISTS "method" "PaymentMethod";
ALTER TABLE "ledger_entries" ADD COLUMN IF NOT EXISTS "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Members may already read their own ledger rows; the new columns follow the
-- same column-level grant (notes stay organizer-only).
GRANT SELECT (id, "personId", type, amount, description, "method", "occurredAt", "createdAt")
  ON public.ledger_entries TO authenticated;
