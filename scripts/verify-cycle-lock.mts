// BEHAVIOURAL VERIFICATION for the CLOSED-cycle lock, against the LIVE
// database. Runs entirely on a SYNTHETIC cycle; no real member or week is
// touched, and the fixture is removed at the end whether it passes or fails.
//
//   npx tsx scripts/verify-cycle-lock.mts
//
// WHAT THIS PROVES THAT THE UNIT TESTS CANNOT.
//
// lib/cycle-lock.test.ts scans the SOURCE and fails when a cycle-mutating
// action ships without the check. That is a tripwire for the omission, not
// proof the check works: refuseIfCycleClosed resolves the cycle through a
// chain of relations, and a wrong hop returns null — at which point it
// silently allows the write it was added to refuse. Fourteen actions now
// depend on that resolution, so every entry point gets exercised here against
// real rows.
//
// It also proves the two halves agree: an ACTIVE cycle must be left alone.

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const { PrismaPg } = await import("@prisma/adapter-pg");
const { PrismaClient } = await import("../lib/generated/prisma/client");
// The app role is behind RLS and sees zero rows — scripts use DIRECT_URL.
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL! }),
});
const { refuseIfCycleClosed } = await import("../lib/cycle-guard");

const TAG = "CycleLock Fixture";
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
  await prisma.cycle.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.person.deleteMany({ where: { nameEnglishLast: TAG } });
}

/**
 * A cycle with one row of EVERY cycle-scoped kind the guard can be handed —
 * so each resolution path is exercised against real foreign keys.
 */
async function build(name: string, status: "OPEN" | "CLOSED") {
  const cycle = await prisma.cycle.create({
    data: {
      name,
      startDate: new Date(Date.UTC(2026, 0, 4)),
      plannedWeeks: 2,
      unitAmount: 100_000,
      feePercent: 2,
      // DRAFT, not ACTIVE: a partial unique index (one_active_cycle) permits
      // exactly one ACTIVE cycle and the organizer's real one holds it. DRAFT
      // and ACTIVE are the same thing to this guard — neither is frozen — so
      // the OPEN half of the proof is unaffected.
      status: "DRAFT",
      weeks: {
        create: [0, 1].map((i) => ({
          weekNumber: i + 1,
          date: new Date(Date.UTC(2026, 0, 4 + i * 7)),
        })),
      },
    },
    include: { weeks: { orderBy: { weekNumber: "asc" } } },
  });

  const person = await prisma.person.create({
    data: { nameAmharic: "ሙከራ", nameEnglishFirst: "Lock", nameEnglishLast: TAG },
  });

  const participation = await prisma.participation.create({
    data: {
      cycleId: cycle.id,
      personId: person.id,
      weeklyAmount: 100_000,
      startWeek: 1,
      weeksCommitted: 2,
    },
  });

  const luckyNumber = await prisma.luckyNumber.create({
    data: { cycleId: cycle.id, participationId: participation.id, number: 901, amount: 100_000 },
  });

  const slot = await prisma.slot.create({
    data: {
      cycleId: cycle.id,
      position: 1,
      members: { create: [{ luckyNumberId: luckyNumber.id }] },
    },
  });

  const draw = await prisma.draw.create({
    data: { weekId: cycle.weeks[0].id, slotId: slot.id },
  });

  const payout = await prisma.payout.create({
    data: {
      luckyNumberId: luckyNumber.id,
      drawId: draw.id,
      grossAmount: 200_000,
      feeAmount: 4_000,
      netAmount: 196_000,
      status: "PENDING",
    },
  });

  const winnerPlan = await prisma.winnerPlan.create({
    data: {
      cycleId: cycle.id,
      weekId: cycle.weeks[1].id,
      numbers: { create: [{ luckyNumberId: luckyNumber.id }] },
    },
  });

  const payment = await prisma.payment.create({
    data: { participationId: participation.id, weekId: cycle.weeks[0].id, amountPaid: 0 },
  });

  const paymentEvent = await prisma.paymentEvent.create({
    data: {
      participationId: participation.id,
      amount: 100_000,
      idempotencyKey: `${TAG}:${cycle.id}:1`,
    },
  });

  if (status === "CLOSED") {
    await prisma.cycle.update({ where: { id: cycle.id }, data: { status: "CLOSED", closedAt: new Date() } });
  }

  return {
    cycleId: cycle.id,
    weekId: cycle.weeks[0].id,
    participationId: participation.id,
    luckyNumberId: luckyNumber.id,
    payoutId: payout.id,
    drawId: draw.id,
    slotId: slot.id,
    winnerPlanId: winnerPlan.id,
    paymentId: payment.id,
    paymentEventId: paymentEvent.id,
  };
}

/** Does the guard refuse, given this one reference? */
async function refuses(ref: Record<string, string>): Promise<string | null> {
  try {
    await prisma.$transaction(async (tx) => {
      await refuseIfCycleClosed(tx, ref);
    });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

async function main() {
  await wipe();
  console.log("\nCLOSED cycle — every reference must resolve and refuse\n");
  const closed = await build(`${TAG} closed`, "CLOSED");

  for (const [key, id] of Object.entries(closed)) {
    const message = await refuses({ [key]: id });
    check(
      `${key} refuses`,
      message !== null && message.includes("closed"),
      message === null ? "the guard ALLOWED the write" : `unexpected message: ${message}`,
    );
  }

  // The refusal has to be readable years later, not a code.
  const sample = await refuses({ cycleId: closed.cycleId });
  check(
    "the refusal names the cycle and points somewhere useful",
    sample !== null && sample.includes(`${TAG} closed`) && sample.includes("member's page"),
    sample ?? "no refusal",
  );

  console.log("\nOPEN cycle — the same references must all be ALLOWED\n");
  const active = await build(`${TAG} open`, "OPEN");
  for (const [key, id] of Object.entries(active)) {
    const message = await refuses({ [key]: id });
    check(`${key} allows`, message === null, message ?? undefined);
  }

  console.log("\nA reference to nothing is left to the action's own error\n");
  const missing = await refuses({ payoutId: "does-not-exist" });
  check("an unknown id does not throw from the guard", missing === null, missing ?? undefined);
}

try {
  await main();
} finally {
  await wipe();
  await prisma.$disconnect();
}

console.log(failures === 0 ? "\nALL CHECKS PASSED\n" : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
