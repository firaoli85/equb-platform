-- CLOSING A PARTICIPATION MID-CYCLE (2.18).
--
-- `status` and `closedAtWeek` already existed; nothing could WRITE them,
-- because closing had no reason and no date, and a financial record that says
-- someone stopped without saying when it was decided is not a record.
--
-- Additive only. Every column is nullable, so every existing row stays valid
-- and an ACTIVE participation carries nulls exactly as it does today.
--
-- No CHECK constraint on closeReason on purpose: the neutral list lives in
-- lib/participation-close.ts and is validated at the boundary. A database
-- enum would have to be migrated to add a reason, and the reasons are the
-- organizer's vocabulary, not the schema's.
ALTER TABLE "participations" ADD COLUMN "closeReason" TEXT;
ALTER TABLE "participations" ADD COLUMN "closeNote" TEXT;
ALTER TABLE "participations" ADD COLUMN "closedAt" TIMESTAMP(3);
