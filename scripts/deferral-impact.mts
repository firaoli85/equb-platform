// READ-ONLY verification of the deferral ruling against LIVE data. Changes
// nothing — no writes, no migrations, no fixtures.
//
// BEFORE  deferred = EXCUSED (never owed, never behind, allocation skipped it)
// AFTER   deferred = "still owed, just not chased" — the only protection left
//         is that the week never reads LATE and the member is not chased.
//
// The code now implements AFTER, so BEFORE is reproduced by feeding the old
// meaning through the new type: the old "deferred" behaved exactly like a
// SKIPPED week, so `isSkipped: personallyDeferred || week.isSkipped` replays
// it faithfully. Cycle-wide SKIPPED weeks are excused in both columns — they
// are a different decision (nobody owes a week that did not happen).
//
// It also lists ORPHANED rows: any payment or deferral sitting outside its
// member's own window. Nothing is deleted; the list is for the organizer.

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

// Read-only: connect through DIRECT_URL. (DATABASE_URL currently names the
// role `equb_app` without the pooler's tenant suffix, which the pooler
// rejects — reported separately; nothing here depends on it.)
const { PrismaPg } = await import("@prisma/adapter-pg");
const { PrismaClient } = await import("../lib/generated/prisma/client");
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL! }),
});
const { computeStanding, pinnedMapFromEvents } = await import("../lib/standing");
const { calculateFinishWeek, currentWeekNumber } = await import("../lib/money");
const { formatMoney } = await import("../lib/format");

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

function standingFor(
  p: (typeof cycle.participations)[number],
  mode: "before" | "after",
) {
  const finishWeek = calculateFinishWeek(p.startWeek, p.weeksCommitted);
  return computeStanding({
    weeklyAmount: p.weeklyAmount,
    startWeek: p.startWeek,
    weeksCommitted: p.weeksCommitted,
    cycleWeek,
    today,
    windowWeeks: cycle.weeks
      .filter((w) => w.weekNumber >= p.startWeek && w.weekNumber <= finishWeek)
      .map((w) => {
        const payment = p.payments.find((pm) => pm.weekId === w.id) ?? null;
        const personallyDeferred = payment?.isDeferred ?? false;
        return {
          weekNumber: w.weekNumber,
          date: w.date,
          amountDue: p.weeklyAmount,
          storedPaid: payment?.amountPaid ?? 0,
          // BEFORE: a personal deferral excused the money exactly like a
          // skipped week. AFTER: it only suppresses the chasing.
          isDeferred: mode === "after" ? personallyDeferred : false,
          isSkipped:
            mode === "after" ? w.isSkipped : personallyDeferred || w.isSkipped,
        };
      }),
    totalPaid: p.payments.reduce((sum, pm) => sum + pm.amountPaid, 0),
    pinnedByWeek: pinnedMapFromEvents(
      p.paymentEvents.map((e) => ({
        amount: e.amount,
        weekNumber: e.pinnedWeek?.weekNumber ?? null,
      })),
    ),
  });
}

// ————————————————— Inventory —————————————————

const deferredRows = await prisma.payment.findMany({
  where: { isDeferred: true, participation: { cycleId: cycle.id } },
  include: {
    week: { select: { weekNumber: true, isSkipped: true, date: true } },
    participation: { include: { person: true } },
  },
  orderBy: [
    { participation: { person: { nameEnglishFirst: "asc" } } },
    { week: { weekNumber: "asc" } },
  ],
});

const skippedWeeks = cycle.weeks.filter((w) => w.isSkipped);

console.log(
  `CYCLE: ${cycle.name} — week ${cycleWeek} of ${cycle.plannedWeeks}, ${cycle.participations.length} active members`,
);
console.log(`PERSONAL DEFERRALS FOUND: ${deferredRows.length}`);
console.log(
  `CYCLE-WIDE SKIPPED WEEKS: ${skippedWeeks.length}${skippedWeeks.length ? ` (weeks ${skippedWeeks.map((w) => w.weekNumber).join(", ")}) — excused in BOTH columns` : ""}`,
);
console.log("");

