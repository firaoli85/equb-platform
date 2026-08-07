// BEHAVIOURAL VERIFICATION for the week-winners build, against the LIVE
// database (2.24). Everything runs against a SYNTHETIC person on a SYNTHETIC
// draw; no real member and no real week is touched, and everything is removed
// at the end.
//
//   npx tsx scripts/verify-week-winners.mts
//
// What only the database can prove:
//   - adding a winner takes the number OUT of the pool (SlotMember created)
//     and settles their week from the payout
//   - removing ONE winner returns ONLY that number and leaves the others
//   - moving a payout carries its settlement: old week owed again, new settled
//   - nothing is orphaned afterwards

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const { PrismaPg } = await import("@prisma/adapter-pg");
const { PrismaClient } = await import("../lib/generated/prisma/client");
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL! }),
});
const { settleWinnerWeeks, unsettlePayout } = await import("../lib/draw-settlement");
const { calculatePayout } = await import("../lib/wheel");
const { formatMoney } = await import("../lib/format");

const TAG = "WinnerEdit Fixture";
let failures = 0;
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

// ————————————————— Setup: a synthetic cycle of our own —————————————————
//
// A separate DRAFT cycle, so no real week, draw, slot or number is involved.

await prisma.cycle.deleteMany({ where: { name: TAG } });
await prisma.person.deleteMany({ where: { nameEnglishLast: TAG } });

const cycle = await prisma.cycle.create({
  data: {
    name: TAG,
    startDate: new Date(Date.UTC(2026, 0, 4)),
    plannedWeeks: 4,
    unitAmount: 100_000, // $1,000
    feePercent: 2,
    status: "DRAFT",
    weeks: {
      create: [0, 1, 2, 3].map((i) => ({
        weekNumber: i + 1,
        date: new Date(Date.UTC(2026, 0, 4 + i * 7)),
      })),
    },
  },
  include: { weeks: { orderBy: { weekNumber: "asc" } } },
});

async function makeMember(name: string, number: number) {
  const person = await prisma.person.create({
    data: { nameAmharic: name, nameEnglishFirst: name, nameEnglishLast: TAG },
  });
  const participation = await prisma.participation.create({
    data: {
      cycleId: cycle.id,
      personId: person.id,
      weeklyAmount: 100_000, // $1,000/wk
      startWeek: 1,
      weeksCommitted: 4,
      luckyNumbers: { create: [{ cycleId: cycle.id, number, amount: 100_000 }] },
    },
    include: { luckyNumbers: true },
  });
  return { person, participation, luckyNumber: participation.luckyNumbers[0] };
}

const hana = await makeMember("Hana", 9001);
const abebe = await makeMember("Abebe", 9002);

const week1 = cycle.weeks[0];
const week2 = cycle.weeks[1];

// Week 1 drawn with Hana alone — the shape of the real defect.
const slot1 = await prisma.slot.create({
  data: {
    cycleId: cycle.id,
    position: 1,
    members: { create: [{ luckyNumberId: hana.luckyNumber.id }] },
  },
});
const slot2 = await prisma.slot.create({ data: { cycleId: cycle.id, position: 2 } });

const draw1 = await prisma.draw.create({ data: { weekId: week1.id, slotId: slot1.id } });
const draw2 = await prisma.draw.create({ data: { weekId: week2.id, slotId: slot2.id } });

const hanaAmounts = calculatePayout({
  luckyNumber: { id: hana.luckyNumber.id, amount: hana.luckyNumber.amount },
  participation: { weeksCommitted: 4 },
  cycle: { feePercent: 2 },
});
await prisma.payout.create({
  data: {
    luckyNumberId: hana.luckyNumber.id,
    drawId: draw1.id,
    grossAmount: hanaAmounts.gross,
    feeAmount: hanaAmounts.fee,
    netAmount: hanaAmounts.net,
    status: "PENDING",
  },
});
await prisma.$transaction(async (tx) => {
  await settleWinnerWeeks(tx, draw1.id);
});

console.log(`Synthetic cycle ${cycle.id}: week 1 drawn with #9001 (Hana) alone\n`);

// ————————————————— 1. ADD A WINNER —————————————————

console.log("1. Add Abebe (#9002) to week 1 — Hana's missing partner");

await prisma.$transaction(async (tx) => {
  await tx.slotMember.create({ data: { slotId: slot1.id, luckyNumberId: abebe.luckyNumber.id } });
  const a = calculatePayout({
    luckyNumber: { id: abebe.luckyNumber.id, amount: abebe.luckyNumber.amount },
    participation: { weeksCommitted: 4 },
    cycle: { feePercent: 2 },
  });
  await tx.payout.create({
    data: {
      luckyNumberId: abebe.luckyNumber.id,
      drawId: draw1.id,
      grossAmount: a.gross,
      feeAmount: a.fee,
      netAmount: a.net,
      status: "PENDING",
    },
  });
  await settleWinnerWeeks(tx, draw1.id);
});

const afterAdd = await prisma.payout.findMany({
  where: { drawId: draw1.id },
  include: { luckyNumber: true },
  orderBy: { luckyNumber: { number: "asc" } },
});
check("the week now holds TWO payouts", afterAdd.length === 2, `${afterAdd.length}`);

