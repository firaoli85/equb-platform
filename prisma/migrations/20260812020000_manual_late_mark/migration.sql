-- THE ORGANIZER'S OWN LATE MARK (2.2, 2.14).
--
-- LATE has been purely derived: unpaid AND the payment window closed. That is
-- correct as a default and wrong as the only rule — the organizer knows things
-- the calendar does not. A member who says on Monday that they cannot pay this
-- week is late on Monday, not on Thursday, and until now he had to wait three
-- days for the system to agree with him.
--
-- STORED, because it is a DECISION, not a derivation (2.14). The timestamp
-- rather than a boolean because a financial record that says a decision was
-- made without saying when it was made is not a record.
--
-- Additive and nullable: every existing payment row stays valid, and a null
-- markedLateAt means exactly what it means today — the calendar decides.
ALTER TABLE "payments" ADD COLUMN "markedLateAt" TIMESTAMP(3);
ALTER TABLE "payments" ADD COLUMN "markedLateNote" TEXT;

-- Finding a member's marked weeks is a per-participation read on every status
-- computation; the partial index keeps it to the handful of rows that are
-- actually marked rather than the whole table.
CREATE INDEX "payments_marked_late_idx" ON "payments" ("participationId")
  WHERE "markedLateAt" IS NOT NULL;
