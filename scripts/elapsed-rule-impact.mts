// READ-ONLY impact analysis for the ELAPSED-WEEKS ruling. Changes nothing.
//
// TODAY   a week is "elapsed" when its WEEK NUMBER is <= the current week,
//         and the current week is projected from cycle.startDate:
//             elapsed = weekNumber <= currentWeekNumber(cycle.startDate, today)
//         No grace period. Projected, not stored.
//
// RULING  a week is elapsed when the day IT ACTUALLY RECORDS has passed,
//         plus the payment window:
//             elapsed = today >= storedWeekDate + PAYMENT_WINDOW_DAYS
//
// It also reports where member_progress (SQL) and getMyPortal (TypeScript)
// disagree TODAY, which is the contradiction the ruling removes.

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const { PrismaPg } = await import("@prisma/adapter-pg");
const { PrismaClient } = await import("../lib/generated/prisma/client");
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL! }),
});
const { computeStanding, pinnedMapFromEvents } = await import("../lib/standing");
const { calculateFinishWeek, currentWeekNumber } = await import("../lib/money");
const { PAYMENT_WINDOW_DAYS } = await import("../lib/derived");
const { formatMoney } = await import("../lib/format");

const MS_PER_DAY = 86_400_000;
const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

const found = await prisma.cycle.findFirst({
  where: { status: "ACTIVE" },
  include: {
    weeks: { orderBy: { weekNumber: "asc" } },
    participations: {
      where: { status: "ACTIVE" },
      include: {
        person: true,
        payments: { include: { week: true } },
        paymentEvents: {
          where: { pinnedWeekId: { not: null } },
          select: { amount: true, pinnedWeek: { select: { weekNumber: true } } },
        },
      },
    },
  },
});
if (!found) throw new Error("No active cycle.");
const cycle = found;

const today = new Date();
const cycleWeek = currentWeekNumber(cycle.startDate, today);

/**
 * The RULING's test, on a week's own stored date. `cycleWeek` is passed only so
 * computeStanding's existing `weekNumber <= cycleWeek` filter can be made to
 * agree — see the two modes below.
 */
function elapsedByStoredDate(weekDate: Date): boolean {
  return Math.floor((utcDay(today) - utcDay(weekDate)) / MS_PER_DAY) >= PAYMENT_WINDOW_DAYS;
}

function standingFor(p: (typeof cycle.participations)[number], mode: "now" | "ruling") {
  const finishWeek = calculateFinishWeek(p.startWeek, p.weeksCommitted);
  const windowWeeks = cycle.weeks.filter(
    (w) => w.weekNumber >= p.startWeek && w.weekNumber <= finishWeek,
  );
  // Under the ruling, a week is elapsed by its OWN date. computeStanding still
  // filters on `weekNumber <= cycleWeek`, so the simulation feeds it an
  // EQUIVALENT cycleWeek: the highest week number whose stored date has
  // elapsed. Week rows are in ascending date order in practice, so this is the
  // same set — and the report prints both counts so any divergence is visible.
  const elapsedNumbers = windowWeeks.filter((w) => elapsedByStoredDate(w.date)).map((w) => w.weekNumber);
  const rulingCycleWeek = elapsedNumbers.length > 0 ? Math.max(...elapsedNumbers) : 0;

  return computeStanding({
    weeklyAmount: p.weeklyAmount,
    startWeek: p.startWeek,
    weeksCommitted: p.weeksCommitted,
    cycleWeek: mode === "now" ? cycleWeek : rulingCycleWeek,
    today,
    windowWeeks: windowWeeks.map((w) => {
      const payment = p.payments.find((pm) => pm.weekId === w.id) ?? null;
      return {
        weekNumber: w.weekNumber,
        date: w.date,
        amountDue: p.weeklyAmount,
        storedPaid: payment?.amountPaid ?? 0,
        isDeferred: payment?.isDeferred ?? false,
        markedLate: payment?.markedLateAt != null,
        isSkipped: w.isSkipped,
      };
    }),
    totalPaid: p.payments.reduce((s, pm) => s + pm.amountPaid, 0),
    pinnedByWeek: pinnedMapFromEvents(
      p.paymentEvents.map((e) => ({
        amount: e.amount,
        weekNumber: e.pinnedWeek?.weekNumber ?? null,
      })),
    ),
  });
}

