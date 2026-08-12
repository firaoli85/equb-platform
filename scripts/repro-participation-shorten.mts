// REPRODUCTION — "saving a participation change does not take".
//
//   npx tsx scripts/repro-participation-shorten.mts
//
// Reported: a member was added at 11 weeks running past the cycle's planned
// end, the organizer reduced it to 10, the override dialog appeared, and the
// change did not persist.
//
// This runs the EXACT server sequence `updateParticipation` performs, in the
// same order, inside the same kind of transaction — minus `requireAdmin`,
// which is the only part a script cannot reach. If the change commits here,
// the server is not what is dropping it and the cause is in the client.
//
// Read-only with respect to real data: everything happens on the
// production-shaped fixture, which is wiped at both ends.

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const { PrismaPg } = await import("@prisma/adapter-pg");
const { PrismaClient } = await import("../lib/generated/prisma/client");
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL! }),
});
const fixture = await import("./lib/production-fixture.mts");
const { calculateFinishWeek, remainingWeeksInCycle } = await import("../lib/money");
const { ensureWeeksThrough, pruneOrphanOverrideWeeks, validateCommitmentCap } = await import(
  "../lib/participation-rules"
);
const { windowChangeRefusal } = await import("../lib/participation-window");
const { rebuildParticipationPayments } = await import("../lib/rebuild");
const { commitmentCap, weeksToFinishWithGroup } = await import("../lib/commitment");

const say = (label: string, detail: unknown = "") => console.log(`  ${label}${detail !== "" ? ` — ${detail}` : ""}`);

await fixture.wipe(prisma);
const f = await fixture.build(prisma);
const cycle = await prisma.cycle.findUniqueOrThrow({ where: { id: f.cycleId } });

// Henok's shape: a LATE JOINER whose commitment runs past the planned end.
// Start week 13 + 11 weeks = week 23, exactly the reported dialog.
const START = 13;
const LONG = 11; // → finishes week 23
const SHORT = 10; // → finishes week 22, still past the planned 20
const target = f.members[10];

console.log(`\nCycle: ${cycle.name}, planned ${cycle.plannedWeeks} weeks`);
console.log(`Member: ${target.name} (${target.participationId})`);

// ————————————————— 0. The CLIENT-side gate, before anything else —————————————————

console.log("\n0. What the CLIENT computes for each step");
for (const [label, weeks] of [
  ["add at 11", LONG],
  ["reduce to 10", SHORT],
] as const) {
  const cap = commitmentCap({
    plannedWeeks: cycle.plannedWeeks,
    startWeek: START,
    weeksCommitted: weeks,
    extendPastPlannedEnd: false,
  });
  const capWithOverride = commitmentCap({
    plannedWeeks: cycle.plannedWeeks,
    startWeek: START,
    weeksCommitted: weeks,
    extendPastPlannedEnd: true,
  });
  say(
    `${label}: finishes week ${calculateFinishWeek(START, weeks)}`,
    `cap=${remainingWeeksInCycle(cycle.plannedWeeks, START)} · ` +
      `no-override=${JSON.stringify(cap)} · with-override=${JSON.stringify(capWithOverride)}`,
  );
}
say(
  `"Finish with the group" from week ${START} would set weeks to`,
  weeksToFinishWithGroup(cycle.plannedWeeks, START),
);

// ————————————————— 1. Put them on the LONG commitment —————————————————

console.log("\n1. Add at 11 weeks with the override (finishes week 23)");

