// BEHAVIOURAL VERIFICATION for §9 finding #2 — MONEY OUT WITH NO MONEY IN.
//
//   npx tsx scripts/verify-number-amounts.mts
//
// THE BREAK. `addLuckyNumber` created a number carrying any amount and never
// touched `participation.weeklyAmount`. Every payout is priced PER NUMBER
// (`calculatePayout` reads `luckyNumber.amount`), so the member's entitlement
// rose the instant the number existed — while their weekly bill, which
// `lib/rebuild.ts` reads from `participation.weeklyAmount`, did not move at
// all. `deleteLuckyNumber` was the mirror: they kept being billed for a number
// they no longer held.
//
// THE STANDING RULE THIS OBEYS. A test that passes without ever reaching the
// break proves nothing, so this EXERCISES THE FAILING PATH: it asserts the
// entitlement-vs-bill relationship directly, on the production-shaped fixture
// (27 members, numbers sequential from 1, four double-contributors, real
// draws, real settlements). The double-contributors are the whole point — the
// break is invisible on a single-number member.

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const { PrismaPg } = await import("@prisma/adapter-pg");
const { PrismaClient } = await import("../lib/generated/prisma/client");
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL! }),
});
const fixture = await import("./lib/production-fixture.mts");
const { reconcileWeeklyAmount } = await import("../lib/lucky-numbers");
const { calculatePayout } = await import("../lib/wheel");
const { formatMoney } = await import("../lib/format");

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

/** Entitlement is the sum of what every one of their numbers would pay out. */
async function entitlement(participationId: string, feePercent: number): Promise<number> {
  const p = await prisma.participation.findUniqueOrThrow({
    where: { id: participationId },
    include: { luckyNumbers: true },
  });
  return p.luckyNumbers.reduce(
    (sum, n) =>
      sum +
      calculatePayout({
        luckyNumber: { id: n.id, amount: n.amount },
        participation: { weeksCommitted: p.weeksCommitted },
        cycle: { feePercent },
      }).gross,
    0,
  );
}

/** The weekly bill, as lib/rebuild.ts reads it. */
async function bill(participationId: string): Promise<number> {
  const p = await prisma.participation.findUniqueOrThrow({ where: { id: participationId } });
  return p.weeklyAmount * p.weeksCommitted;
}

// Member 5: $2,000/week, TWO numbers, NOT drawn. The shape the break hides in.
const doubled = f.members[4];
const drawnNumbers = new Set(
  (
    await prisma.draw.findMany({
      where: { week: { cycleId: f.cycleId } },
      include: { slot: { include: { members: { select: { luckyNumberId: true } } } } },
    })
  ).flatMap((d) => d.slot.members.map((m) => m.luckyNumberId)),
);
check(
  "the fixture member is a TWO-number contributor (where the break hides)",
  doubled.numbers.length === 2,
  `${doubled.numbers.length} number(s)`,
);
check(
  "and is NOT drawn, so the reconciliation path is reachable",
  doubled.numbers.every((n) => !drawnNumbers.has(n.id)),
);

// ————————————————— 1. THE FAILING PATH, EXERCISED —————————————————

console.log("\n1. Adding a third number to an undrawn two-number member");

const entitlementBefore = await entitlement(doubled.participationId, fixture.FEE_PERCENT);
const billBefore = await bill(doubled.participationId);
check(
  "before: entitlement and bill agree",
  entitlementBefore === billBefore,
  `${formatMoney(entitlementBefore)} vs ${formatMoney(billBefore)}`,
);

// The reconciliation the action now applies, run over the same rows.
const existing = await prisma.luckyNumber.findMany({
  where: { participationId: doubled.participationId },
  select: { amount: true },
});
const EXTRA = 50_000; // $500 — an irregular slice, not another whole unit
const plan = reconcileWeeklyAmount({
  memberName: doubled.name,
  storedWeekly: doubled.weeklyAmount,
  numberAmounts: [...existing.map((n) => n.amount), EXTRA],
  payoutCount: 0,
});
check("the rule sees the contribution change", plan.changed && plan.refusal === null);
check(
  "and computes the new weekly from the numbers",
  plan.impliedWeekly === doubled.weeklyAmount + EXTRA,
  formatMoney(plan.impliedWeekly),
);