// ————————————————— Context —————————————————

const lastElapsed = cycle.weeks.filter((w) => elapsedByStoredDate(w.date)).at(-1) ?? null;
console.log(`CYCLE: ${cycle.name} — ${cycle.participations.length} active members`);
console.log(`  cycle.startDate            ${cycle.startDate.toISOString().slice(0, 10)}`);
console.log(`  PROJECTED current week     ${cycleWeek}   (currentWeekNumber — what money uses today)`);
console.log(
  `  STORED-DATE last elapsed   ${lastElapsed?.weekNumber ?? 0}   ` +
    `(week ${lastElapsed?.weekNumber ?? 0} dated ${lastElapsed?.date.toISOString().slice(0, 10) ?? "—"}, +${PAYMENT_WINDOW_DAYS}d window closed)`,
);
console.log(`  today                      ${today.toISOString().slice(0, 10)}`);
console.log("");

// ————————————————— Before / after —————————————————

const pad = (s: string, n: number) => s.padEnd(n);
const padL = (s: string, n: number) => s.padStart(n);

const rows = cycle.participations
  .map((p) => {
    const now = standingFor(p, "now");
    const next = standingFor(p, "ruling");
    return {
      name: p.person.nameEnglishFirst,
      participationId: p.id,
      weeklyAmount: p.weeklyAmount,
      elapsedNow: now.weeksElapsedInWindow,
      elapsedNew: next.weeksElapsedInWindow,
      behindNow: now.weeksBehind,
      behindNew: next.weeksBehind,
      owedNow: now.amountOutstanding,
      owedNew: next.amountOutstanding,
      lateNow: now.weeks.filter((w) => w.status === "LATE").length,
    };
  })
  .sort(
    (a, b) =>
      Math.abs(b.owedNew - b.owedNow) - Math.abs(a.owedNew - a.owedNow) ||
      a.name.localeCompare(b.name),
  );

console.log("BEFORE / AFTER — every active member");
console.log(
  pad("MEMBER", 16) +
    padL("ELAPSED", 9) +
    padL("->", 4) +
    padL("BEHIND", 8) +
    padL("->", 4) +
    padL("OWED NOW", 12) +
    padL("OWED NEW", 12) +
    padL("CHANGE", 12) +
    padL("LATE", 6),
);
console.log("-".repeat(83));
for (const r of rows) {
  const change = r.owedNew - r.owedNow;
  console.log(
    pad(r.name, 16) +
      padL(String(r.elapsedNow), 9) +
      padL(String(r.elapsedNew), 4) +
      padL(String(r.behindNow), 8) +
      padL(String(r.behindNew), 4) +
      padL(formatMoney(r.owedNow), 12) +
      padL(formatMoney(r.owedNew), 12) +
      padL(change === 0 ? "—" : (change > 0 ? "+" : "−") + formatMoney(Math.abs(change)), 12) +
      padL(String(r.lateNow), 6),
  );
}
console.log("-".repeat(83));

const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0);
console.log(
  pad("CYCLE TOTAL", 16) +
    padL(String(sum((r) => r.elapsedNow)), 9) +
    padL(String(sum((r) => r.elapsedNew)), 4) +
    padL(String(sum((r) => r.behindNow)), 8) +
    padL(String(sum((r) => r.behindNew)), 4) +
    padL(formatMoney(sum((r) => r.owedNow)), 12) +
    padL(formatMoney(sum((r) => r.owedNew)), 12) +
    padL(
      (() => {
        const c = sum((r) => r.owedNew) - sum((r) => r.owedNow);
        return c === 0 ? "—" : (c > 0 ? "+" : "−") + formatMoney(Math.abs(c));
      })(),
      12,
    ) +
    padL(String(sum((r) => r.lateNow)), 6),
);
console.log("");

