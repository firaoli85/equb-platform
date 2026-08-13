-- TWO DEFECTS IN 20260812030000_member_agreement, both found by review before
-- a single member had signed.

-- 1. THE APPEND-ONLY TRIGGER MADE MEMBERS UNDELETABLE.
--
-- It fired `BEFORE UPDATE OR DELETE ... FOR EACH ROW`, on a table whose
-- participationId and personId foreign keys are ON DELETE CASCADE. Postgres
-- fires row-level triggers on CASCADED deletes too — so from the moment one
-- member signed, deleting that participation, that person, or their whole
-- cycle would abort with a raw Postgres exception. That is
-- `participation-removal.ts`, `edits.ts` deletePerson, `cycles.ts` and
-- `cycle-close.ts` all broken, against 2.9 (clean delete) and 2.23 (nothing
-- requires a developer).
--
-- The audit-log precedent this copied is safe only because `audit_logs` has no
-- foreign key pointing at it. This table has two.
--
-- SO IT GUARDS UPDATE ONLY. That is where the value was: evidence must not be
-- ALTERED after the fact. Deletion here is never a tidy-up — the only route to
-- it is deleting the person or the cycle, which is a deliberate, confirmed,
-- typed-name act that 2.9 explicitly provides for, and a signature belonging
-- to a person who no longer exists is not evidence of anything.
DROP TRIGGER IF EXISTS agreement_signatures_no_update ON "agreement_signatures";

CREATE OR REPLACE FUNCTION agreement_signatures_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'agreement_signatures is append-only: a signature cannot be altered after the fact';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agreement_signatures_no_update
  BEFORE UPDATE ON "agreement_signatures"
  FOR EACH ROW EXECUTE FUNCTION agreement_signatures_append_only();

-- 2. ROW LEVEL SECURITY WAS MISSING ON BOTH NEW TABLES.
--
-- 20260804172404_enable_rls states the rule and the reason: Supabase exposes
-- the public schema through PostgREST and new tables receive default grants
-- for the anon/authenticated roles, so every table gets RLS with no policies
-- and the API roles get nothing. Prisma connects as the table owner and
-- bypasses RLS, so the platform is unaffected.
--
-- These two were added without it. `agreement_signatures` is the worst table
-- in the database to leave exposed: it holds every signing member's IP
-- address, user agent, timezone, approximate location and the full text of the
-- document they signed.
ALTER TABLE "agreement_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agreement_signatures" ENABLE ROW LEVEL SECURITY;