// $1,000 × 4 = $4,000 gross, 2% = $80 fee, $3,920 net, less his own $1,000
// week-1 contribution = $2,920.
const abebePayout = afterAdd.find((p) => p.luckyNumber.number === 9002)!;
check(
  "his payout is gross − fee − his own week",
  abebePayout.netAmount === 292_000,
  formatMoney(abebePayout.netAmount),
);

const slotNow = await prisma.slotMember.findMany({ where: { slotId: slot1.id } });
check("his number LEFT the pool (a slot member exists)", slotNow.length === 2);

const abebeWeek1 = await prisma.payment.findUnique({
  where: {
    weekId_participationId: { weekId: week1.id, participationId: abebe.participation.id },
  },
});
check(
  "his week-1 contribution settled from the payout",
  (abebeWeek1?.amountPaid ?? 0) === 100_000,
  formatMoney(abebeWeek1?.amountPaid ?? 0),
);

// ————————————————— 2. MOVE A PAYOUT —————————————————

console.log("\n2. Move Abebe to week 2 — the settlement follows him");

await prisma.$transaction(async (tx) => {
  const { reversed } = await unsettlePayout(tx, abebePayout.id);
  check("week 1's contribution was given back", reversed === 100_000, formatMoney(reversed));
  await tx.payout.update({
    where: { id: abebePayout.id },
    data: { drawId: draw2.id, netAmount: abebePayout.grossAmount - abebePayout.feeAmount },
  });
  await tx.slotMember.deleteMany({
    where: { slotId: slot1.id, luckyNumberId: abebe.luckyNumber.id },
  });
  await tx.slotMember.create({ data: { slotId: slot2.id, luckyNumberId: abebe.luckyNumber.id } });
  await settleWinnerWeeks(tx, draw2.id);
});

const week1Paid = await prisma.payment.findUnique({
  where: {
    weekId_participationId: { weekId: week1.id, participationId: abebe.participation.id },
  },
});
const week2Paid = await prisma.payment.findUnique({
  where: {
    weekId_participationId: { weekId: week2.id, participationId: abebe.participation.id },
  },
});
check("week 1 is OWED AGAIN", (week1Paid?.amountPaid ?? 0) === 0, formatMoney(week1Paid?.amountPaid ?? 0));
check("week 2 is now SETTLED", (week2Paid?.amountPaid ?? 0) === 100_000, formatMoney(week2Paid?.amountPaid ?? 0));
check(
  "the number stayed drawn throughout (still exactly one slot member)",
  (await prisma.slotMember.count({ where: { luckyNumberId: abebe.luckyNumber.id } })) === 1,
);
check(
  "week 1 is back to Hana alone",
  (await prisma.payout.count({ where: { drawId: draw1.id } })) === 1,
);

// ————————————————— 3. REMOVE ONE WINNER —————————————————

console.log("\n3. Remove Abebe from week 2 — his number RETURNS to the wheel");

await prisma.$transaction(async (tx) => {
  const { reversed } = await unsettlePayout(tx, abebePayout.id);
  check("week 2's contribution is owed again", reversed === 100_000, formatMoney(reversed));
  await tx.payout.delete({ where: { id: abebePayout.id } });
  await tx.slotMember.deleteMany({
    where: { slotId: slot2.id, luckyNumberId: abebe.luckyNumber.id },
  });
});

check(
  "his number RETURNED to the pool (no slot member anywhere)",
  (await prisma.slotMember.count({ where: { luckyNumberId: abebe.luckyNumber.id } })) === 0,
);
check(
  "Hana's number is STILL drawn — the other winner is untouched",
  (await prisma.slotMember.count({ where: { luckyNumberId: hana.luckyNumber.id } })) === 1,
);
check(
  "Hana's payout survived every edit",
  (await prisma.payout.count({ where: { drawId: draw1.id } })) === 1,
);
const hanaWeek1 = await prisma.payment.findUnique({
  where: { weekId_participationId: { weekId: week1.id, participationId: hana.participation.id } },
});
check(
  "Hana's own week is still settled",
  (hanaWeek1?.amountPaid ?? 0) === 100_000,
  formatMoney(hanaWeek1?.amountPaid ?? 0),
);

// ————————————————— 4. No orphans —————————————————

console.log("\n4. Nothing orphaned");
const orphanEvents = await prisma.paymentEvent.count({
  where: { settlementPayoutId: abebePayout.id },
});
check("no settlement events left pointing at the deleted payout", orphanEvents === 0);

// ————————————————— Cleanup —————————————————

await prisma.participation.deleteMany({ where: { cycleId: cycle.id } });
await prisma.cycle.delete({ where: { id: cycle.id } });
await prisma.person.deleteMany({ where: { nameEnglishLast: TAG } });

const left = await prisma.cycle.count({ where: { name: TAG } });
const peopleLeft = await prisma.person.count({ where: { nameEnglishLast: TAG } });
console.log(`\nFixtures remaining: ${left} cycle(s), ${peopleLeft} person(s)`);
console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);

await prisma.$disconnect();
process.exit(failures === 0 ? 0 : 1);
