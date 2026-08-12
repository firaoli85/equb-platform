// BEHAVIOURAL VERIFICATION for the cycle position, against the LIVE database.
//
//   npx tsx scripts/verify-cycle-position.mts
//
// Runs on the production-shaped fixture (27 members, numbers sequential from
// 1, four double-contributors, real draws, real settlements, mixed
// COLLECTED/PENDING, a member who stopped paying, a late joiner) — the shape
// the arithmetic actually has to survive.
//
// What only the database can prove:
//   - PAID AHEAD is really detected: money on weeks whose window has NOT
//     closed, and NOT counted as collection
//   - should-vs-actual matches what the rows say
//   - the expected holding agrees with the dashboard's own cash position
//   - a reading round-trips and the verdict changes with it

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const { PrismaPg } = await import("@prisma/adapter-pg");
const { PrismaClient } = await import("../lib/generated/prisma/client");
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL! }),
});
const fixture = await import("./lib/production-fixture.mts");
const { elapsedThroughWeek } = await import("../lib/commitment");
const { cashPosition, receiptsByWeek } = await import("../lib/dashboard");
const { cashOnHand, collectionPosition, feeEstimate, positionVerdict } = await import(
  "../lib/cycle-position"
);
const { formatMoney } = await import("../lib/format");

let failures = 0;
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

await fixture.wipe(prisma);
const f = await fixture.build(prisma);

const cycle = await prisma.cycle.findUniqueOrThrow({
  where: { id: f.cycleId },
  include: {
    weeks: { orderBy: { weekNumber: "asc" } },
    participations: { include: { payments: { include: { week: true } } } },
  },
});
const payouts = await prisma.payout.findMany({
  where: { luckyNumber: { cycleId: f.cycleId } },
  select: { netAmount: true, feeAmount: true, status: true },
});

// The fixture's weeks are dated from 17 May 2026; "today" is chosen so weeks
// 1..7 have elapsed and 8..20 have not — the same shape the live cycle is in.
const today = new Date(Date.UTC(2026, 6, 8)); // 8 July 2026
const elapsed = elapsedThroughWeek(cycle.weeks, today);
check("the fixture puts the boundary mid-cycle", elapsed >= 5 && elapsed < 20, `week ${elapsed}`);

const flatPayments = cycle.participations.flatMap((p) =>
  p.payments.map((pm) => ({
    participationId: p.id,
    weekNumber: pm.week.weekNumber,
    amountPaid: pm.amountPaid,
    isDeferred: pm.isDeferred,
    markedLate: pm.markedLateAt != null,
    isSkipped: pm.week.isSkipped,
  })),
);
const series = receiptsByWeek({
  weeks: cycle.weeks.map((w) => ({ weekNumber: w.weekNumber, isSkipped: w.isSkipped })),
  participations: cycle.participations.filter((p) => p.status === "ACTIVE"),
  payments: flatPayments,
  elapsedThroughWeek: elapsed,
});

// ————————————————— 1. PAID AHEAD IS DETECTED —————————————————

console.log("\n1. Paid ahead — money on weeks that have not elapsed");

const before = collectionPosition({ series, owedBy: [], aheadBy: [] });
check("nobody has paid ahead in the base fixture", before.paidAhead === 0, formatMoney(before.paidAhead));

// A member pays two weeks early — the exact thing that made a healthy-looking
// balance misleading.
const earlyBird = f.members[6];
const futureWeeks = cycle.weeks.filter((w) => w.weekNumber > elapsed).slice(0, 2);
for (const w of futureWeeks) {
  await prisma.payment.create({
    data: {
      participationId: earlyBird.participationId,
      weekId: w.id,
      amountPaid: earlyBird.weeklyAmount,
    },
  });
}

const after = await (async () => {
  const reloaded = await prisma.participation.findMany({
    where: { cycleId: f.cycleId },
    include: { payments: { include: { week: true } } },
  });
  const flat = reloaded.flatMap((p) =>
    p.payments.map((pm) => ({
      participationId: p.id,
      weekNumber: pm.week.weekNumber,
      amountPaid: pm.amountPaid,
      isDeferred: pm.isDeferred,
      markedLate: pm.markedLateAt != null,
      isSkipped: pm.week.isSkipped,
    })),
  );
  const s = receiptsByWeek({
    weeks: cycle.weeks.map((w) => ({ weekNumber: w.weekNumber, isSkipped: w.isSkipped })),
    participations: cycle.participations.filter((p) => p.status === "ACTIVE"),
    payments: flat,
    elapsedThroughWeek: elapsed,
  });
  return { position: collectionPosition({ series: s, owedBy: [], aheadBy: [] }), flat };
})();

