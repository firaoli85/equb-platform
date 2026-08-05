-- Supabase exposes the public schema through its Data API (PostgREST), and new
-- tables receive default grants for the anon/authenticated roles. This platform
-- is server-side only (Prisma as the table owner, which bypasses RLS), so enable
-- RLS with NO policies on every table: the API roles get nothing.
-- Ground truth 2.4/2.8: amounts, numbers, and payouts must never reach the browser.

ALTER TABLE "people" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cycles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "weeks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "participations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lucky_numbers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "slots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "slot_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "winner_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "winner_plan_numbers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "draws" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payouts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ledger_entries" ENABLE ROW LEVEL SECURITY;
-- Prisma's bookkeeping table exists in the real database but not in the shadow
-- database Prisma uses to verify migrations, so guard it.
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = '_prisma_migrations') THEN
    EXECUTE 'ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;