async function applyUpdate(weeksCommitted: number, extendPastPlannedEnd: boolean) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.participation.findUniqueOrThrow({
      where: { id: target.participationId },
      include: { cycle: true, person: true, luckyNumbers: { include: { payouts: true } } },
    });
    const input = {
      weeklyAmount: before.weeklyAmount,
      startWeek: START,
      weeksCommitted,
      extendPastPlannedEnd,
    };

    const capError = validateCommitmentCap(before.cycle, input);
    if (capError) return { ok: false as const, where: "validateCommitmentCap", error: capError };

    const numberIds = before.luckyNumbers.map((n) => n.id);
    const numberOf = new Map(before.luckyNumbers.map((n) => [n.id, n.number]));
    const plans = await tx.winnerPlan.findMany({
      where: {
        cycleId: before.cycleId,
        status: "PLANNED",
        weekId: { not: null },
        numbers: { some: { luckyNumberId: { in: numberIds } } },
      },
      include: { numbers: { select: { luckyNumberId: true } }, week: { select: { weekNumber: true } } },
    });
    const draws = await tx.draw.findMany({
      where: { slot: { members: { some: { luckyNumberId: { in: numberIds } } } } },
      include: {
        week: { select: { weekNumber: true, cycleId: true } },
        slot: { include: { members: { select: { luckyNumberId: true } } } },
      },
    });
    const refusal = windowChangeRefusal({
      memberName: before.person.nameEnglishFirst,
      startWeek: input.startWeek,
      weeksCommitted: input.weeksCommitted,
      plans: plans
        .filter((p) => p.week !== null)
        .map((p) => ({
          weekNumber: p.week!.weekNumber,
          numbers: p.numbers
            .map((n) => numberOf.get(n.luckyNumberId))
            .filter((n): n is number => n !== undefined),
        })),
      drawnWeeks: draws
        .filter((d) => d.week.cycleId === before.cycleId)
        .map((d) => ({
          weekNumber: d.week.weekNumber,
          numbers: d.slot.members
            .map((m) => numberOf.get(m.luckyNumberId))
            .filter((n): n is number => n !== undefined),
        })),
    });
    if (refusal) return { ok: false as const, where: "windowChangeRefusal", error: refusal };

    await ensureWeeksThrough(tx, before.cycle, calculateFinishWeek(input.startWeek, input.weeksCommitted));
    const after = await tx.participation.update({
      where: { id: target.participationId },
      data: {
        weeklyAmount: input.weeklyAmount,
        startWeek: input.startWeek,
        weeksCommitted: input.weeksCommitted,
      },
    });
    await rebuildParticipationPayments(tx, target.participationId);
    const pruned = await pruneOrphanOverrideWeeks(tx, before.cycleId);
    return { ok: true as const, after, pruned: pruned.pruned };
  });
}

const long = await applyUpdate(LONG, true);
say("result", JSON.stringify(long.ok ? { ok: true, weeks: long.after.weeksCommitted, pruned: long.pruned } : long));
const afterLong = await prisma.participation.findUniqueOrThrow({
  where: { id: target.participationId },
});
say("stored weeksCommitted", afterLong.weeksCommitted);
say(
  "week rows now",
  (await prisma.week.count({ where: { cycleId: f.cycleId } })) + ` (planned ${cycle.plannedWeeks})`,
);

// ————————————————— 2. REDUCE to 10 — the reported failure —————————————————

console.log("\n2. Reduce to 10 weeks (finishes week 22, still past the planned 20)");

console.log("\n  2a. WITH the override still ticked — what the client sends if `extend` survived:");
const shortWithOverride = await applyUpdate(SHORT, true);
say(
  "result",
  JSON.stringify(
    shortWithOverride.ok
      ? { ok: true, weeks: shortWithOverride.after.weeksCommitted, pruned: shortWithOverride.pruned }
      : shortWithOverride,
  ),
);
say(
  "stored weeksCommitted",
  (await prisma.participation.findUniqueOrThrow({ where: { id: target.participationId } }))
    .weeksCommitted,
);

// Put it back to 11 for the second half of the experiment.
await applyUpdate(LONG, true);

console.log("\n  2b. WITHOUT the override — what the client sends if `extend` reset to false:");
const shortNoOverride = await applyUpdate(SHORT, false);
say(
  "result",
  JSON.stringify(
    shortNoOverride.ok
      ? { ok: true, weeks: shortNoOverride.after.weeksCommitted, pruned: shortNoOverride.pruned }
      : shortNoOverride,
  ),
);
say(
  "stored weeksCommitted",
  (await prisma.participation.findUniqueOrThrow({ where: { id: target.participationId } }))
    .weeksCommitted,
);

await fixture.wipe(prisma);
console.log(`\nFixtures remaining: ${await fixture.assertClean(prisma)}`);
await prisma.$disconnect();