check(
  "the early payment IS detected as paid ahead",
  after.position.paidAhead === earlyBird.weeklyAmount * 2,
  formatMoney(after.position.paidAhead),
);
check(
  "and it is NOT counted as this cycle's collection",
  after.position.collected === before.collected,
  `${formatMoney(before.collected)} -> ${formatMoney(after.position.collected)}`,
);
check(
  "the elapsed expectation did not move either",
  after.position.shouldHaveCollected === before.shouldHaveCollected,
);

// ————————————————— 2. SHOULD VS ACTUAL MATCHES THE ROWS —————————————————

console.log("\n2. Should-vs-actual against the rows themselves");

const elapsedRows = after.flat.filter((p) => p.weekNumber <= elapsed);
const collectedFromRows = elapsedRows.reduce((s, p) => s + p.amountPaid, 0);
check(
  "collected equals the sum of receipts on elapsed weeks",
  after.position.collected === collectedFromRows,
  `${formatMoney(after.position.collected)} vs ${formatMoney(collectedFromRows)}`,
);
check(
  "a shortfall exists (member 3 stopped paying, member 8 paid short)",
  after.position.shortfall > 0,
  formatMoney(after.position.shortfall),
);

// ————————————————— 3. AGREEMENT WITH THE DASHBOARD —————————————————

console.log("\n3. Agreement with the dashboard's cash position");

const cash = cashPosition({
  payments: after.flat.map((p) => ({ amountPaid: p.amountPaid })),
  payouts: payouts.map((p) => ({ netAmount: p.netAmount, status: p.status })),
});
const holding = cashOnHand({
  collected: cash.totalReceived,
  handedOut: cash.totalPaidOut,
  drawnNotHandedOut: cash.committedPending,
  paidEarly: after.position.paidAhead,
});
const fee = feeEstimate({
  onHandedOut: payouts.filter((p) => p.status === "COLLECTED").reduce((s, p) => s + p.feeAmount, 0),
  onDrawn: payouts.filter((p) => p.status === "PENDING").reduce((s, p) => s + p.feeAmount, 0),
});
check(
  "what he should be holding IS the dashboard's currentlyHeld",
  holding.shouldBeHolding === cash.currentlyHeld,
);
check(
  "the fixture really has both COLLECTED and PENDING payouts (so the distinction matters)",
  payouts.some((p) => p.status === "COLLECTED") && payouts.some((p) => p.status === "PENDING"),
);
check(
  "a real payout is drawn but not handed out",
  holding.drawnNotHandedOut > 0,
  formatMoney(holding.drawnNotHandedOut),
);

// THE ARITHMETIC THE ORGANIZER CHECKS BY HAND. Money in, money out, what is
// left — against LIVE ROWS, not a hand-built object.
const handedOverFromRows = payouts
  .filter((p) => p.status === "COLLECTED")
  .reduce((s, p) => s + p.netAmount, 0);
check(
  "money handed out counts only payouts actually COLLECTED",
  holding.handedOut === handedOverFromRows,
  `${formatMoney(holding.handedOut)} vs ${formatMoney(handedOverFromRows)}`,
);
check(
  "money in minus money out IS what he should be holding",
  holding.shouldBeHolding === holding.collected - holding.handedOut,
);
check(
  "the drawn-but-not-handed-out payout is NOT subtracted — the cash is still his to hold",
  holding.shouldBeHolding ===
    cashOnHand({ ...holding, drawnNotHandedOut: 0 }).shouldBeHolding,
);
check("a real fee has accumulated", fee.soFar > 0, formatMoney(fee.soFar));
check(
  "and the fee is NOT part of what he should be holding",
  holding.shouldBeHolding !== holding.collected - holding.handedOut - fee.soFar,
);

// ————————————————— 4. THE VERDICT MOVES WITH THE READING —————————————————

console.log("\n4. The verdict, against a real reading");

const short = positionVerdict({ cash: holding, actual: 0, formatMoney });
check("holding nothing reads as SHORT", short.kind === "short");
check(
  "and says what he would need",
  short.shortBy > 0 && short.sentence.includes("before the next payout"),
);

const exact = positionVerdict({ cash: holding, actual: holding.shouldBeHolding, formatMoney });
check("holding exactly that figure reads as EXACT", exact.kind === "exact");
check(
  "and says how much of it belongs to other people",
  exact.sentence.includes(formatMoney(holding.paidEarly + holding.drawnNotHandedOut)),
);

