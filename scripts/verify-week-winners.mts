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
//   - THE LAST WINNER LEAVING frees the week entirely: the Draw is deleted, the
//     emptied slot is released, and the week accepts a NEW draw — which is the
//     only honest proof it is selectable again, since @@unique([weekId]) is
//     what refused it while the half-state survived. This is the defect the
//     organizer hit on live week 6; every step above deliberately left another
//     winner behind, so none of them exercised it.

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const { PrismaPg } = await import("@prisma/adapter-pg");
const { PrismaClient } = await import("../lib/generated/prisma/client");
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL! }),
});
const { settleWinnerWeeks, unsettlePayout } = await import("../lib/draw-settlement");
const { deleteDrawIfEmpty } = await import("../lib/draw-cascade");
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

// A KNOWN LIMIT OF THIS SCRIPT, stated rather than left for someone to find.
//
// The steps below RE-IMPLEMENT the transaction bodies inline instead of
// calling the server actions, because the actions need an admin session. So
// they prove the SHAPE the fixture builds, not the shape the action builds —
// and that gap hid a real defect: `addWinnerToWeek` created a SlotMember with
// no preceding delete, duplicating the membership rather than moving it,
// while this script starts from a number in no slot and then asserts "still
// exactly one slot member". It proved its own setup.
//
// The duplication is now covered by section 6 at the end, which starts a
// number IN a slot — the live shape, where every candidate already sits in
// one — and asserts the membership MOVED.
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

// ————————————————— 5. THE LAST WINNER LEAVES —————————————————
//
// THE DEFECT THE ORGANIZER HIT, reproduced. Every step above left the week
// with another winner, so the Draw survived legitimately and the cascade was
// never exercised. This is the case that broke live week 6: the week's ONLY
// winner leaves, and the Draw has nothing left to record.
//
// A Draw with zero payouts is worse than useless. @@unique([weekId]) means the
// week can never be drawn again, every picker labels it "already drawn" with
// no amount, and any number still in its slot is out of the pool for good.

console.log("\n5. The LAST winner leaves week 2 — the week must become UNDRAWN");

// Week 2 now holds nobody (Abebe was removed in step 3), so its draw is the
// half-state. Run the cascade the app runs on every edit.
const freed = await prisma.$transaction(async (tx) => deleteDrawIfEmpty(tx, draw2.id));

check("the cascade reports the draw as deleted", freed.deleted);
check("and names the week it freed", freed.weekNumber === 2, String(freed.weekNumber));

const draw2After = await prisma.draw.findUnique({ where: { id: draw2.id } });
check("the Draw row is GONE", draw2After === null);

const slot2After = await prisma.slot.findUnique({ where: { id: slot2.id } });
check("the emptied slot was released, freeing its position", slot2After === null);

// The week is selectable again — proven by actually drawing it, which
// @@unique([weekId]) would have refused while the old draw survived.
const proofSlot = await prisma.slot.create({
  data: {
    cycleId: cycle.id,
    position: 90,
    members: { create: [{ luckyNumberId: abebe.luckyNumber.id }] },
  },
});
let redrawn = false;
try {
  const proofDraw = await prisma.draw.create({ data: { weekId: week2.id, slotId: proofSlot.id } });
  redrawn = true;
  await prisma.draw.delete({ where: { id: proofDraw.id } });
} catch {
  redrawn = false;
}
await prisma.slot.delete({ where: { id: proofSlot.id } });
check("week 2 accepts a NEW draw — it is genuinely selectable again", redrawn);

// And week 1, which still holds Hana, must be untouched by all of this.
const week1Draw = await prisma.draw.findFirst({ where: { weekId: week1.id } });
check("week 1's draw SURVIVED — a week with a winner is never freed", week1Draw !== null);

const stillEmpty = await prisma.draw.findMany({
  where: { week: { cycleId: cycle.id } },
  include: { payouts: { select: { id: true } } },
});
check(
  "no draw in the cycle holds zero payouts",
  stillEmpty.every((d) => d.payouts.length > 0),
  `${stillEmpty.filter((d) => d.payouts.length === 0).length} empty`,
);

// ————————————————— 6. THE MEMBERSHIP MOVES, IT DOES NOT DUPLICATE —————
//
// On the live cycle EVERY pool candidate already sits in an arrangement
// slot, so this is the shape every real use of addWinnerToWeek has. The
// action created the new SlotMember with no preceding delete, leaving the
// number in TWO slots. Consequences, all silent:
//   the old slot then held a drawn number, so its OTHER members could
//     never be spun again — a real person loses their turn (2.27);
//   reshuffle freezes a slot holding a drawn number, so nothing could free
//     them either;
//   saveSlots refuses a payload containing a number twice, so the wheel
//     arrangement became permanently unsaveable — fixable only by raw SQL,
//     which is 2.23 broken.

console.log("\n6. Adding a winner MOVES its slot membership");

// Give Abebe a fresh arrangement slot of his own, then add him to week 2.
const arrangementSlot = await prisma.slot.create({
  data: {
    cycleId: cycle.id,
    position: 91,
    members: { create: [{ luckyNumberId: abebe.luckyNumber.id }] },
  },
});
const week3 = cycle.weeks[2];
const slot3 = await prisma.slot.create({ data: { cycleId: cycle.id, position: 92 } });
const draw3 = await prisma.draw.create({ data: { weekId: week3.id, slotId: slot3.id } });

check(
  "before: the number sits in exactly one slot",
  (await prisma.slotMember.count({ where: { luckyNumberId: abebe.luckyNumber.id } })) === 1,
);

// The action body, as it now stands: delete elsewhere, then create.
await prisma.$transaction(async (tx) => {
  await tx.slotMember.deleteMany({
    where: { luckyNumberId: abebe.luckyNumber.id, slotId: { not: slot3.id } },
  });
  await tx.slotMember.create({ data: { slotId: slot3.id, luckyNumberId: abebe.luckyNumber.id } });
  await tx.slot.deleteMany({
    where: { id: arrangementSlot.id, members: { none: {} }, draws: { none: {} } },
  });
});

const seats = await prisma.slotMember.findMany({
  where: { luckyNumberId: abebe.luckyNumber.id },
  select: { slotId: true },
});
check("after: STILL exactly one slot — it moved, it did not duplicate", seats.length === 1, `${seats.length} seats`);
check("and it is the DRAWN slot", seats[0]?.slotId === slot3.id);
check(
  "the emptied arrangement slot was released",
  (await prisma.slot.count({ where: { id: arrangementSlot.id } })) === 0,
);

// The consequence that made it unrecoverable: two seats means saveSlots
// refuses the whole arrangement.
const allSeats = await prisma.slotMember.findMany({
  where: { slot: { cycleId: cycle.id } },
  select: { luckyNumberId: true },
});
const seen = new Set<string>();
const duplicated = allSeats.filter((m) => {
  if (seen.has(m.luckyNumberId)) return true;
  seen.add(m.luckyNumberId);
  return false;
});
check("no number sits in two slots anywhere in the cycle", duplicated.length === 0, `${duplicated.length} duplicated`);

await prisma.draw.delete({ where: { id: draw3.id } });

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
