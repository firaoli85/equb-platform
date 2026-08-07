// READ-ONLY AUDIT: draws that hold no payouts, and the orphans around them.
//
//   npx tsx scripts/audit-empty-draws.mts
//
// A Draw with zero Payouts is a week counted as DRAWN that holds nothing: the
// week picker offers it as "already drawn" with no amount, the wheel refuses
// to draw it (@@unique([weekId])), and its slot members stay out of the pool.
// It is created whenever the LAST winner leaves a week — by move, by remove,
// or by deleting the last payout — because none of those paths deleted the
// draw behind them.
//
// Deletes NOTHING. Prints exactly what a repair would have to do.

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const { PrismaPg } = await import("@prisma/adapter-pg");
const { PrismaClient } = await import("../lib/generated/prisma/client");
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL! }),
});

const draws = await prisma.draw.findMany({
  include: {
    week: { include: { cycle: { select: { id: true, name: true, status: true } } } },
    payouts: { include: { luckyNumber: true } },
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

console.log(`Draws in the database: ${draws.length}\n`);

const empty = draws.filter((d) => d.payouts.length === 0);
console.log(`EMPTY DRAWS (zero payouts): ${empty.length}`);
for (const d of empty) {
  const numbers = d.slot.members
    .map((m) => `#${m.luckyNumber.number} (${m.luckyNumber.participation.person.nameEnglishFirst})`)
    .join(", ");
  console.log(
    `  week ${d.week.weekNumber} — cycle "${d.week.cycle.name}" [${d.week.cycle.status}]\n` +
      `      draw ${d.id}  slot ${d.slot.id} (position ${d.slot.position})\n` +
      `      slot members still out of the pool: ${numbers || "NONE — the slot is empty too"}\n` +
      `      assignedManually=${d.assignedManually}  drawnAt=${d.drawnAt.toISOString()}`,
  );
}

// A payout attached to a draw whose SLOT does not carry its number is money
// the settlement skips and a number that never leaves the wheel.
console.log(`\nPAYOUTS NOT BACKED BY A SLOT MEMBER:`);
let unbacked = 0;
for (const d of draws) {
  const memberIds = new Set(d.slot.members.map((m) => m.luckyNumberId));
  for (const p of d.payouts) {
    if (!memberIds.has(p.luckyNumberId)) {
      unbacked += 1;
      console.log(
        `  week ${d.week.weekNumber}: payout ${p.id} for #${p.luckyNumber.number} — its number is NOT in the drawn slot`,
      );
    }
  }
}
if (unbacked === 0) console.log("  none");

// A slot member with no payout on that draw: drawn but never paid.
console.log(`\nSLOT MEMBERS WITH NO PAYOUT ON THEIR DRAW:`);
let unpaid = 0;
for (const d of draws) {
  const paid = new Set(d.payouts.map((p) => p.luckyNumberId));
  for (const m of d.slot.members) {
    if (!paid.has(m.luckyNumberId)) {
      unpaid += 1;
      console.log(
        `  week ${d.week.weekNumber}: #${m.luckyNumber.number} ` +
          `(${m.luckyNumber.participation.person.nameEnglishFirst}) is drawn but has no payout`,
      );
    }
  }
}
if (unpaid === 0) console.log("  none");

// Settlement receipts whose funding payout is gone (FK SetNull on delete).
const orphanSettlements = await prisma.paymentEvent.findMany({
  where: { pinnedWeekId: { not: null }, settlementPayoutId: null },
  include: {
    pinnedWeek: true,
    participation: { include: { person: true } },
  },
});
console.log(`\nSETTLEMENT RECEIPTS WHOSE PAYOUT IS GONE: ${orphanSettlements.length}`);
for (const e of orphanSettlements) {
  console.log(
    `  ${e.participation.person.nameEnglishFirst} — week ${e.pinnedWeek?.weekNumber}, ` +
      `$${(e.amount / 100).toLocaleString("en-US")} still credited with no payout behind it (event ${e.id})`,
  );
}

// Winner plans with zero numbers — `[].every(...)` is vacuously true, so an
// emptied plan matches the FIRST eligible slot and silently rigs a draw.
const emptyPlans = await prisma.winnerPlan.findMany({
  where: { status: "PLANNED", numbers: { none: {} } },
  include: { week: true, cycle: { select: { name: true } } },
});
console.log(`\nPLANNED WINNER PLANS WITH ZERO NUMBERS: ${emptyPlans.length}`);
for (const p of emptyPlans) {
  console.log(
    `  plan ${p.id} — cycle "${p.cycle.name}", ${p.week ? `week ${p.week.weekNumber}` : "no week"}, mode ${p.mode}`,
  );
}

// Slots holding nobody and winning nothing — dead seats in @@unique([cycleId, position]).
const deadSlots = await prisma.slot.count({ where: { members: { none: {} }, draws: { none: {} } } });
console.log(`\nEMPTY SLOTS WITH NO DRAW (harmless clutter): ${deadSlots}`);

const problems = empty.length + unbacked + unpaid + orphanSettlements.length + emptyPlans.length;
console.log(
  problems === 0 ? "\nNO INCONSISTENCIES FOUND" : `\n${problems} INCONSISTENCY/IES FOUND`,
);

await prisma.$disconnect();
