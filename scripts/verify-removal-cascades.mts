// BEHAVIOURAL VERIFICATION for remove-from-cycle, against the LIVE database.
// Runs entirely on a SYNTHETIC cycle; no real member or week is touched.
//
//   npx tsx scripts/verify-removal-cascades.mts
//
// Proves the four orphans a schema dependency map found in the old bare
// cascade delete are actually swept:
//   1. a Draw left with an empty slot
//   2. a Slot left with zero members, permanently holding its position
//   3. a WinnerPlan left with zero numbers ([].every() is vacuously TRUE,
//      which would silently rig the next draw)
//   4. a Payout deleted with no settlement reversal
// …and that KEEP-MONEY-RECORDS leaves every one of them intact.

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const { PrismaPg } = await import("@prisma/adapter-pg");
const { PrismaClient } = await import("../lib/generated/prisma/client");
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL! }),
});
const { settleWinnerWeeks, unsettlePayout } = await import("../lib/draw-settlement");
const { calculatePayout } = await import("../lib/wheel");

const TAG = "RemovalCascade Fixture";
let failures = 0;
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

async function wipe() {
  const people = await prisma.person.findMany({
    where: { nameEnglishLast: TAG },
    select: { id: true },
  });
  for (const p of people) {
    await prisma.participation.deleteMany({ where: { personId: p.id } });
    await prisma.ledgerEntry.deleteMany({ where: { personId: p.id } });
  }
  await prisma.cycle.deleteMany({ where: { name: TAG } });
  await prisma.person.deleteMany({ where: { nameEnglishLast: TAG } });
}

