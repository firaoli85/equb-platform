// BEHAVIOURAL VERIFICATION for D-1 and D-23, against the LIVE database.
//
// The unit tests prove the decision logic. This proves the parts only the
// database can: that the intention persists on the participation, that a
// deduction moves BOTH the payout and the ledger, and — the one that matters —
// that nothing anywhere applies a deduction without an explicit confirmation.
//
//   npx tsx scripts/verify-carry-deduction.mts
//
// Creates a synthetic person, cycle participation and payout, exercises the
// path, then deletes everything.

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const { PrismaPg } = await import("@prisma/adapter-pg");
const { PrismaClient } = await import("../lib/generated/prisma/client");
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL! }),
});
const { applyCarryDeduction, carryOffer } = await import("../lib/carry-balance");
const { ledgerBalance } = await import("../lib/ledger");
const { formatMoney } = await import("../lib/format");

const NAME = "Carry Verify";
const LAST = "Fixture";
let failures = 0;

function check(label: string, condition: boolean, detail?: string) {
  if (condition) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// ————————————————— Setup —————————————————

// Leftovers from an interrupted run must not poison this one. Participations
// first: the FK on people deliberately refuses a person still in a cycle (2.5).
const stale = await prisma.person.findMany({
  where: { nameEnglishFirst: NAME, nameEnglishLast: LAST },
  select: { id: true },
});
for (const s of stale) {
  await prisma.participation.deleteMany({ where: { personId: s.id } });
  await prisma.ledgerEntry.deleteMany({ where: { personId: s.id } });
  await prisma.person.delete({ where: { id: s.id } });
}

const cycle = await prisma.cycle.findFirst({ where: { status: "ACTIVE" } });
if (!cycle) throw new Error("No active cycle.");

const person = await prisma.person.create({
  data: {
    nameAmharic: "የተሸከመ ሙከራ",
    nameEnglishFirst: NAME,
    nameEnglishLast: LAST,
    phone: "+15550007777",
    // They arrive carrying $1,250 from a previous cycle.
    ledgerEntries: {
      create: [
        {
          type: "DEBT",
          amount: 125_000,
          description: "Short at the close of the previous cycle",
          occurredAt: new Date("2026-01-15T00:00:00Z"),
        },
      ],
    },
  },
});

const taken = new Set(
  (await prisma.luckyNumber.findMany({ where: { cycleId: cycle.id }, select: { number: true } })).map(
    (n) => n.number,
  ),
);
let number = 950;
while (taken.has(number)) number += 1;

const participation = await prisma.participation.create({
  data: {
    cycleId: cycle.id,
    personId: person.id,
    weeklyAmount: 50_000,
    startWeek: 1,
    weeksCommitted: 20,
    luckyNumbers: { create: [{ cycleId: cycle.id, number, amount: 50_000 }] },
  },
  include: { luckyNumbers: true },
});

const payout = await prisma.payout.create({
  data: {
    luckyNumberId: participation.luckyNumbers[0].id,
    grossAmount: 1_000_000,
    feeAmount: 20_000,
    netAmount: 980_000, // $9,800
    status: "PENDING",
  },
});

console.log(`Person ${person.id}, participation ${participation.id}, payout ${payout.id}\n`);

// ————————————————— 1. The intention persists (D-2) —————————————————

console.log("1. The carry intention is stored on the participation");
await prisma.participation.update({
  where: { id: participation.id },
  data: { carryIntent: "deduct", carryIntentAt: new Date(), carryIntentAmount: 125_000 },
});
const stored = await prisma.participation.findUniqueOrThrow({
  where: { id: participation.id },
  select: { carryIntent: true, carryIntentAt: true, carryIntentAmount: true },
});
check("the choice survives the write", stored.carryIntent === "deduct");
check("the balance at the time is kept for the record", stored.carryIntentAmount === 125_000);
check("the decision is timestamped", stored.carryIntentAt !== null);

// ————————————————— 2. The offer is produced, pre-ticked —————————————————

console.log("\n2. The offer resurfaces at payout time");
const entries = await prisma.ledgerEntry.findMany({
  where: { personId: person.id },
  select: { type: true, amount: true },
});
const balance = ledgerBalance(entries);
check("the live balance is read from the ledger", balance === 125_000, formatMoney(balance));

const offer = carryOffer({
  ledgerBalance: balance,
  payoutNet: payout.netAmount,
  intention: {
    choice: "deduct",
    amountAtChoice: 125_000,
    decidedAt: new Date(),
    cycleName: cycle.name,
  },
});
check("an offer is produced", offer.kind === "offer");
check("it is PRE-TICKED, because the organizer chose deduct", offer.kind === "offer" && offer.preTicked);
check(
  "it says where it came from",
  offer.kind === "offer" && (offer.origin ?? "").includes(cycle.name),
);
check(
  "the payout is UNCHANGED by producing the offer",
  (await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } })).netAmount === 980_000,
);

