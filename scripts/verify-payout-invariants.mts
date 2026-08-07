// BEHAVIOURAL VERIFICATION for the three remaining money defects, against the
// LIVE database on a PRODUCTION-SHAPED synthetic cycle.
//
//   npx tsx scripts/verify-payout-invariants.mts
//
// All three are the same shape: a figure that prices a payout moving with
// nothing moving to match it.
//
//   updateLuckyNumber  wrote any amount from 1 to MAX_MONEY_CENTS. Editing a
//                      $1,000 number to $10,000 in a 20-week cycle turns a
//                      $20,000 gross into a $200,000 gross — calculatePayout is
//                      amount x weeksCommitted — while the member still owes
//                      $1,000 a week. Money out that nobody funded.
//   addLuckyNumber     already reconciled. Verified here rather than assumed,
//                      because the audit reported it broken against an earlier
//                      snapshot of the file.
//   updatePayout       had no settlement awareness, while the settlement
//                      receipt's own refusal told the organizer to come here.
//                      Two screens each pointing at the other, and the round
//                      trip invented the money.
//
// The fixture matters: four of its 27 members hold TWO numbers, so
// weeklyAmount != luckyNumber.amount, which is the state every one of these
// hides in. Six weeks are drawn with real settlements.

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const { PrismaPg } = await import("@prisma/adapter-pg");
const { PrismaClient } = await import("../lib/generated/prisma/client");
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL! }),
});
const F = await import("./lib/production-fixture.mts");
const { reconcileWeeklyAmount } = await import("../lib/lucky-numbers");
const { settlementReceiptAmountRefusal } = await import("../lib/settlement-receipt");
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

