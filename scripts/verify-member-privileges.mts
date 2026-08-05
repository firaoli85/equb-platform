// Behavioral verification (2.24): attempt the defects, confirm the database
// refuses them. All probes use LIMIT 0 — column privileges are checked at
// plan time, so nothing sensitive is ever fetched.
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const { prisma } = await import("../lib/prisma");
const { currentWeekNumber, calculateFinishWeek } = await import("../lib/money");

type Probe = { label: string; sql: string; expect: "denied" | "allowed" };

const probes: Probe[] = [
  { label: "people.pinHash", sql: 'SELECT "pinHash" FROM public.people LIMIT 0', expect: "denied" },
  { label: "people.pinLockedUntil", sql: 'SELECT "pinLockedUntil" FROM public.people LIMIT 0', expect: "denied" },
  { label: "people.notes", sql: "SELECT notes FROM public.people LIMIT 0", expect: "denied" },
  { label: "weeks.notes", sql: "SELECT notes FROM public.weeks LIMIT 0", expect: "denied" },
  { label: "payments.notes", sql: "SELECT notes FROM public.payments LIMIT 0", expect: "denied" },
  { label: "payment_events.notes", sql: "SELECT notes FROM public.payment_events LIMIT 0", expect: "denied" },
  { label: "payouts.notes", sql: "SELECT notes FROM public.payouts LIMIT 0", expect: "denied" },
  { label: "ledger_entries.notes", sql: "SELECT notes FROM public.ledger_entries LIMIT 0", expect: "denied" },
  { label: "people safe columns", sql: 'SELECT id, "nameAmharic", "nameEnglishFirst", phone FROM public.people LIMIT 0', expect: "allowed" },
  { label: "weeks safe columns", sql: 'SELECT id, "weekNumber", date, "isSkipped" FROM public.weeks LIMIT 0', expect: "allowed" },
  { label: "payments safe columns", sql: 'SELECT id, "amountPaid", "isDeferred" FROM public.payments LIMIT 0', expect: "allowed" },
  { label: "member_progress view", sql: "SELECT weeks_paid, weeks_behind FROM public.member_progress LIMIT 0", expect: "allowed" },
];

let failures = 0;
for (const probe of probes) {
  let outcome: "denied" | "allowed";
  try {
    // SET ROLE inside one transaction so the probe runs AS authenticated.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE authenticated");
      await tx.$queryRawUnsafe(probe.sql);
    });
    outcome = "allowed";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    outcome = msg.includes("permission denied") ? "denied" : "allowed";
    if (outcome === "allowed") throw e;
  }
  const ok = outcome === probe.expect;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${probe.label}: ${outcome} (expected ${probe.expect})`);
}

// ————— View vs computeStanding boundary check —————
// For every ACTIVE participation, recompute closed-window behind from the
// same rows the app uses and compare with the view's arithmetic (evaluated
// here without RLS by running its body for all rows).
const cycle = await prisma.cycle.findFirst({
  where: { status: "ACTIVE" },
  include: {
    weeks: { orderBy: { weekNumber: "asc" } },
    participations: { where: { status: "ACTIVE" }, include: { payments: { include: { week: true } } } },
  },
});
if (!cycle) throw new Error("No active cycle.");
const today = new Date();
const cw = currentWeekNumber(cycle.startDate, today);
const MS_PER_DAY = 86_400_000;
const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

type ViewRow = { participation_id: string; weeks_paid: number; weeks_behind: number };
const viewRows = await prisma.$queryRawUnsafe<ViewRow[]>(`
  SELECT pt.id AS participation_id,
    least(floor(coalesce(paid.total,0)::numeric / pt."weeklyAmount"), pt."weeksCommitted")::int AS weeks_paid,
    greatest(0, coalesce(c.elapsed,0) - coalesce(c.excused,0)
      - floor(coalesce(paid.total,0)::numeric / pt."weeklyAmount"))::int AS weeks_behind
  FROM public.participations pt
  LEFT JOIN LATERAL (SELECT sum(p."amountPaid") AS total FROM public.payments p WHERE p."participationId" = pt.id) paid ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS elapsed,
      count(*) FILTER (WHERE w."isSkipped" OR EXISTS (
        SELECT 1 FROM public.payments p2 WHERE p2."weekId" = w.id AND p2."participationId" = pt.id AND p2."isDeferred")) AS excused
    FROM public.weeks w
    WHERE w."cycleId" = pt."cycleId" AND w."weekNumber" >= pt."startWeek"
      AND w."weekNumber" < pt."startWeek" + pt."weeksCommitted"
      AND current_date >= (w.date::date + 5)
  ) c ON true
  WHERE pt."cycleId" = '${cycle.id}' AND pt.status = 'ACTIVE'
`);
const viewById = new Map(viewRows.map((r) => [r.participation_id, r]));

let mismatches = 0;
for (const pt of cycle.participations) {
  const finish = calculateFinishWeek(pt.startWeek, pt.weeksCommitted);
  const windowWeeks = cycle.weeks.filter((w) => w.weekNumber >= pt.startWeek && w.weekNumber <= finish);
  const closed = windowWeeks.filter((w) => utcDay(today) >= utcDay(w.date) + 5 * MS_PER_DAY);
  const excused = closed.filter((w) => {
    const row = pt.payments.find((p) => p.weekId === w.id) ?? null;
    return (row?.isDeferred ?? false) || w.isSkipped;
  }).length;
  const totalPaid = pt.payments.reduce((s, p) => s + p.amountPaid, 0);
  const credited = Math.floor(totalPaid / pt.weeklyAmount);
  const expectBehind = Math.max(0, closed.length - excused - credited);
  const expectPaid = Math.min(credited, pt.weeksCommitted);
  const view = viewById.get(pt.id);
  if (!view || view.weeks_behind !== expectBehind || Number(view.weeks_paid) !== expectPaid) {
    mismatches += 1;
    console.log(
      `MISMATCH ${pt.id}: view paid=${view?.weeks_paid} behind=${view?.weeks_behind}, app paid=${expectPaid} behind=${expectBehind}`,
    );
  }
}
console.log(
  mismatches === 0
    ? `PASS  view arithmetic matches the app's closed-window derivation for all ${cycle.participations.length} active participations (week ${cw})`
    : `FAIL  ${mismatches} mismatches`,
);

if (failures > 0 || mismatches > 0) process.exit(1);
console.log("ALL CHECKS PASSED");
await prisma.$disconnect();