const moved = rows.filter((r) => r.behindNow !== r.behindNew || r.owedNow !== r.owedNew);
console.log(
  moved.length === 0
    ? "NOBODY MOVES — the projected clock and the stored dates agree right now."
    : `${moved.length} of ${rows.length} members move: ${moved.map((r) => r.name).join(", ")}`,
);
console.log("");

// ————————————————— SQL vs TypeScript, TODAY —————————————————
//
// member_progress filters by auth.uid(), so its arithmetic is replayed here
// verbatim rather than selected from the view (which would return no rows for
// a service connection).

const sqlRows = await prisma.$queryRawUnsafe<
  { participation_id: string; weeks_paid: number; weeks_behind: number }[]
>(`
  SELECT
    pt.id AS participation_id,
    least(floor(coalesce(paid.total, 0)::numeric / pt."weeklyAmount"), pt."weeksCommitted")::int
      AS weeks_paid,
    greatest(
      0,
      coalesce(closed.elapsed, 0)
      - coalesce(closed.excused, 0)
      - floor(coalesce(paid.total, 0)::numeric / pt."weeklyAmount")
    )::int AS weeks_behind
  FROM public.participations pt
  LEFT JOIN LATERAL (
    SELECT sum(p."amountPaid") AS total
    FROM public.payments p WHERE p."participationId" = pt.id
  ) paid ON true
  LEFT JOIN LATERAL (
    SELECT
      count(*) AS elapsed,
      count(*) FILTER (WHERE w."isSkipped") AS excused
    FROM public.weeks w
    WHERE w."cycleId" = pt."cycleId"
      AND w."weekNumber" >= pt."startWeek"
      AND w."weekNumber" <  pt."startWeek" + pt."weeksCommitted"
      AND current_date >= (w.date::date + ${PAYMENT_WINDOW_DAYS})
  ) closed ON true
  WHERE pt."cycleId" = $1 AND pt.status = 'ACTIVE'
`, cycle.id);

const sqlBehind = new Map(sqlRows.map((r) => [r.participation_id, r.weeks_behind]));

console.log("SQL vs TYPESCRIPT — who sees two different behind-counts TODAY");
console.log(
  pad("MEMBER", 16) +
    padL("member_progress", 17) +
    padL("getMyPortal", 13) +
    padL("under ruling", 14) +
    "   what the member sees",
);
console.log("-".repeat(83));
let disagree = 0;
for (const r of rows) {
  const sql = sqlBehind.get(r.participationId) ?? 0;
  if (sql === r.behindNow && sql === r.behindNew) continue;
  disagree++;
  const note =
    sql !== r.behindNow
      ? `/me/group says ${sql}, /me says ${r.behindNow}`
      : "agrees today, and after";
  console.log(
    pad(r.name, 16) + padL(String(sql), 17) + padL(String(r.behindNow), 13) + padL(String(r.behindNew), 14) + "   " + note,
  );
}
console.log("-".repeat(83));
if (disagree === 0) console.log("  No member is affected — SQL and TypeScript agree on every row.");
console.log("");

const stillDisagree = rows.filter((r) => (sqlBehind.get(r.participationId) ?? 0) !== r.behindNew);
console.log(
  stillDisagree.length === 0
    ? "AFTER THE RULING the SQL view and the TypeScript derivation agree on every member."
    : `AFTER THE RULING ${stillDisagree.length} would still disagree — the VIEW also needs its ` +
      `deferral rule updated (it still excuses personal deferrals, which the Aug 2026 ruling ` +
      `made owed again): ${stillDisagree.map((r) => `${r.name} ${sqlBehind.get(r.participationId)} vs ${r.behindNew}`).join(", ")}`,
);

await prisma.$disconnect();