const surplus = positionVerdict({
  cash: holding,
  actual: holding.shouldBeHolding + 230_000,
  formatMoney,
});
check("holding more reads as SURPLUS", surplus.kind === "surplus");
check("and says $2,300 MORE", surplus.sentence.includes("$2,300 MORE"));

// PLAIN ENGLISH, against the live figures — not only in the unit test.
const banned = /\b(uncommitted|committed|owed forward|claimed|free|net|reconcil\w*)\b/i;
for (const [label, v] of [
  ["short", short],
  ["exact", exact],
  ["surplus", surplus],
] as const) {
  check(`the ${label} verdict uses no accounting words`, !banned.test(v.sentence), v.sentence);
  check(`the ${label} verdict never mentions the fee`, !/fee/i.test(v.sentence));
}

// A reading round-trips through the one stored fact.
const reading = await prisma.cashReading.create({
  data: {
    cycleId: f.cycleId,
    totalAmount: holding.shouldBeHolding,
    readAt: today,
    note: `${fixture.FIXTURE_TAG} reading`,
  },
});
const readBack = await prisma.cashReading.findUniqueOrThrow({ where: { id: reading.id } });
check("the reading round-trips", readBack.totalAmount === holding.shouldBeHolding);
check("and carries its own date", readBack.readAt.toISOString().slice(0, 10) === "2026-07-08");
await prisma.cashReading.delete({ where: { id: reading.id } });
check(
  "and can be removed again (2.23)",
  (await prisma.cashReading.count({ where: { id: reading.id } })) === 0,
);

// ————————————————— 5. PAGING THE HISTORY MUST NOT MOVE THE VERDICT —————————

console.log("\n5. The verdict compares against the NEWEST reading, on any page");

// Enough readings to force a second page, each a different figure and date.
const PAGE_SIZE = 25;
const made: { readAt: Date; total: number }[] = [];
for (let i = 0; i < PAGE_SIZE + 8; i += 1) {
  made.push({
    readAt: new Date(Date.UTC(2026, 0, 1 + i)),
    total: 1_000_00 + i * 1_000,
  });
}
await prisma.cashReading.createMany({
  data: made.map((m) => ({
    cycleId: f.cycleId,
    totalAmount: m.total,
    readAt: m.readAt,
    note: fixture.FIXTURE_TAG,
  })),
});

const newest = made.reduce((a, b) => (b.readAt > a.readAt ? b : a));
const total = await prisma.cashReading.count({ where: { cycleId: f.cycleId } });
check("there are enough readings for two pages", total > PAGE_SIZE, `${total}`);

// Page 1 — the newest is simply the first row.
const page1 = await prisma.cashReading.findMany({
  where: { cycleId: f.cycleId },
  orderBy: { readAt: "desc" },
  skip: 0,
  take: PAGE_SIZE,
});
check("page 1's first row IS the newest reading", page1[0].totalAmount === newest.total);

// PAGE 2 — the failing path. A naive `readings[0]` here is the newest row on
// THIS PAGE, which is 25 readings old, so the whole verdict would silently
// describe a stale figure the moment the organizer clicked "next".
const page2 = await prisma.cashReading.findMany({
  where: { cycleId: f.cycleId },
  orderBy: { readAt: "desc" },
  skip: PAGE_SIZE,
  take: PAGE_SIZE,
});
check("page 2 has rows", page2.length > 0, `${page2.length}`);
check(
  "page 2's first row is NOT the newest — the hazard is real, not hypothetical",
  page2[0].totalAmount !== newest.total,
);

// What the action does instead: ask the database for the newest, always.
const latestOverall = await prisma.cashReading.findFirst({
  where: { cycleId: f.cycleId },
  orderBy: { readAt: "desc" },
});
check(
  "the newest reading is found regardless of the page being read",
  latestOverall?.totalAmount === newest.total,
  `${latestOverall?.totalAmount} vs ${newest.total}`,
);

const onPage1 = positionVerdict({ cash: holding, actual: page1[0].totalAmount, formatMoney });
const onPage2 = positionVerdict({ cash: holding, actual: latestOverall!.totalAmount, formatMoney });
check(
  "so the verdict reads the same on page 1 and page 2",
  onPage1.sentence === onPage2.sentence,
);

// ————————————————— Cleanup —————————————————

await prisma.cashReading.deleteMany({ where: { cycleId: f.cycleId } });
await fixture.wipe(prisma);
const left = await fixture.assertClean(prisma);
console.log(`\nFixtures remaining: ${left}`);
if (left !== 0) failures += 1;
console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);

await prisma.$disconnect();
process.exit(failures === 0 ? 0 : 1);
