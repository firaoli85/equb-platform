-- AlterTable
ALTER TABLE "people" ADD COLUMN     "authUserId" UUID,
ADD COLUMN     "pinFailedAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pinHash" TEXT,
ADD COLUMN     "pinLockedUntil" TIMESTAMP(3),
ADD COLUMN     "pinLoginAllowed" BOOLEAN;

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "people_authUserId_key" ON "people"("authUserId");

-- ————————————————————————————————————————————————————————————————————————
-- RLS POLICIES (ground truth 2.8). RLS is already ENABLED deny-all on every
-- table; these policies open exactly what each role may see:
--   ADMIN  (JWT app_metadata.is_admin = true): everything, read and write.
--   MEMBER (authenticated, linked via people."authUserId"): READ ONLY their
--          own rows, plus the Cycle/Week rows of cycles they are in.
--   MEMBER writes NOTHING. Wheel/selection tables stay admin-only (2.3/2.4).
-- Prisma connects as table owner and bypasses RLS — these policies protect
-- the Supabase Data API surface. Prisma's migrate diff does not track
-- policies/functions/views, so none of this is at drift risk.
-- ————————————————————————————————————————————————————————————————————————

ALTER TABLE "settings" ENABLE ROW LEVEL SECURITY;

-- Admin identity comes from app_metadata (NEVER user_metadata, which users
-- can edit themselves): only the service role can set app_metadata.
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT coalesce((((SELECT auth.jwt()) -> 'app_metadata' ->> 'is_admin'))::boolean, false)
$$;

-- The signed-in member's Person id. SECURITY INVOKER: runs under the
-- caller's own RLS, which permits reading exactly their own people row.
CREATE OR REPLACE FUNCTION public.current_person_id() RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT id FROM public.people WHERE "authUserId" = (SELECT auth.uid())
$$;

-- ————— ADMIN: full read/write everywhere —————
CREATE POLICY admin_all ON "people" FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY admin_all ON "cycles" FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY admin_all ON "weeks" FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY admin_all ON "participations" FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY admin_all ON "lucky_numbers" FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY admin_all ON "payments" FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY admin_all ON "payment_events" FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY admin_all ON "payment_allocations" FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY admin_all ON "payouts" FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY admin_all ON "ledger_entries" FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY admin_all ON "slots" FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY admin_all ON "slot_members" FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY admin_all ON "winner_plans" FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY admin_all ON "winner_plan_numbers" FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY admin_all ON "draws" FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY admin_all ON "settings" FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ————— MEMBER: read ONLY their own rows —————
CREATE POLICY member_read_own ON "people" FOR SELECT TO authenticated
  USING ("authUserId" = (SELECT auth.uid()));

CREATE POLICY member_read_own ON "participations" FOR SELECT TO authenticated
  USING ("personId" = public.current_person_id());

CREATE POLICY member_read_own ON "lucky_numbers" FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.participations pt
    WHERE pt.id = "participationId" AND pt."personId" = public.current_person_id()
  ));

CREATE POLICY member_read_own ON "payments" FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.participations pt
    WHERE pt.id = "participationId" AND pt."personId" = public.current_person_id()
  ));

CREATE POLICY member_read_own ON "payment_events" FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.participations pt
    WHERE pt.id = "participationId" AND pt."personId" = public.current_person_id()
  ));

CREATE POLICY member_read_own ON "payment_allocations" FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.payment_events e
    JOIN public.participations pt ON pt.id = e."participationId"
    WHERE e.id = "eventId" AND pt."personId" = public.current_person_id()
  ));

CREATE POLICY member_read_own ON "payouts" FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.lucky_numbers n
    JOIN public.participations pt ON pt.id = n."participationId"
    WHERE n.id = "luckyNumberId" AND pt."personId" = public.current_person_id()
  ));

CREATE POLICY member_read_own ON "ledger_entries" FOR SELECT TO authenticated
  USING ("personId" = public.current_person_id());

-- ————— MEMBER: shared context — the cycle they are in (2.8) —————
CREATE POLICY member_read_in_cycle ON "cycles" FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.participations pt
    WHERE pt."cycleId" = id AND pt."personId" = public.current_person_id()
  ));

CREATE POLICY member_read_in_cycle ON "weeks" FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.participations pt
    WHERE pt."cycleId" = "cycleId" AND pt."personId" = public.current_person_id()
  ));

-- ————— The social layer (2.8): progress shared, amounts never —————
-- SECURITY DEFINER view (postgres-owned, bypasses base RLS) exposing ONLY
-- name + weeks-paid-count + behind-count, scoped to cycles the CALLER is in.
-- No amounts, no lucky numbers, no phone, no payout figures.
CREATE OR REPLACE VIEW public.member_progress AS
WITH me AS (
  SELECT id FROM public.people WHERE "authUserId" = (SELECT auth.uid())
),
current_week AS (
  SELECT c.id AS cycle_id,
         greatest(0, floor((current_date - c."startDate"::date) / 7.0) + 1)::int AS week_no
  FROM public.cycles c
)
SELECT
  pt."cycleId"           AS cycle_id,
  pt.id                  AS participation_id,
  per."nameAmharic"      AS name_amharic,
  per."nameEnglishFirst" AS name_english_first,
  least(floor(coalesce(paid.total, 0)::numeric / pt."weeklyAmount"), pt."weeksCommitted")::int AS weeks_paid,
  greatest(0,
    least(cw.week_no - pt."startWeek" + 1, pt."weeksCommitted")
    - coalesce(def.cnt, 0)
    - floor(coalesce(paid.total, 0)::numeric / pt."weeklyAmount")
  )::int AS weeks_behind
FROM public.participations pt
JOIN public.people per ON per.id = pt."personId"
JOIN current_week cw ON cw.cycle_id = pt."cycleId"
LEFT JOIN LATERAL (
  SELECT sum(p."amountPaid") AS total
  FROM public.payments p
  WHERE p."participationId" = pt.id
) paid ON true
LEFT JOIN LATERAL (
  SELECT count(*) AS cnt
  FROM public.payments p
  JOIN public.weeks w ON w.id = p."weekId"
  WHERE p."participationId" = pt.id
    AND (p."isDeferred" OR w."isSkipped")
    AND w."weekNumber" <= cw.week_no
) def ON true
WHERE pt."cycleId" IN (
  SELECT pt2."cycleId" FROM public.participations pt2 JOIN me ON me.id = pt2."personId"
);

REVOKE ALL ON public.member_progress FROM anon, authenticated;
GRANT SELECT ON public.member_progress TO authenticated;
