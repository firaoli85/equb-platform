// BEHAVIOURAL VERIFICATION for §9 finding #30 — override weeks outliving the
// commitment that created them.
//
//   npx tsx scripts/verify-orphan-weeks.mts
//
// THE LEAK. `ensureWeeksThrough` creates weeks past the planned end when a
// member is deliberately extended (2.22 / D-31). Nothing ever removed them:
// shorten that member back, or remove them from the cycle, and the weeks stay.
// No product path could delete them — `updateCycle` prunes only when
// plannedWeeks SHRINKS, and these sit above plannedWeeks by definition.
//
// It matters more now that a week PICKER exists: an orphan week is offered as
// a real week, and `elapsedThroughWeek` eventually counts it, so the cycle
// position would report a week that exists for nobody.
//
// EXERCISES THE FAILING PATH: it creates the override weeks for real, shortens
// the member, and asserts they are gone — then proves the guard by putting
// money on one and asserting it SURVIVES.

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const { PrismaPg } = await import("@prisma/adapter-pg");
const { PrismaClient } = await import("../lib/generated/prisma/client");
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL! }),
});
const fixture = await import("./lib/production-fixture.mts");
const { ensureWeeksThrough, pruneOrphanOverrideWeeks } = await import(
  "../lib/participation-rules"
);

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
const cycle = await prisma.cycle.findUniqueOrThrow({ where: { id: f.cycleId } });
const weekCount = () => prisma.week.count({ where: { cycleId: f.cycleId } });

check("the fixture starts at its planned length", (await weekCount()) === fixture.PLANNED_WEEKS);

// ————————————————— 1. THE OVERRIDE CREATES THE WEEKS —————————————————

console.log("\n1. A member is extended past the planned end (2.22 override)");

const extended = f.members[3];
await prisma.$transaction(async (tx) => {
  await tx.participation.update({
    where: { id: extended.participationId },
    data: { weeksCommitted: 25 }, // finishes week 25, past the planned 20
  });
  await ensureWeeksThrough(tx, cycle, 25);
});

check("weeks 21–25 now exist", (await weekCount()) === 25, `${await weekCount()}`);
check(
  "and they are past the planned end",
  (await prisma.week.count({
    where: { cycleId: f.cycleId, weekNumber: { gt: fixture.PLANNED_WEEKS } },
  })) === 5,
);

// ————————————————— 2. SHORTENING LEAVES THEM ORPHANED —————————————————

console.log("\n2. The same member is shortened back — the failing path");

await prisma.participation.update({
  where: { id: extended.participationId },
  data: { weeksCommitted: fixture.PLANNED_WEEKS },
});

// Without the prune this is where they were stranded forever.
const orphanedBefore = await prisma.week.count({
  where: { cycleId: f.cycleId, weekNumber: { gt: fixture.PLANNED_WEEKS } },
});
check("they are stranded before the prune runs", orphanedBefore === 5);

const pruned = await prisma.$transaction((tx) => pruneOrphanOverrideWeeks(tx, f.cycleId));
check("the prune reports all five", pruned.pruned.length === 5, pruned.pruned.join(","));
check("and they are gone", (await weekCount()) === fixture.PLANNED_WEEKS, `${await weekCount()}`);
check(
  "the planned weeks themselves are untouched",
  (await prisma.week.count({
    where: { cycleId: f.cycleId, weekNumber: { lte: fixture.PLANNED_WEEKS } },
  })) === fixture.PLANNED_WEEKS,
);

// ————————————————— 3. A WEEK ANYTHING POINTS AT IS HISTORY —————————————————

console.log("\n3. The guard: a week carrying anything must SURVIVE");

await prisma.$transaction(async (tx) => {
  await tx.participation.update({
    where: { id: extended.participationId },
    data: { weeksCommitted: 23 },
  });
  await ensureWeeksThrough(tx, cycle, 23);
});
check("weeks 21–23 exist again", (await weekCount()) === 23);

// Money lands on week 22, then the member is shortened back.
const week22 = await prisma.week.findFirstOrThrow({
  where: { cycleId: f.cycleId, weekNumber: 22 },
});
await prisma.payment.create({
  data: {
    participationId: extended.participationId,
    weekId: week22.id,
    amountPaid: extended.weeklyAmount,
  },
});
// A deferral on 23 — excused, but still a real decision the organizer made.
const week23 = await prisma.week.findFirstOrThrow({
  where: { cycleId: f.cycleId, weekNumber: 23 },
});
await prisma.payment.create({
  data: {
    participationId: extended.participationId,
    weekId: week23.id,
    amountPaid: 0,
    isDeferred: true,
  },
});
await prisma.participation.update({
  where: { id: extended.participationId },
  data: { weeksCommitted: fixture.PLANNED_WEEKS },
});

const guarded = await prisma.$transaction((tx) => pruneOrphanOverrideWeeks(tx, f.cycleId));
check("only the genuinely empty week 21 is pruned", guarded.pruned.join(",") === "21", guarded.pruned.join(","));
check(
  "week 22 SURVIVES — money landed on it",
  (await prisma.week.count({ where: { cycleId: f.cycleId, weekNumber: 22 } })) === 1,
);
check(
  "week 23 SURVIVES — a deferral is a real decision",
  (await prisma.week.count({ where: { cycleId: f.cycleId, weekNumber: 23 } })) === 1,
);

// ————————————————— 4. A WEEK SOMEONE STILL REACHES IS KEPT —————————————————

console.log("\n4. A week another member still reaches is never pruned");

const other = f.members[5];
await prisma.$transaction(async (tx) => {
  await tx.participation.update({
    where: { id: other.participationId },
    data: { weeksCommitted: 24 },
  });
  await ensureWeeksThrough(tx, cycle, 24);
});
const kept = await prisma.$transaction((tx) => pruneOrphanOverrideWeeks(tx, f.cycleId));
check("nothing is pruned while a commitment reaches week 24", kept.pruned.length === 0, kept.pruned.join(","));
check(
  "week 24 exists for the member who reaches it",
  (await prisma.week.count({ where: { cycleId: f.cycleId, weekNumber: 24 } })) === 1,
);

// ————————————————— Cleanup —————————————————

await fixture.wipe(prisma);
const left = await fixture.assertClean(prisma);
console.log(`\nFixtures remaining: ${left}`);
if (left !== 0) failures += 1;
console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);

await prisma.$disconnect();
process.exit(failures === 0 ? 0 : 1);
