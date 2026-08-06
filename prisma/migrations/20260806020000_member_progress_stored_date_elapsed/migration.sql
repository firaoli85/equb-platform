-- member_progress: match the TypeScript derivation exactly.
--
-- Two divergences are closed here. Both made /me/group and /me print different
-- behind-counts for the SAME member, which is derived-state drift (2.14).
--
-- 1) ELAPSED. Both sides now count a week as elapsed when the day the WEEK
--    ITSELF records has passed, plus the 5-day payment window. The view
--    already did this (current_date >= w.date + 5); the TypeScript side used
--    to project a week number off cycle."startDate" instead, so it counted the
--    current week the moment it opened. computeStanding now uses
--    weekHasElapsed() on each row's own stored date, so the two agree.
--
-- 2) DEFERRAL. The organizer's Aug 2026 ruling split "deferred" from
--    "skipped": a DEFERRED week is STILL OWED — the member is simply not
--    chased for it — while a SKIPPED week was never owed by anyone. This view
--    still excused personal deferrals, so a deferred member showed 0 weeks
--    behind on the group page and their true figure on their own page. Only
--    weeks."isSkipped" is excused now, exactly as amountOutstanding and
--    weeksBehind do in lib/derived.ts.
--
-- Everything else about the view is unchanged, including its auth.uid()
-- scoping and its column-level grants.

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
-- Weeks of THEIR window whose 5-day payment window has CLOSED, measured from
-- each week's OWN stored date, and how many of those nobody ever owed.
LEFT JOIN LATERAL (
  SELECT
    count(*) AS elapsed,
    -- ONLY a cycle-wide skip is excused. A personal deferral is still owed
    -- (Aug 2026 ruling) — it only stops the chasing, never the debt.
    count(*) FILTER (WHERE w."isSkipped") AS excused
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
