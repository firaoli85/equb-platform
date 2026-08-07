// BEHAVIOURAL VERIFICATION for the empty-draw cascade, against the LIVE
// database (2.24 — the second level: what only the database can prove).
//
//   npx tsx scripts/verify-draw-cascade.mts
//
// Everything runs on a SYNTHETIC draft cycle with synthetic people. No real
// member, week, draw or number is touched, and everything is removed at the
// end.
//
// THE BUG. Moving week 6's only winner to week 7 removed the payout and left
// the Draw. The week was then counted as drawn (so Draw.@@unique([weekId])
// refused a new one and every picker labelled it "already drawn"), held
// nothing, and could not be assigned to. Week 1 had the same shape from
// deleting the last payout, with #78 still stranded in its slot.
//
// What only the database can prove:
//   - the draw is really gone, and the week is really re-drawable
//   - numbers stranded in the emptied slot are really back in the pool
//   - a draw that still holds a payout is NOT touched
//   - a fulfilled winner plan goes back to PLANNED with the draw
//   - an emptied slot stops occupying its unique position seat
//   - a winner plan emptied by cascade is purged, not left to rig a draw

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const { PrismaPg } = await import("@prisma/adapter-pg");
const { PrismaClient } = await import("../lib/generated/prisma/client");
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL! }),
});
const { deleteDrawIfEmpty, purgeEmptyWinnerPlans } = await import("../lib/draw-cascade");
const { settleWinnerWeeks, unsettlePayout } = await import("../lib/draw-settlement");
const { calculatePayout } = await import("../lib/wheel");

const TAG = "DrawCascade Fixture";
let failures = 0;
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

async function cleanup() {
  const stale = await prisma.cycle.findMany({ where: { name: TAG }, select: { id: true } });
  for (const c of stale.map((s) => s.id)) {
    await prisma.participation.deleteMany({ where: { cycleId: c } });
    await prisma.cycle.delete({ where: { id: c } });
  }
  await prisma.person.deleteMany({ where: { nameEnglishLast: TAG } });
}
await cleanup();

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