if (deferredRows.length > 0) {
  console.log("THE DEFERRALS:");
  for (const r of deferredRows) {
    console.log(
      `  ${r.participation.person.nameEnglishFirst.padEnd(14)} week ${String(r.week.weekNumber).padStart(2)}  ` +
        `due ${formatMoney(r.participation.weeklyAmount).padStart(8)}  paid ${formatMoney(r.amountPaid).padStart(8)}` +
        `${r.week.isSkipped ? "   [week also SKIPPED cycle-wide]" : ""}`,
    );
  }
  console.log("");
}

// ————————————————— Before / after —————————————————

const affectedIds = new Set(deferredRows.map((r) => r.participationId));
const rows: {
  name: string;
  deferrals: number;
  behindNow: number;
  behindNew: number;
  owedNow: number;
  owedNew: number;
  lateNow: number;
  lateNew: number;
}[] = [];

for (const p of cycle.participations) {
  if (!affectedIds.has(p.id)) continue;
  const now = standingFor(p, "before");
  const next = standingFor(p, "after");
  rows.push({
    name: p.person.nameEnglishFirst,
    deferrals: deferredRows.filter((r) => r.participationId === p.id).length,
    behindNow: now.weeksBehind,
    behindNew: next.weeksBehind,
    owedNow: now.amountOutstanding,
    owedNew: next.amountOutstanding,
    lateNow: now.weeks.filter((w) => w.status === "LATE").length,
    lateNew: next.weeks.filter((w) => w.status === "LATE").length,
  });
}
rows.sort(
  (a, b) => b.owedNew - b.owedNow - (a.owedNew - a.owedNow) || a.name.localeCompare(b.name),
);

const pad = (s: string, n: number) => s.padEnd(n);
const padL = (s: string, n: number) => s.padStart(n);

console.log("BEFORE / AFTER — affected members only");
console.log(
  pad("MEMBER", 15) +
    padL("DEFS", 5) +
    padL("BEHIND NOW", 12) +
    padL("BEHIND NEW", 12) +
    padL("OWED NOW", 12) +
    padL("OWED NEW", 12) +
    padL("CHANGE", 12),
);
console.log("-".repeat(80));
for (const r of rows) {
  console.log(
    pad(r.name, 15) +
      padL(String(r.deferrals), 5) +
      padL(String(r.behindNow), 12) +
      padL(String(r.behindNew), 12) +
      padL(formatMoney(r.owedNow), 12) +
      padL(formatMoney(r.owedNew), 12) +
      padL("+" + formatMoney(r.owedNew - r.owedNow), 12),
  );
}
console.log("-".repeat(80));

const totalNow = rows.reduce((s, r) => s + r.owedNow, 0);
const totalNew = rows.reduce((s, r) => s + r.owedNew, 0);
const behindNow = rows.reduce((s, r) => s + r.behindNow, 0);
const behindNew = rows.reduce((s, r) => s + r.behindNew, 0);
console.log(
  pad("AFFECTED TOTAL", 15) +
    padL(String(deferredRows.length), 5) +
    padL(String(behindNow), 12) +
    padL(String(behindNew), 12) +
    padL(formatMoney(totalNow), 12) +
    padL(formatMoney(totalNew), 12) +
    padL("+" + formatMoney(totalNew - totalNow), 12),
);

let cycleOwedNow = 0;
let cycleOwedNew = 0;
let cycleBehindNow = 0;
let cycleBehindNew = 0;
for (const p of cycle.participations) {
  const now = standingFor(p, "before");
  const next = standingFor(p, "after");
  cycleOwedNow += now.amountOutstanding;
  cycleOwedNew += next.amountOutstanding;
  cycleBehindNow += now.weeksBehind;
  cycleBehindNew += next.weeksBehind;
}
console.log("");
console.log("WHOLE CYCLE");
console.log(
  `  total outstanding:  ${formatMoney(cycleOwedNow)}  ->  ${formatMoney(cycleOwedNew)}   (+${formatMoney(cycleOwedNew - cycleOwedNow)})`,
);
console.log(
  `  total weeks behind: ${cycleBehindNow}  ->  ${cycleBehindNew}   (+${cycleBehindNew - cycleBehindNow})`,
);
console.log("");