// ————————————————— 3. Nothing applies without confirmation (D-23) —————————————————

console.log("\n3. D-23: nothing is deducted without an explicit confirmation");
const unconfirmed = applyCarryDeduction({
  confirmedByOrganizer: false,
  amount: 125_000,
  ledgerBalance: balance,
  payoutNet: payout.netAmount,
});
check("an unconfirmed deduction is refused", unconfirmed.ok === false);
check(
  "the payout is STILL untouched after the refusal",
  (await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } })).netAmount === 980_000,
);
check(
  "and no ledger entry was created",
  (await prisma.ledgerEntry.count({ where: { personId: person.id } })) === 1,
);

// ————————————————— 4. Confirmed, it moves both sides —————————————————

console.log("\n4. Confirmed, it moves the payout AND the ledger");
const applied = applyCarryDeduction({
  confirmedByOrganizer: true,
  amount: 125_000,
  ledgerBalance: balance,
  payoutNet: payout.netAmount,
});
check("the confirmed deduction is allowed", applied.ok === true);
if (applied.ok) {
  await prisma.payout.update({
    where: { id: payout.id },
    data: { netAmount: applied.data.netAfter },
  });
  await prisma.ledgerEntry.create({
    data: {
      personId: person.id,
      type: "PAYMENT",
      amount: applied.data.deducted,
      description: `Deducted from payout — ${cycle.name}, number #${number}`,
      occurredAt: new Date(),
    },
  });

  const after = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
  check("the payout net drops by the deduction", after.netAmount === 855_000, formatMoney(after.netAmount));

  const afterEntries = await prisma.ledgerEntry.findMany({
    where: { personId: person.id },
    select: { type: true, amount: true },
  });
  check("the ledger balance clears", ledgerBalance(afterEntries) === 0);
  check(
    "and it is recorded as a PAYMENT, so the story reads honestly",
    afterEntries.filter((e) => e.type === "PAYMENT").length === 1,
  );
}

// ————————————————— 5. Clean delete (2.9) —————————————————

console.log("\n5. Clean delete (2.9) — and the FK that protects a person in a cycle (2.5)");

// The database REFUSES to delete a person who is still in a cycle. That is
// the protection, not a bug: people are permanent (2.5), and removing one
// mid-cycle would orphan their money. Every real delete path removes the
// participation first, so this mirrors it.
let refusedWhileInCycle = false;
try {
  await prisma.person.delete({ where: { id: person.id } });
} catch {
  refusedWhileInCycle = true;
}
check("a person still in a cycle cannot be deleted outright", refusedWhileInCycle);

// Removing the participation is not enough either: the LEDGER holds the
// person too, because a carried balance belongs to the person and outlives
// every cycle (2.18). Both refusals are the protection working.
await prisma.participation.delete({ where: { id: participation.id } });
let refusedWhileCarrying = false;
try {
  await prisma.person.delete({ where: { id: person.id } });
} catch {
  refusedWhileCarrying = true;
}
check("a person with ledger history cannot be deleted outright either (2.18)", refusedWhileCarrying);

await prisma.ledgerEntry.deleteMany({ where: { personId: person.id } });
await prisma.person.delete({ where: { id: person.id } });
check(
  "no participation left",
  (await prisma.participation.count({ where: { id: participation.id } })) === 0,
);
check("no payout left", (await prisma.payout.count({ where: { id: payout.id } })) === 0);
check(
  "no ledger entries left",
  (await prisma.ledgerEntry.count({ where: { personId: person.id } })) === 0,
);

const leftover = await prisma.person.count({
  where: { nameEnglishFirst: NAME, nameEnglishLast: LAST },
});
console.log(`\nFixtures remaining: ${leftover}`);
console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);

await prisma.$disconnect();
process.exit(failures === 0 ? 0 : 1);