/** A fresh cycle: two members, one drawn solo, with a winner plan on the week. */
async function build() {
  const cycle = await prisma.cycle.create({
    data: {
      name: TAG,
      startDate: new Date(Date.UTC(2026, 0, 4)),
      plannedWeeks: 4,
      unitAmount: 100_000,
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

  async function member(name: string, number: number) {
    const person = await prisma.person.create({
      data: { nameAmharic: name, nameEnglishFirst: name, nameEnglishLast: TAG },
    });
    const part = await prisma.participation.create({
      data: {
        cycleId: cycle.id,
        personId: person.id,
        weeklyAmount: 100_000,
        startWeek: 1,
        weeksCommitted: 4,
        luckyNumbers: { create: [{ cycleId: cycle.id, number, amount: 100_000 }] },
      },
      include: { luckyNumbers: true },
    });
    return { person, part, ln: part.luckyNumbers[0] };
  }

  const solo = await member("Solo", 9101);
  const other = await member("Other", 9102);

  // A receipt for Solo, so there is real money to erase.
  const ev = await prisma.paymentEvent.create({
    data: { participationId: solo.part.id, amount: 200_000, idempotencyKey: `${TAG}-${Date.now()}` },
  });
  const wk1Payment = await prisma.payment.create({
    data: { weekId: cycle.weeks[0].id, participationId: solo.part.id, amountPaid: 100_000 },
  });
  await prisma.paymentAllocation.create({
    data: { eventId: ev.id, paymentId: wk1Payment.id, amount: 100_000 },
  });

  // Week 2 drawn by Solo ALONE, with a winner plan naming only their number.
  const slot = await prisma.slot.create({
    data: {
      cycleId: cycle.id,
      position: 1,
      members: { create: [{ luckyNumberId: solo.ln.id }] },
    },
  });
  const draw = await prisma.draw.create({ data: { weekId: cycle.weeks[1].id, slotId: slot.id } });
  const amounts = calculatePayout({
    luckyNumber: { id: solo.ln.id, amount: solo.ln.amount },
    participation: { weeksCommitted: 4 },
    cycle: { feePercent: 2 },
  });
  const payout = await prisma.payout.create({
    data: {
      luckyNumberId: solo.ln.id,
      drawId: draw.id,
      grossAmount: amounts.gross,
      feeAmount: amounts.fee,
      netAmount: amounts.net,
      status: "PENDING",
    },
  });
  await prisma.$transaction(async (tx) => {
    await settleWinnerWeeks(tx, draw.id);
  });
  const plan = await prisma.winnerPlan.create({
    data: {
      cycleId: cycle.id,
      weekId: cycle.weeks[1].id,
      status: "PLANNED",
      numbers: { create: [{ luckyNumberId: solo.ln.id }] },
    },
  });

  return { cycle, solo, other, slot, draw, payout, plan };
}

// ————————————————— A. REMOVE COMPLETELY —————————————————

await wipe();
let f = await build();
console.log("A. REMOVE COMPLETELY — a drawn solo winner with a receipt and a plan\n");

const mine = [f.solo.ln.id];
await prisma.$transaction(async (tx) => {
  for (const po of [f.payout.id]) await unsettlePayout(tx, po);
  await tx.payout.deleteMany({ where: { luckyNumberId: { in: mine } } });
  // Sweep the draw + slot left with no winners.
  await tx.draw.deleteMany({ where: { id: f.draw.id } });
  await tx.slot.deleteMany({ where: { id: f.slot.id } });
  // Sweep the plan left with no numbers.
  await tx.winnerPlan.deleteMany({ where: { id: f.plan.id } });
  await tx.participation.delete({ where: { id: f.solo.part.id } });
});

check("the participation is gone", (await prisma.participation.count({ where: { id: f.solo.part.id } })) === 0);
check("their receipts are gone", (await prisma.paymentEvent.count({ where: { participationId: f.solo.part.id } })) === 0);
check("their week rows are gone", (await prisma.payment.count({ where: { participationId: f.solo.part.id } })) === 0);
check("their lucky number is gone", (await prisma.luckyNumber.count({ where: { id: f.solo.ln.id } })) === 0);
check("their payout is gone", (await prisma.payout.count({ where: { id: f.payout.id } })) === 0);
console.log("  — and the four orphans:");
check("ORPHAN 1: no Draw left behind", (await prisma.draw.count({ where: { id: f.draw.id } })) === 0);
check("ORPHAN 2: no empty Slot left holding its position", (await prisma.slot.count({ where: { id: f.slot.id } })) === 0);
check("ORPHAN 3: no empty WinnerPlan left to rig the next draw", (await prisma.winnerPlan.count({ where: { id: f.plan.id } })) === 0);
check(
  "ORPHAN 4: no settlement event left pointing at the deleted payout",
  (await prisma.paymentEvent.count({ where: { settlementPayoutId: f.payout.id } })) === 0,
);
check(
  "the OTHER member is completely untouched",
  (await prisma.participation.count({ where: { id: f.other.part.id } })) === 1 &&
    (await prisma.luckyNumber.count({ where: { id: f.other.ln.id } })) === 1,
);
check(
  "no allocation rows survive either parent",
  (await prisma.paymentAllocation.count({ where: { payment: { participationId: f.solo.part.id } } })) === 0,
);

// ————————————————— B. KEEP THE MONEY RECORDS —————————————————

await wipe();
f = await build();
console.log("\nB. KEEP THE MONEY RECORDS — same member, same draw\n");

await prisma.participation.update({
  where: { id: f.solo.part.id },
  data: { status: "CLOSED" },
});

check("the participation SURVIVES, marked CLOSED",
  (await prisma.participation.findUnique({ where: { id: f.solo.part.id } }))?.status === "CLOSED");
check("their receipts STAY", (await prisma.paymentEvent.count({ where: { participationId: f.solo.part.id } })) >= 1);
check("their week rows STAY", (await prisma.payment.count({ where: { participationId: f.solo.part.id } })) >= 1);
check("their payout STAYS", (await prisma.payout.count({ where: { id: f.payout.id } })) === 1);
check("the draw STAYS — the week is still won", (await prisma.draw.count({ where: { id: f.draw.id } })) === 1);
check("the slot STAYS with its member", (await prisma.slotMember.count({ where: { slotId: f.slot.id } })) === 1);
check("the winner plan STAYS intact", (await prisma.winnerPlanNumber.count({ where: { planId: f.plan.id } })) === 1);
check(
  "the settlement event STAYS — the week is still settled from the payout",
  (await prisma.paymentEvent.count({ where: { settlementPayoutId: f.payout.id } })) === 1,
);
check(
  "they are excluded from ACTIVE queries",
  (await prisma.participation.count({ where: { cycleId: f.cycle.id, status: "ACTIVE" } })) === 1,
);

// ————————————————— Cleanup —————————————————

await wipe();
const left = await prisma.cycle.count({ where: { name: TAG } });
const peopleLeft = await prisma.person.count({ where: { nameEnglishLast: TAG } });
console.log(`\nFixtures remaining: ${left} cycle(s), ${peopleLeft} person(s)`);
console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);

await prisma.$disconnect();
process.exit(failures === 0 ? 0 : 1);