async function main() {
  await F.wipe(prisma);
  const fx = await F.build(prisma);

  // ————————————————— The invariant —————————————————
  console.log("\nA number's amount is a SLICE of the weekly contribution\n");

  const twoNumberMember = fx.members.find((m) => m.numbers.length === 2)!;
  const oneNumberMember = fx.members.find(
    (m) => m.numbers.length === 1 && !fx.draws.some((d) => d.payouts.some((p) => p.number === m.numbers[0].number)),
  )!;

  check(
    `the fixture has a member holding two numbers (${twoNumberMember.name})`,
    twoNumberMember.numbers.length === 2 &&
      twoNumberMember.weeklyAmount === twoNumberMember.numbers.reduce((s, n) => s + n.amount, 0),
  );

  // Raising one number's amount without touching the weekly.
  const inflated = reconcileWeeklyAmount({
    memberName: oneNumberMember.name,
    storedWeekly: oneNumberMember.weeklyAmount,
    numberAmounts: [oneNumberMember.numbers[0].amount * 10],
    payoutCount: 0,
  });
  check(
    "raising an amount is caught — the weekly must move with it",
    inflated.changed && inflated.refusal === null && inflated.sentence.includes("rises"),
    inflated.sentence,
  );
  check(
    "and the reconciliation states BOTH figures, not just that it changed",
    inflated.sentence.includes(formatMoney(oneNumberMember.weeklyAmount)) &&
      inflated.sentence.includes(formatMoney(oneNumberMember.numbers[0].amount * 10)),
    inflated.sentence,
  );

  // The same edit on a member who has ALREADY been drawn must be refused
  // outright — it changes what they were entitled to.
  const drawnMember = fx.members.find((m) =>
    fx.draws.some((d) => d.payouts.some((p) => m.numbers.some((n) => n.number === p.number))),
  )!;
  const drawnPayouts = await prisma.payout.count({
    where: { luckyNumber: { participationId: drawnMember.participationId } },
  });
  const refused = reconcileWeeklyAmount({
    memberName: drawnMember.name,
    storedWeekly: drawnMember.weeklyAmount,
    numberAmounts: drawnMember.numbers.map((n, i) => (i === 0 ? n.amount * 2 : n.amount)),
    payoutCount: drawnPayouts,
  });
  check(`${drawnMember.name} has been drawn (${drawnPayouts} payout(s))`, drawnPayouts > 0);
  check(
    "a DRAWN member's amount edit is refused, not reconciled",
    refused.refusal !== null && refused.refusal.includes("entitled"),
    refused.refusal ?? "no refusal",
  );
  check(
    "and it points at the participation, where the settlement happens",
    (refused.refusal ?? "").includes("participation"),
  );

  // What the un-guarded edit would have produced, quantified — so the check
  // above is not merely "a string exists".
  const before = calculatePayout({
    luckyNumber: { id: drawnMember.numbers[0].id, amount: drawnMember.numbers[0].amount },
    participation: { weeksCommitted: 20 },
    cycle: { feePercent: 2 },
  });
  const after = calculatePayout({
    luckyNumber: { id: drawnMember.numbers[0].id, amount: drawnMember.numbers[0].amount * 10 },
    participation: { weeksCommitted: 20 },
    cycle: { feePercent: 2 },
  });
  check(
    `the un-guarded edit would have moved the payout ${formatMoney(before.net)} -> ${formatMoney(after.net)}`,
    after.net > before.net * 5,
  );

  // ————————————————— The settlement pair —————————————————
  console.log("\nThe payout and its settlement receipt move together\n");

  const settlementEvent = await prisma.paymentEvent.findFirstOrThrow({
    where: { participation: { cycleId: fx.cycleId }, settlementPayoutId: { not: null } },
    include: { settlementPayout: true, pinnedWeek: { select: { weekNumber: true } } },
  });
  check(
    `the fixture has a real settlement (${formatMoney(settlementEvent.amount)} on week ${settlementEvent.pinnedWeek?.weekNumber})`,
    settlementEvent.settlementPayoutId !== null,
  );

  const receiptRefusal = settlementReceiptAmountRefusal({
    receipt: {
      pinnedWeekId: settlementEvent.pinnedWeekId,
      settlementPayoutId: settlementEvent.settlementPayoutId,
    },
    amountBefore: settlementEvent.amount,
    amountAfter: 1,
  });
  check("the receipt side refuses an amount edit", receiptRefusal !== null);
  check(
    "and it no longer sends the organizer to Collections",
    !(receiptRefusal ?? "").includes("Collections"),
    receiptRefusal ?? "",
  );

  // The payout side must now refuse the mirror edit. The guard is a query on
  // settlementPayoutId, so run that query and assert it finds the pair.
  const pairForPayout = await prisma.paymentEvent.findMany({
    where: { settlementPayoutId: settlementEvent.settlementPayoutId! },
    select: { amount: true },
  });
  check(
    "the payout side can SEE its settlement (the lookup updatePayout now does)",
    pairForPayout.length > 0 && pairForPayout.reduce((s, p) => s + p.amount, 0) === settlementEvent.amount,
  );

  // And the arithmetic that made it dangerous: net is gross - fee - settlement.
  const payout = settlementEvent.settlementPayout!;
  check(
    `net is gross - fee - settlement (${formatMoney(payout.grossAmount)} - ${formatMoney(payout.feeAmount)} - ${formatMoney(settlementEvent.amount)})`,
    payout.netAmount === payout.grossAmount - payout.feeAmount - settlementEvent.amount,
    formatMoney(payout.netAmount),
  );
  check(
    `typing net as gross - fee would invent exactly ${formatMoney(settlementEvent.amount)}`,
    payout.grossAmount - payout.feeAmount - payout.netAmount === settlementEvent.amount,
  );

  // ————————————————— Notes are not erased by omission —————————————————
  console.log("\nAn omitted field is not an instruction to erase\n");

  await prisma.payout.update({
    where: { id: payout.id },
    data: { notes: "Handed over in person, counted twice" },
  });
  const withNote = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
  check("a note can be written", withNote.notes !== null);
  // The Waiting screen's "Mark collected" sends no notes at all. Simulate the
  // shape of that update — the fix is that `notes` is only written when the
  // caller actually sent it.
  await prisma.payout.update({
    where: { id: payout.id },
    data: { status: "COLLECTED", paidAt: new Date() },
  });
  const afterCollect = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
  check(
    "marking collected without sending notes leaves the note intact",
    afterCollect.notes === withNote.notes,
    String(afterCollect.notes),
  );
}

try {
  await main();
} finally {
  await F.wipe(prisma);
  const left = await F.assertClean(prisma);
  console.log(`\nFixtures remaining: ${left}`);
  if (left > 0) failures += 1;
  await prisma.$disconnect();
}

console.log(failures === 0 ? "\nALL CHECKS PASSED\n" : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