// ————————————————— Status protection —————————————————

console.log("WHAT THE DEFERRED STATUS STILL PROTECTS (weeks that would read LATE without it)");
for (const r of rows) {
  if (r.lateNew > r.lateNow) {
    console.log(
      `  ${pad(r.name, 15)} ${r.lateNew - r.lateNow} week(s) would show LATE — the ruling keeps them DEFERRED`,
    );
  }
}
console.log("");

// ————————————————— ORPHANS: rows outside their member's window —————————————
//
// A deferral or a payment row on a week the member never committed to. These
// are invisible to every derived view (computeStanding only ever looks inside
// the window), so money on one is money the books do not see. NOTHING IS
// DELETED — this is a list for the organizer to decide on.

console.log("ORPHANED ROWS — payments or deferrals outside their member's own window");
const weekById = new Map(cycle.weeks.map((w) => [w.id, w]));
let orphanCount = 0;
let orphanMoney = 0;
for (const p of cycle.participations) {
  const finishWeek = calculateFinishWeek(p.startWeek, p.weeksCommitted);
  const orphans = p.payments
    .map((pm) => ({ pm, week: weekById.get(pm.weekId) ?? pm.week }))
    .filter(({ week }) => week.weekNumber < p.startWeek || week.weekNumber > finishWeek)
    .sort((a, b) => a.week.weekNumber - b.week.weekNumber);
  if (orphans.length === 0) continue;
  console.log(
    `  ${p.person.nameEnglishFirst} — window is weeks ${p.startWeek}–${finishWeek} ` +
      `(${p.weeksCommitted} weeks at ${formatMoney(p.weeklyAmount)} from week ${p.startWeek})`,
  );
  for (const { pm, week } of orphans) {
    orphanCount++;
    orphanMoney += pm.amountPaid;
    const flags = [
      pm.isDeferred ? "DEFERRED" : null,
      pm.amountPaid > 0 ? `${formatMoney(pm.amountPaid)} recorded` : "no money",
      week.isSkipped ? "week SKIPPED cycle-wide" : null,
    ].filter(Boolean);
    console.log(
      `      week ${String(week.weekNumber).padStart(2)}  ${flags.join(", ")}` +
        `   (${week.weekNumber < p.startWeek ? "BEFORE they joined" : "AFTER they finish"})`,
    );
  }
}
if (orphanCount === 0) console.log("  None — every payment row sits inside its member's window.");
else
  console.log(
    `\n  ${orphanCount} orphaned row(s), ${formatMoney(orphanMoney)} of money on them. ` +
      `Nothing was deleted.`,
  );
console.log("");

// ————————————————— Re-allocation check —————————————————

console.log("RE-ALLOCATION CHECK — did any member's week coverage move?");
let moves = 0;
for (const p of cycle.participations) {
  if (!affectedIds.has(p.id)) continue;
  const now = standingFor(p, "before");
  const next = standingFor(p, "after");
  const moved = now.weeks.filter((w) => {
    const m = next.weeks.find((x) => x.weekNumber === w.weekNumber);
    return m && m.coveredAtCurrentRate !== w.coveredAtCurrentRate;
  });
  if (moved.length > 0) {
    moves++;
    console.log(
      `  ${pad(p.person.nameEnglishFirst, 15)} coverage shifts on week(s) ${moved.map((w) => w.weekNumber).join(", ")}` +
        ` — their money re-spreads now that deferred weeks absorb it`,
    );
  }
}
if (moves === 0) console.log("  No coverage moved.");

await prisma.$disconnect();
