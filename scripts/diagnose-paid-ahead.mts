// READ-ONLY DIAGNOSTIC — "13 members paid ahead, $12,925, on a Tuesday".
//
//   npx tsx scripts/diagnose-paid-ahead.mts
//
// Writes NOTHING. Every query is a read; there is no create, update or delete
// in this file.
//
// The claim to test: /admin/cycle/position counts money paid for the CURRENT
// week as "paid ahead", because the current week's payment window has not
// closed yet. A WINDOW BEING OPEN and a WEEK NOT HAVING HAPPENED are different
// facts, and something is conflating them.

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const { PrismaPg } = await import("@prisma/adapter-pg");
const { PrismaClient } = await import("../lib/generated/prisma/client");
// DIRECT_URL: the pooled app role is behind RLS and reads zero rows.
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL! }),
});
const { currentWeekFromRows, elapsedThroughWeek } = await import("../lib/commitment");
const { PAYMENT_WINDOW_DAYS, weekHasElapsed } = await import("../lib/derived");
const { formatMoney, formatDateUTC } = await import("../lib/format");

const today = new Date();
const day = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][
  today.getUTCDay()
];
console.log(`\nToday: ${formatDateUTC(today)} (${day} UTC) · window = ${PAYMENT_WINDOW_DAYS} days\n`);

const cycle = await prisma.cycle.findFirst({
  where: { status: "ACTIVE" },
  include: {
    weeks: { orderBy: { weekNumber: "asc" } },
    participations: {
      include: { person: true, payments: { include: { week: true } } },
    },
  },
});
if (!cycle) {
  console.log("No active cycle.");
  process.exit(0);
}

const elapsed = elapsedThroughWeek(cycle.weeks, today);
const currentWeek = currentWeekFromRows({
  weeks: cycle.weeks,
  today,
  cycleStartDate: cycle.startDate,
});

console.log(`Cycle: ${cycle.name} — ${cycle.plannedWeeks} planned weeks`);
console.log(`  elapsedThroughWeek (window CLOSED)  = ${elapsed}`);
console.log(`  currentWeekFromRows (week ARRIVED)  = ${currentWeek}`);
console.log(
  `  THE GAP: ${currentWeek - elapsed} week(s) have ARRIVED but their window has not CLOSED.\n`,
);

// ————————————————— The classification, week by week —————————————————

console.log("Week-by-week classification around today:");
console.log(
  "  wk   date         window closes   arrived?  elapsed?   position.ts calls it",
);
for (const w of cycle.weeks) {
  if (w.weekNumber < currentWeek - 2 || w.weekNumber > currentWeek + 2) continue;
  const closes = new Date(w.date.getTime() + PAYMENT_WINDOW_DAYS * 86_400_000);
  const arrived = w.date.getTime() <= today.getTime();
  const hasElapsed = weekHasElapsed({ weekDate: w.date, today });
  // THE LINE UNDER TEST — lib/cycle-position.ts splits the series on `elapsed`
  // alone, so anything not elapsed is treated as "not yet reached".
  const calledIt = hasElapsed ? "COLLECTION (elapsed)" : "PAID AHEAD (not elapsed)";
  console.log(
    `  ${String(w.weekNumber).padStart(2)}   ${formatDateUTC(w.date)}   ${formatDateUTC(closes)}      ` +
      `${arrived ? "yes" : "no "}       ${hasElapsed ? "yes" : "no "}        ${calledIt}`,
  );
}

// ————————————————— What that classification is doing to the money —————————

const rows = cycle.participations.flatMap((p) =>
  p.payments
    .filter((pm) => pm.amountPaid > 0)
    .map((pm) => ({
      name: p.person.nameEnglishFirst,
      weekNumber: pm.week.weekNumber,
      amount: pm.amountPaid,
    })),
);

const countedAhead = rows.filter((r) => r.weekNumber > elapsed);
const genuinelyAhead = rows.filter((r) => r.weekNumber > currentWeek);
const currentWeekMoney = rows.filter((r) => r.weekNumber === currentWeek);

const sum = (xs: { amount: number }[]) => xs.reduce((s, x) => s + x.amount, 0);
const people = (xs: { name: string }[]) => new Set(xs.map((x) => x.name)).size;

console.log(`\nWhat the page reports today:`);
console.log(
  `  PAID AHEAD as computed now (weekNumber > ${elapsed}):  ` +
    `${formatMoney(sum(countedAhead))} from ${people(countedAhead)} member(s)`,
);
console.log(
  `  Of that, money for the CURRENT week ${currentWeek}:            ` +
    `${formatMoney(sum(currentWeekMoney))} from ${people(currentWeekMoney)} member(s)  ← this is ordinary current-week money`,
);
console.log(
  `  GENUINELY ahead (weekNumber > ${currentWeek}):              ` +
    `${formatMoney(sum(genuinelyAhead))} from ${people(genuinelyAhead)} member(s)`,
);

// ————————————————— Per member, as the page lists them —————————————————

console.log(`\nPer member, as "N weeks ahead" is computed today:`);
const byMember = new Map<string, { weeks: number[]; amount: number }>();
for (const r of countedAhead) {
  const e = byMember.get(r.name) ?? { weeks: [], amount: 0 };
  e.weeks.push(r.weekNumber);
  e.amount += r.amount;
  byMember.set(r.name, e);
}
for (const [name, e] of [...byMember].sort((a, b) => b[1].amount - a[1].amount)) {
  const real = e.weeks.filter((w) => w > currentWeek);
  console.log(
    `  ${name.padEnd(14)} shown as ${String(e.weeks.length).padStart(2)} week(s) ahead ` +
      `(${formatMoney(e.amount)}) · weeks ${e.weeks.sort((a, b) => a - b).join(",")} · ` +
      `TRULY ahead: ${real.length} week(s)` +
      (real.length === 0 ? "  ← ordinary current-week money" : ` (weeks ${real.join(",")})`),
  );
}

await prisma.$disconnect();