async function makeMember(name: string, number: number) {
  const person = await prisma.person.create({
    data: { nameAmharic: name, nameEnglishFirst: name, nameEnglishLast: TAG },
  });
  const participation = await prisma.participation.create({
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
  return { person, participation, luckyNumber: participation.luckyNumbers[0] };
}

async function payoutFor(luckyNumberId: string, amount: number, drawId: string) {
  const a = calculatePayout({
    luckyNumber: { id: luckyNumberId, amount },
    participation: { weeksCommitted: 4 },
    cycle: { feePercent: 2 },
  });
  return prisma.payout.create({
    data: {
      luckyNumberId,
      drawId,
      grossAmount: a.gross,
      feeAmount: a.fee,
      netAmount: a.net,
      status: "PENDING",
    },
  });
}

const hana = await makeMember("Hana", 9101);
const abebe = await makeMember("Abebe", 9102);
const dawit = await makeMember("Dawit", 9103);
const [week1, week2, week3] = cycle.weeks;

// ————————————————— 1. THE WEEK 6 SHAPE: last winner MOVED away —————————————————

console.log("1. Week 1 holds one winner; the winner moves to week 2");

const slotA = await prisma.slot.create({
  data: {
    cycleId: cycle.id,
    position: 1,
    members: { create: [{ luckyNumberId: hana.luckyNumber.id }] },
  },
});
const drawA = await prisma.draw.create({ data: { weekId: week1.id, slotId: slotA.id } });
const hanaPayout = await payoutFor(hana.luckyNumber.id, hana.luckyNumber.amount, drawA.id);
await prisma.$transaction(async (tx) => {
  await settleWinnerWeeks(tx, drawA.id);
});

// A plan this draw fulfilled — undoing must hand the intent back (2.3).
const plan = await prisma.winnerPlan.create({
  data: {
    cycleId: cycle.id,
    weekId: week1.id,
    mode: "ALONE",
    status: "FULFILLED",
    numbers: { create: [{ luckyNumberId: hana.luckyNumber.id }] },
  },
});

const moved = await prisma.$transaction(async (tx) => {
  await unsettlePayout(tx, hanaPayout.id);
  const slotB = await tx.slot.create({ data: { cycleId: cycle.id, position: 2 } });
  const drawB = await tx.draw.create({
    data: { weekId: week2.id, slotId: slotB.id, assignedManually: true },
  });
  await tx.payout.update({
    where: { id: hanaPayout.id },
    data: { drawId: drawB.id, netAmount: hanaPayout.grossAmount - hanaPayout.feeAmount },
  });
  await tx.slotMember.deleteMany({
    where: { slotId: slotA.id, luckyNumberId: hana.luckyNumber.id },
  });
  await tx.slotMember.create({ data: { slotId: slotB.id, luckyNumberId: hana.luckyNumber.id } });
  await settleWinnerWeeks(tx, drawB.id);
  // THE CASCADE UNDER TEST.
  return deleteDrawIfEmpty(tx, drawA.id);
});

check("the cascade reports the week freed", moved.deleted && moved.weekNumber === 1);
check(
  "week 1's draw is GONE — the week is genuinely undrawn",
  (await prisma.draw.count({ where: { weekId: week1.id } })) === 0,
);
check(
  "the emptied slot was released, freeing its position seat",
  (await prisma.slot.count({ where: { id: slotA.id } })) === 0,
);
check("the cascade says the slot was released", moved.deleteSlot === true);
check(
  "the FULFILLED winner plan is PLANNED again — the intent survived",
  (await prisma.winnerPlan.findUniqueOrThrow({ where: { id: plan.id } })).status === "PLANNED",
);
check("the cascade reports the plan restored", moved.planRestored === true);

// The real proof the week is usable again: the unique index accepts a draw.
const proofSlot = await prisma.slot.create({ data: { cycleId: cycle.id, position: 50 } });
let redrawable = false;
try {
  const proof = await prisma.draw.create({ data: { weekId: week1.id, slotId: proofSlot.id } });
  redrawable = true;
  await prisma.draw.delete({ where: { id: proof.id } });
} catch {
  redrawable = false;
}
await prisma.slot.delete({ where: { id: proofSlot.id } });
check("week 1 ACCEPTS A NEW DRAW — this is what was impossible before", redrawable);

const auditMove = await prisma.auditLog.findFirst({
  where: { entity: "Draw", entityId: drawA.id, action: "delete" },
});
check("an audit entry records the automatic removal", auditMove !== null);
check(
  "the audit entry says the week is undrawn",
  (auditMove?.summary ?? "").includes("UNDRAWN"),
  auditMove?.summary,
);

// ————————————————— 2. A DRAW THAT STILL HOLDS A PAYOUT IS UNTOUCHED —————————————————

console.log("\n2. Week 3 holds two winners; one leaves");

const slotC = await prisma.slot.create({
  data: {
    cycleId: cycle.id,
    position: 3,
    members: {
      create: [{ luckyNumberId: abebe.luckyNumber.id }, { luckyNumberId: dawit.luckyNumber.id }],
    },
  },
});
const drawC = await prisma.draw.create({ data: { weekId: week3.id, slotId: slotC.id } });
const abebePayout = await payoutFor(abebe.luckyNumber.id, abebe.luckyNumber.amount, drawC.id);
await payoutFor(dawit.luckyNumber.id, dawit.luckyNumber.amount, drawC.id);
await prisma.$transaction(async (tx) => {
  await settleWinnerWeeks(tx, drawC.id);
});

const kept = await prisma.$transaction(async (tx) => {
  await unsettlePayout(tx, abebePayout.id);
  await tx.payout.delete({ where: { id: abebePayout.id } });
  await tx.slotMember.deleteMany({
    where: { slotId: slotC.id, luckyNumberId: abebe.luckyNumber.id },
  });
  return deleteDrawIfEmpty(tx, drawC.id);
});

check("the cascade leaves the draw alone", kept.deleted === false);
check(
  "week 3 is STILL drawn — Dawit is still its winner",
  (await prisma.draw.count({ where: { weekId: week3.id } })) === 1,
);
check(
  "Dawit's number is still out of the pool",
  (await prisma.slotMember.count({ where: { luckyNumberId: dawit.luckyNumber.id } })) === 1,
);
check(
  "Abebe's number returned to the pool",
  (await prisma.slotMember.count({ where: { luckyNumberId: abebe.luckyNumber.id } })) === 0,
);

// ————————————————— 3. THE WEEK 1 SHAPE: last payout DELETED, number stranded —————

console.log("\n3. Dawit's payout is deleted while his number sits in the drawn slot");

const stranded = await prisma.$transaction(async (tx) => {
  const dawitPayout = await tx.payout.findFirstOrThrow({
    where: { drawId: drawC.id, luckyNumberId: dawit.luckyNumber.id },
  });
  await unsettlePayout(tx, dawitPayout.id);
  await tx.payout.delete({ where: { id: dawitPayout.id } });
  // NOTE: the slot member is deliberately NOT removed — this is exactly what
  // "Delete payout" does, and it is how #78 was left drawn on week 1.
  return deleteDrawIfEmpty(tx, drawC.id);
});

check("the cascade reports the week freed", stranded.deleted === true);
check("it names the stranded number as returning", stranded.numbersReturning.includes(9103));
check(
  "week 3's draw is gone",
  (await prisma.draw.count({ where: { weekId: week3.id } })) === 0,
);
check(
  "the slot SURVIVES — it still holds Dawit's number",
  (await prisma.slot.count({ where: { id: slotC.id } })) === 1,
);
check("the cascade did NOT claim to release a populated slot", stranded.deleteSlot === false);

// The point of it all: with no Draw pointing at the slot, the number is back
// in the pool — drawn-ness is derived from the draw, never stored.
const drawnNow = await prisma.draw.findMany({
  where: { week: { cycleId: cycle.id } },
  include: { slot: { include: { members: { select: { luckyNumberId: true } } } } },
});
const drawnIds = new Set(drawnNow.flatMap((d) => d.slot.members.map((m) => m.luckyNumberId)));
check(
  "Dawit's number is BACK IN THE POOL — the whole point of deleting the draw",
  !drawnIds.has(dawit.luckyNumber.id),
);

// ————————————————— 4. EMPTY WINNER PLANS ARE PURGED —————————————————

console.log("\n4. A winner plan emptied by cascade never gets to rig a draw");

const doomed = await prisma.winnerPlan.create({
  data: {
    cycleId: cycle.id,
    weekId: week3.id,
    mode: "ALONE",
    status: "PLANNED",
    numbers: { create: [{ luckyNumberId: abebe.luckyNumber.id }] },
  },
});
// Deleting the lucky number cascades its WinnerPlanNumber away, leaving the
// plan PLANNED with zero numbers — the live week-11 shape.
await prisma.luckyNumber.delete({ where: { id: abebe.luckyNumber.id } });
check(
  "the plan really is left with zero numbers by the cascade",
  (await prisma.winnerPlanNumber.count({ where: { planId: doomed.id } })) === 0,
);

const purged = await prisma.$transaction((tx) => purgeEmptyWinnerPlans(tx, cycle.id));
check("the purge reports one plan removed", purged.purged === 1, String(purged.purged));
check(
  "the empty plan is GONE — it can no longer match the first eligible slot",
  (await prisma.winnerPlan.count({ where: { id: doomed.id } })) === 0,
);
check(
  "the plan restored in step 1 is NOT purged — it still has its number",
  (await prisma.winnerPlan.count({ where: { id: plan.id } })) === 1,
);
const auditPurge = await prisma.auditLog.findFirst({
  where: { entity: "WinnerPlan", entityId: doomed.id, action: "delete" },
});
check("an audit entry records why the plan went", auditPurge !== null);

// ————————————————— 5. Nothing orphaned —————————————————

console.log("\n5. Nothing orphaned");
check(
  "no draw in the fixture holds zero payouts",
  (
    await prisma.draw.findMany({
      where: { week: { cycleId: cycle.id } },
      include: { payouts: { select: { id: true } } },
    })
  ).every((d) => d.payouts.length > 0),
);
check(
  "no settlement receipt points at a deleted payout",
  (await prisma.paymentEvent.count({
    where: {
      participation: { cycleId: cycle.id },
      pinnedWeekId: { not: null },
      settlementPayoutId: null,
    },
  })) === 0,
);

// ————————————————— Cleanup —————————————————

await cleanup();
const left = await prisma.cycle.count({ where: { name: TAG } });
const peopleLeft = await prisma.person.count({ where: { nameEnglishLast: TAG } });
console.log(`\nFixtures remaining: ${left} cycle(s), ${peopleLeft} person(s)`);
console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);

await prisma.$disconnect();
process.exit(failures === 0 ? 0 : 1);
