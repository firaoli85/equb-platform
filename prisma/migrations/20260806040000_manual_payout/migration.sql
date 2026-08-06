-- 2.2 organizer discretion: a payout may be ASSIGNED rather than drawn (an
-- emergency, an agreement). It creates the identical structures — a Draw, a
-- Payout per lucky number, the winner's-week settlement — so undo, move,
-- delete, Collections and the cash position all work unchanged. The flag
-- exists only so the record shows it was a decision, not a spin.

ALTER TABLE "draws" ADD COLUMN "assignedManually" BOOLEAN NOT NULL DEFAULT false;
