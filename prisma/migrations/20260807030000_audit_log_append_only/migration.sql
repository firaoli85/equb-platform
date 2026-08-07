-- THE AUDIT LOG IS APPEND-ONLY, ENFORCED BY THE DATABASE (D-32, 2.14).
--
-- No code in app/actions updates or deletes an audit row today, and a guard
-- test fails if any ever does. But that guard reads TypeScript, and the audit
-- log is precisely the record that has to stay true when the application is
-- not — a hand-run query, a future action written in a hurry, a migration
-- that "tidies up". So the rule lives where nothing can route around it.
--
-- INSERT is unaffected: writing entries is the point.
--
-- WHAT THIS COSTS. Audit rows can never be pruned or corrected. That is the
-- intended trade: an entry that could be edited is not evidence of anything.
-- A wrong entry is answered by a NEW entry, exactly as a wrong payment is
-- answered by a correcting receipt rather than a rewritten one.

CREATE OR REPLACE FUNCTION public.audit_logs_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'audit_logs is append-only: an entry is never changed or removed (attempted %). '
    'A wrong entry is answered by a NEW entry (D-32).',
    lower(TG_OP);
END;
$$;

DROP TRIGGER IF EXISTS audit_logs_no_update ON public.audit_logs;
CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.audit_logs_append_only();

DROP TRIGGER IF EXISTS audit_logs_no_delete ON public.audit_logs;
CREATE TRIGGER audit_logs_no_delete
  BEFORE DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.audit_logs_append_only();

-- Reading the log now pages, filters by action and entity, and takes a date
-- range. Without these, every page view sorts the whole table and counts it.
CREATE INDEX IF NOT EXISTS "audit_logs_createdAt_idx" ON public.audit_logs ("createdAt" DESC);
CREATE INDEX IF NOT EXISTS "audit_logs_action_createdAt_idx"
  ON public.audit_logs (action, "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "audit_logs_entity_entityId_idx"
  ON public.audit_logs (entity, "entityId");