await prisma.$transaction(async (tx) => {
  await tx.luckyNumber.create({
    data: {
      participationId: doubled.participationId,
      cycleId: f.cycleId,
      number: 900,
      amount: EXTRA,
    },
  });
  await tx.participation.update({
    where: { id: doubled.participationId },
    data: { weeklyAmount: plan.impliedWeekly },
  });
});

const entitlementAfter = await entitlement(doubled.participationId, fixture.FEE_PERCENT);
const billAfter = await bill(doubled.participationId);

// THE ASSERTION THAT WOULD HAVE CAUGHT IT. Without the reconciliation the bill
// is unchanged while the entitlement has risen by a whole extra payout.
check(
  "after: entitlement and bill STILL agree — no money out without money in",
  entitlementAfter === billAfter,
  `entitlement ${formatMoney(entitlementAfter)} vs bill ${formatMoney(billAfter)}`,
);
check(
  "entitlement genuinely rose (the path was reached, not skipped)",
  entitlementAfter > entitlementBefore,
  `${formatMoney(entitlementBefore)} -> ${formatMoney(entitlementAfter)}`,
);
check(
  "the gap the break would have opened is exactly one number's payout",
  entitlementAfter - billBefore === EXTRA * 20,
  formatMoney(entitlementAfter - billBefore),
);

// ————————————————— 2. THE MIRROR: DELETING A NUMBER —————————————————

console.log("\n2. Removing that number again");

const remaining = await prisma.luckyNumber.findMany({
  where: { participationId: doubled.participationId, number: { not: 900 } },
  select: { amount: true },
});
const backPlan = reconcileWeeklyAmount({
  memberName: doubled.name,
  storedWeekly: plan.impliedWeekly,
  numberAmounts: remaining.map((n) => n.amount),
  payoutCount: 0,
});
await prisma.$transaction(async (tx) => {
  await tx.luckyNumber.deleteMany({ where: { participationId: doubled.participationId, number: 900 } });
  await tx.participation.update({
    where: { id: doubled.participationId },
    data: { weeklyAmount: backPlan.impliedWeekly },
  });
});
check(
  "the bill falls back with the number — they stop being billed for it",
  (await bill(doubled.participationId)) === billBefore,
);
check(
  "and entitlement and bill agree again",
  (await entitlement(doubled.participationId, fixture.FEE_PERCENT)) ===
    (await bill(doubled.participationId)),
);

// ————————————————— 3. A DRAWN MEMBER IS REFUSED, NOT SILENTLY RE-PRICED —————

console.log("\n3. The same edit on a member who has already been drawn");

// Member 2 is a two-number contributor AND won week 2 — real payouts exist.
const drawnMember = f.members[1];
const payoutCount = await prisma.payout.count({
  where: { luckyNumber: { participationId: drawnMember.participationId } },
});
check("the fixture member really has payouts", payoutCount > 0, `${payoutCount}`);

const refused = reconcileWeeklyAmount({
  memberName: drawnMember.name,
  storedWeekly: drawnMember.weeklyAmount,
  numberAmounts: [...drawnMember.numbers.map((n) => n.amount), EXTRA],
  payoutCount,
});
check("it is REFUSED rather than silently re-priced", refused.refusal !== null);
check(
  "and the refusal names the settlement route instead of dead-ending",
  (refused.refusal ?? "").includes("participation"),
  refused.refusal ?? "",
);
check(
  "the refusal states both figures, so the organizer can judge it",
  (refused.refusal ?? "").includes(formatMoney(drawnMember.weeklyAmount)) &&
    (refused.refusal ?? "").includes(formatMoney(drawnMember.weeklyAmount + EXTRA)),
);

// ————————————————— 4. Emptying a member is refused —————————————————

console.log("\n4. Removing a member's last number");
const lastOne = reconcileWeeklyAmount({
  memberName: "Member01",
  storedWeekly: fixture.UNIT,
  numberAmounts: [],
  payoutCount: 0,
});
check("refused — that is a removal from the cycle, not a number edit", lastOne.refusal !== null);
check(
  "and it says so, pointing at the removal flow",
  (lastOne.refusal ?? "").toLowerCase().includes("remove them from the cycle"),
);

// ————————————————— Cleanup —————————————————

await fixture.wipe(prisma);
const left = await fixture.assertClean(prisma);
console.log(`\nFixtures remaining: ${left}`);
if (left !== 0) failures += 1;
console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);

await prisma.$disconnect();
process.exit(failures === 0 ? 0 : 1);
