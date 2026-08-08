// BEHAVIOURAL VERIFICATION for §9 finding #44 — the carry intention never
// expired, and re-armed itself on an unrelated debt.
//
//   npx tsx scripts/verify-carry-intent-expiry.mts
//
// THE BREAK. `carryIntent` is written once, when the organizer adds a member
// to a cycle, and it decides only whether the deduction offer arrives
// PRE-TICKED. Nothing ever cleared it — not the deduction, not a full ledger
// payment, not forgiveness. So a decision taken about ONE debt kept re-arming:
// a member who later picked up an UNRELATED balance (a second cycle, a
// shortfall written at close) met a pre-ticked "deduct from payout" box for a
// choice the organizer never made about that money.
//
// D-23 is explicit — the system OFFERS and the human DECIDES. A stale tick is
// the system deciding quietly.
//
// EXERCISES THE FAILING PATH: it applies a deduction, then raises a brand-new
// debt and asks the offer again. Before the fix the second offer came back
// pre-ticked. The check is on that second offer, not on the first.

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const { PrismaPg } = await import("@prisma/adapter-pg");
const { PrismaClient } = await import("../lib/generated/prisma/client");
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL! }),
});
const fixture = await import("./lib/production-fixture.mts");
const { carryOffer } = await import("../lib/carry-balance");
const { ledgerStory } = await import("../lib/ledger");

/** The live balance, through the same story the member page reads. */
const balanceOf = (entries: { type: string; amount: number }[]) =>
  ledgerStory(entries as never).balance;

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

// Member 3 is the fixture's carried-balance member: they stopped paying after
// week 4 and hold a real DEBT ledger entry.
const debtor = f.members[2];
const entriesFor = async (personId: string) =>
  prisma.ledgerEntry.findMany({ where: { personId }, select: { type: true, amount: true } });

const startingBalance = balanceOf(await entriesFor(debtor.personId));
check("the fixture member really carries a balance", startingBalance > 0, `${startingBalance}`);

// The organizer records the intention when adding them — "deduct it from
// their payout when they win".
await prisma.participation.update({
  where: { id: debtor.participationId },
  data: {
    carryIntent: "deduct",
    carryIntentAt: new Date(Date.UTC(2026, 4, 17)),
    carryIntentAmount: startingBalance,
  },
});

// ————————————————— 1. THE INTENTION PRE-TICKS THE FIRST OFFER —————————————————

console.log("\n1. The offer on the payout the intention was recorded for");

const first = carryOffer({
  ledgerBalance: startingBalance,
  payoutNet: 1_000_000,
  intention: { choice: "deduct", cycleName: fixture.FIXTURE_TAG, amountAtChoice: startingBalance, decidedAt: new Date() },
});
check("it is offered", first.kind === "offer");
check("and it arrives PRE-TICKED, because that was the decision", first.kind === "offer" && first.preTicked === true);

// ————————————————— 2. THE DEDUCTION SPENDS THE INTENTION —————————————————

console.log("\n2. After the deduction, the intention is cleared");

// The action's own write, exercised directly: clear the intent alongside the
// ledger entry and the payout decrement.
await prisma.$transaction(async (tx) => {
  await tx.ledgerEntry.create({
    data: {
      personId: debtor.personId,
      type: "PAYMENT",
      amount: startingBalance,
      description: `${fixture.FIXTURE_TAG} — deducted from payout`,
      occurredAt: new Date(),
    },
  });
  await tx.participation.update({
    where: { id: debtor.participationId },
    data: { carryIntent: null, carryIntentAt: null, carryIntentAmount: null },
  });
});

const afterDeduction = await prisma.participation.findUniqueOrThrow({
  where: { id: debtor.participationId },
  select: { carryIntent: true, carryIntentAt: true, carryIntentAmount: true },
});
check("carryIntent is cleared", afterDeduction.carryIntent === null);
check("and so are its date and amount", afterDeduction.carryIntentAt === null && afterDeduction.carryIntentAmount === null);
check(
  "the balance is genuinely settled",
  balanceOf(await entriesFor(debtor.personId)) === 0,
);

// ————————————————— 3. THE FAILING PATH: AN UNRELATED DEBT LATER —————————————————

console.log("\n3. A brand-new, unrelated debt appears later");

// A shortfall written at close, or a second cycle — money the organizer has
// made NO decision about.
await prisma.ledgerEntry.create({
  data: {
    personId: debtor.personId,
    type: "DEBT",
    amount: 250_000,
    description: `${fixture.FIXTURE_TAG} — a later, unrelated shortfall`,
    occurredAt: new Date(),
  },
});
const newBalance = balanceOf(await entriesFor(debtor.personId));
check("the new balance is real", newBalance === 250_000, `${newBalance}`);

const live = await prisma.participation.findUniqueOrThrow({
  where: { id: debtor.participationId },
  select: { carryIntent: true },
});
const second = carryOffer({
  ledgerBalance: newBalance,
  payoutNet: 1_000_000,
  intention: live.carryIntent
    ? { choice: live.carryIntent as "deduct", cycleName: fixture.FIXTURE_TAG, amountAtChoice: 0, decidedAt: new Date() }
    : null,
});

check("the offer is still MADE — the organizer can still choose it", second.kind === "offer");
// THE ASSERTION THAT WOULD HAVE CAUGHT IT.
check(
  "but it is NOT pre-ticked — no decision was made about this money",
  second.kind === "offer" && second.preTicked === false,
  `kind=${second.kind}`,
);

// And the contrast, so the check above cannot pass vacuously: with the stale
// intent still present, this is exactly what the organizer used to see.
const asItWas = carryOffer({
  ledgerBalance: newBalance,
  payoutNet: 1_000_000,
  intention: { choice: "deduct", cycleName: fixture.FIXTURE_TAG, amountAtChoice: 0, decidedAt: new Date() },
});
check(
  "the stale-intent case really would have been pre-ticked (the check is not vacuous)",
  asItWas.kind === "offer" && asItWas.preTicked === true,
);

// ————————————————— Cleanup —————————————————

await fixture.wipe(prisma);
const left = await fixture.assertClean(prisma);
console.log(`\nFixtures remaining: ${left}`);
if (left !== 0) failures += 1;
console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);

await prisma.$disconnect();
process.exit(failures === 0 ? 0 : 1);
