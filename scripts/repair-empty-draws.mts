// REPAIR the half-state weeks found by scripts/audit-empty-draws.mts.
//
//   npx tsx scripts/repair-empty-draws.mts            # DRY RUN — writes nothing
//   npx tsx scripts/repair-empty-draws.mts --apply    # performs the repair
//
// It repairs through the SAME functions the app now runs on every edit
// (lib/draw-cascade), so the repair and the ongoing behaviour cannot drift
// apart: whatever this does to week 6 today is exactly what a move will do to
// week 9 tomorrow.
//
// WHAT IT REPAIRS, and why each is wrong:
//
//   1. A DRAW HOLDING NO PAYOUT. The week is counted as drawn while holding
//      nothing: Draw.@@unique([weekId]) refuses a new draw, the pickers label
//      it "already drawn" with no amount, and any number left in its slot is
//      out of the wheel pool forever. Deleting the draw is what frees both.
//
//   2. A PLANNED WINNER PLAN WITH ZERO NUMBERS. WinnerPlanNumber cascades when
//      a LuckyNumber is deleted, so a plan can be hollowed out without the
//      organizer touching it. selectWinningSlot matches plans with .every(),
//      and [].every(...) is VACUOUSLY TRUE — the plan then matches the FIRST
//      eligible slot and silently decides that week's draw, recorded in the
//      audit log as an intentional "planned" win rather than a spin.
//
// It touches NOTHING else. No payout, no receipt, no week row, no member.
// Every change is inside one serializable transaction with an audit entry.

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const APPLY = process.argv.includes("--apply");

const { PrismaPg } = await import("@prisma/adapter-pg");
const { PrismaClient } = await import("../lib/generated/prisma/client");
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL! }),
});
const { deleteDrawIfEmpty, purgeEmptyWinnerPlans } = await import("../lib/draw-cascade");

console.log(APPLY ? "APPLYING THE REPAIR\n" : "DRY RUN — nothing will be written\n");

const empty = await prisma.draw.findMany({
  where: { payouts: { none: {} } },
  include: {
    week: { include: { cycle: { select: { id: true, name: true, status: true } } } },
    slot: {
      include: {
        members: {
          include: {
            luckyNumber: { include: { participation: { include: { person: true } } } },
          },
        },
      },
    },
  },
  orderBy: [{ week: { weekNumber: "asc" } }],
});

console.log(`Draws holding no payout: ${empty.length}`);
for (const d of empty) {
  const numbers = d.slot.members.map(
    (m) => `#${m.luckyNumber.number} (${m.luckyNumber.participation.person.nameEnglishFirst})`,
  );
  console.log(
    `\n  WEEK ${d.week.weekNumber} — "${d.week.cycle.name}" [${d.week.cycle.status}]\n` +
      `    delete draw   ${d.id}\n` +
      `    week becomes  UNDRAWN and selectable again\n` +
      `    back in pool  ${numbers.length > 0 ? numbers.join(", ") : "(none — the slot is empty)"}\n` +
      `    slot          ${d.slot.members.length === 0 ? `RELEASED (${d.slot.id}, position ${d.slot.position})` : "kept, it still holds numbers"}`,
  );
}

const emptyPlans = await prisma.winnerPlan.findMany({
  where: { status: "PLANNED", numbers: { none: {} } },
  include: { week: true, cycle: { select: { id: true, name: true } } },
});
console.log(`\n\nPlanned winner plans with zero numbers: ${emptyPlans.length}`);
for (const p of emptyPlans) {
  console.log(
    `\n  plan ${p.id} — "${p.cycle.name}", ${p.week ? `week ${p.week.weekNumber}` : "no week"}, mode ${p.mode}\n` +
      `    delete it     it would otherwise match the FIRST eligible slot and decide that draw`,
  );
}

if (!APPLY) {
  console.log(
    `\n\nNothing was written. Re-run with --apply to perform ${empty.length + emptyPlans.length} change(s).`,
  );
  await prisma.$disconnect();
  process.exit(0);
}

// ————————————————— The repair —————————————————

let drawsRemoved = 0;
let plansRemoved = 0;
const cycleIds = new Set<string>();

for (const d of empty) {
  const result = await prisma.$transaction(
    async (tx) => deleteDrawIfEmpty(tx, d.id),
    { isolationLevel: "Serializable" },
  );
  if (result.deleted) {
    drawsRemoved += 1;
    cycleIds.add(d.week.cycle.id);
    console.log(
      `  repaired week ${result.weekNumber}: draw removed` +
        (result.numbersReturning.length > 0
          ? `, ${result.numbersReturning.map((n) => `#${n}`).join(", ")} back in the pool`
          : "") +
        (result.deleteSlot ? ", slot released" : "") +
        (result.planRestored ? ", winner plan PLANNED again" : ""),
    );
  } else {
    // A payout landed on it between the read and the write — leaving it alone
    // is the correct outcome, and worth saying out loud.
    console.log(`  SKIPPED week ${d.week.weekNumber}: it holds a payout now, so its draw stands`);
  }
}

for (const p of emptyPlans) cycleIds.add(p.cycle.id);
for (const cycleId of cycleIds) {
  const purged = await prisma.$transaction(
    async (tx) => purgeEmptyWinnerPlans(tx, cycleId),
    { isolationLevel: "Serializable" },
  );
  plansRemoved += purged.purged;
  for (const week of purged.weeks) {
    console.log(`  purged empty winner plan for ${week === null ? "an unassigned week" : `week ${week}`}`);
  }
}

// ————————————————— Proof, read back from the database —————————————————

const stillEmpty = await prisma.draw.count({ where: { payouts: { none: {} } } });
const stillEmptyPlans = await prisma.winnerPlan.count({
  where: { status: "PLANNED", numbers: { none: {} } },
});
console.log(
  `\nRemoved ${drawsRemoved} empty draw(s) and ${plansRemoved} empty plan(s).\n` +
    `Draws still holding no payout: ${stillEmpty}\n` +
    `Planned plans still holding no numbers: ${stillEmptyPlans}`,
);
console.log(stillEmpty === 0 && stillEmptyPlans === 0 ? "\nCLEAN" : "\nSOMETHING REMAINS — re-run the audit");

await prisma.$disconnect();
process.exit(stillEmpty === 0 && stillEmptyPlans === 0 ? 0 : 1);
