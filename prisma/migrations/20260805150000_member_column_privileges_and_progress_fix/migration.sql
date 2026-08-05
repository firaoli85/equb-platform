-- Member portal privacy + progress correctness (2.8 / 2.14 / 2.16).
--
-- 1) COLUMN-LEVEL PRIVILEGES. RLS gates ROWS, not columns: member_read_own
--    on "people" exposed the member's entire row through the Data API —
--    including pinHash (a 4–8 digit PIN behind bcrypt is offline-crackable),
--    PIN lockout state, and the organizer's private notes. weeks.notes was
--    readable cycle-wide. The app itself never reads these through the Data
--    API (server actions use the service connection), so revoking SELECT on
--    the sensitive columns from `authenticated` breaks nothing while closing
--    the browser-side hole. `service_role` and `postgres` keep full access.
--
-- 2) member_progress VIEW FIX. The old view only counted a week as excused
--    when a payments ROW existed on it — but skipping a week sets only
--    weeks."isSkipped" and creates no payment rows, so every member without
--    a row on a skipped week showed one extra week behind on the group page
--    while their own /me said "Perfect record" (derived-state drift, 2.14).
--    The view now derives excused weeks from the weeks table directly, and
--    counts a week as ELAPSED only once its 5-day payment window has CLOSED
--    (2.16: late is law only when the window closes) — so the public
--    "behind" pill can never accuse ahead of the boundary /me itself uses.

-- ————— 1) Column-level privileges —————

-- people: hide PIN secrets/lockout and organizer notes from browser sessions.
REVOKE SELECT ON public.people FROM authenticated, anon;
GRANT SELECT (
  id, "nameAmharic", "nameEnglishFirst", "nameEnglishLast",
  phone, "authUserId", "pinLoginAllowed", "createdAt", "updatedAt"
) ON public.people TO authenticated;

-- weeks: notes are organizer annotations (may reference members' private
-- circumstances) and were readable by every member of the cycle.
REVOKE SELECT ON public.weeks FROM authenticated, anon;
GRANT SELECT (id, "cycleId", "weekNumber", date, "isSkipped")
  ON public.weeks TO authenticated;

-- payments / payment_events / payouts / ledger_entries: notes are organizer
-- commentary, not member-facing data — even on the member's own rows.
REVOKE SELECT ON public.payments FROM authenticated, anon;
GRANT SELECT (id, "weekId", "participationId", "amountPaid", "isDeferred", method, "paidAt")
  ON public.payments TO authenticated;

REVOKE SELECT ON public.payment_events FROM authenticated, anon;
GRANT SELECT (id, "participationId", amount, method, "receivedAt", "idempotencyKey", "createdAt")
  ON public.payment_events TO authenticated;

REVOKE SELECT ON public.payouts FROM authenticated, anon;
GRANT SELECT (id, "luckyNumberId", "drawId", "grossAmount", "feeAmount", "netAmount", status, method, "paidAt")
  ON public.payouts TO authenticated;

REVOKE SELECT ON public.ledger_entries FROM authenticated, anon;
GRANT SELECT (id, "personId", type, amount, description, "createdAt")
  ON public.ledger_entries TO authenticated;

-- ————— 2) member_progress: skipped weeks excused, closed-window elapsed —————

CREATE OR REPLACE VIEW public.member_progress AS
WITH me AS (
  SELECT id FROM public.people WHERE "authUserId" = (SELECT auth.uid())
)
SELECT
  pt."cycleId"           AS cycle_id,
  pt.id                  AS participation_id,
  per."nameAmharic"      AS name_amharic,
  per."nameEnglishFirst" AS name_english_first,
  least(
    floor(coalesce(paid.total, 0)::numeric / pt."weeklyAmount"),
    pt."weeksCommitted"
  )::int AS weeks_paid,
  greatest(
    0,
    coalesce(closed.elapsed, 0)
    - coalesce(closed.excused, 0)
    - floor(coalesce(paid.total, 0)::numeric / pt."weeklyAmount")
  )::int AS weeks_behind
FROM public.participations pt
JOIN public.people per ON per.id = pt."personId"
LEFT JOIN LATERAL (
  SELECT sum(p."amountPaid") AS total
  FROM public.payments p
  WHERE p."participationId" = pt.id
) paid ON true
-- Weeks of THEIR window whose 5-day payment window has CLOSED, and how many
-- of those are excused (cycle-wide skip, or a personal deferral row).
LEFT JOIN LATERAL (
  SELECT
    count(*) AS elapsed,
    count(*) FILTER (
      WHERE w."isSkipped" OR EXISTS (
        SELECT 1 FROM public.payments p2
        WHERE p2."weekId" = w.id
          AND p2."participationId" = pt.id
          AND p2."isDeferred"
      )
    ) AS excused
  FROM public.weeks w
  WHERE w."cycleId" = pt."cycleId"
    AND w."weekNumber" >= pt."startWeek"
    AND w."weekNumber" <  pt."startWeek" + pt."weeksCommitted"
    AND current_date >= (w.date::date + 5)
) closed ON true
WHERE pt."cycleId" IN (
  SELECT pt2."cycleId" FROM public.participations pt2 JOIN me ON me.id = pt2."personId"
);

REVOKE ALL ON public.member_progress FROM anon, authenticated;
GRANT SELECT ON public.member_progress TO authenticated;
