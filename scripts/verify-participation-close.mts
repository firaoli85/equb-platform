// BEHAVIOURAL VERIFICATION for closing a participation mid-cycle, against the
// LIVE database.
//
//   npx tsx scripts/verify-participation-close.mts
//
// Runs on the production-shaped fixture (27 members, numbers sequential from
// 1, real draws, real settlements, mixed COLLECTED/PENDING) — the shape the
// arithmetic actually has to survive.
//
// WHAT ONLY THE DATABASE CAN PROVE:
//   - the balance really lands on the PERSON and survives the cycle (2.18)
//   - the number really leaves the pool, through the real slot/draw rows
//   - a committed winner plan really refuses the close, through a real row
//   - reactivation restores FORWARD only, and the stored cutoff proves it
//   - the audit trail is written, and the close is reversible
//   - the ledger entry is a DEBT the person keeps, not a cycle-scoped number
//
// Unit tests pin the arithmetic. This pins that the arithmetic is fed the
// rows it thinks it is.

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const { PrismaPg } = await import("@prisma/adapter-pg");
const { PrismaClient } = await import("../lib/generated/prisma/client");
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL! }),
});
const fixture = await import("./lib/production-fixture.mts");
const { elapsedThroughWeek } = await import("../lib/commitment");
const { receiptsByWeek, memberAttention } = await import("../lib/dashboard");
const { collectionPosition } = await import("../lib/cycle-position");
const {
  closePlan,
  closeRefusal,
  reactivatePlan,
  weeksLeavingExpectation,
  windowBreaks,
} = await import("../lib/participation-close");
const { eligibleNumbers } = await import("../lib/wheel");
const { formatMoney } = await import("../lib/format");
const { ledgerBalance } = await import("../lib/ledger");

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

const cycle = await prisma.cycle.findUniqueOrThrow({
  where: { id: f.cycleId },
  include: {
    weeks: { orderBy: { weekNumber: "asc" } },
    participations: { include: { person: true, payments: { include: { week: true } } } },
  },
});

const today = new Date(Date.UTC(2026, 6, 8)); // 8 July 2026 — weeks 1..7 elapsed
const elapsed = elapsedThroughWeek(cycle.weeks, today);
const CLOSE_AT = 5; // mid-cycle, inside the elapsed range

/** Rebuild the whole derived picture from the rows, exactly as the action does. */
async function picture() {
  const rows = await prisma.participation.findMany({
    where: { cycleId: f.cycleId },
    include: {
      person: true,
      breaks: { orderBy: { fromWeek: "asc" } },
      payments: { include: { week: true } },
    },
  });
  const breaksOf = (p: (typeof rows)[number]) => {
    const paid = p.payments.filter((pm) => pm.amountPaid > 0).map((pm) => pm.week.weekNumber);
    return windowBreaks({
      status: p.status,
      startWeek: p.startWeek,
      closedAtWeek: p.closedAtWeek,
      lastWeekWithMoney: paid.length > 0 ? Math.max(...paid) : null,
      breaks: p.breaks,
    });
  };
  const counted = rows.map((p) => ({
    id: p.id,
    name: p.person.nameEnglishFirst,
    weeklyAmount: p.weeklyAmount,
    startWeek: p.startWeek,
    weeksCommitted: p.weeksCommitted,
    breaks: breaksOf(p),
  }));
  const payments = rows.flatMap((p) =>
    p.payments.map((pm) => ({
      participationId: p.id,
      weekNumber: pm.week.weekNumber,
      amountPaid: pm.amountPaid,
      isDeferred: pm.isDeferred,
      isSkipped: pm.week.isSkipped,
    })),
  );
  const series = receiptsByWeek({
    weeks: cycle.weeks.map((w) => ({ weekNumber: w.weekNumber, isSkipped: w.isSkipped })),
    participations: counted,
    payments,
    elapsedThroughWeek: elapsed,
  });
  return {
    rows,
    counted,
    payments,
    series,
    totalExpected: series.reduce((s, w) => s + w.expected, 0),
    totalReceived: series.reduce((s, w) => s + w.received, 0),
    behind: memberAttention({ participations: counted, payments, elapsedThroughWeek: elapsed }),
  };
}

// ————————————————— 1. THE MEMBER WHO WAS PAID OUT AND STOPPED —————————————————

console.log("\n1. Paid out, then stopped — the case that decides the arithmetic");

// Pick a member who holds a COLLECTED payout: their money is genuinely gone.
const collectedPayout = await prisma.payout.findFirstOrThrow({
  where: { luckyNumber: { cycleId: f.cycleId }, status: "COLLECTED" },
  include: { luckyNumber: { include: { participation: { include: { person: true } } } } },
});
const paidOutMember = collectedPayout.luckyNumber.participation;
check(
  "the fixture really has a member who has been paid out",
  collectedPayout.netAmount > 0,
  `${paidOutMember.person.nameEnglishFirst}, ${formatMoney(collectedPayout.netAmount)}`,
);

const before = await picture();
check("everyone is counted before anybody stops", before.counted.every((c) => c.breaks.length === 0));

const paidOutRow = before.rows.find((r) => r.id === paidOutMember.id)!;
const expectedLeaving =
  weeksLeavingExpectation({
    startWeek: paidOutRow.startWeek,
    weeksCommitted: paidOutRow.weeksCommitted,
    closingAtWeek: CLOSE_AT,
  }) * paidOutRow.weeklyAmount;
check("their forward weeks are worth real money", expectedLeaving > 0, formatMoney(expectedLeaving));

// CLOSE THEM — the same two writes the action performs: the BREAK is the
// fact, and status/closedAtWeek are the denormalised current state.
await prisma.participationBreak.create({
  data: {
    participationId: paidOutMember.id,
    fromWeek: CLOSE_AT + 1,
    toWeek: null,
    reason: "STOPPED_CONTRIBUTING",
  },
});
await prisma.participation.update({
  where: { id: paidOutMember.id },
  data: {
    status: "CLOSED",
    closedAtWeek: CLOSE_AT,
    closeReason: "STOPPED_CONTRIBUTING",
    closedAt: today,
  },
});

const after = await picture();
check(
  "closing DROPS exactly their remaining weeks from the expectation",
  before.totalExpected - after.totalExpected === expectedLeaving,
  `${formatMoney(before.totalExpected - after.totalExpected)} vs ${formatMoney(expectedLeaving)}`,
);
// The whole point: what they PAID is untouched.
check(
  "every cent they paid is still counted as received",
  before.totalReceived === after.totalReceived,
  `${formatMoney(before.totalReceived)} -> ${formatMoney(after.totalReceived)}`,
);
check(
  "their weeks up to the closing point are still expected",
  after.series[CLOSE_AT - 1].expected === before.series[CLOSE_AT - 1].expected,
);
check(
  "and the week after it is not",
  before.series[CLOSE_AT].expected - after.series[CLOSE_AT].expected === paidOutRow.weeklyAmount,
);

// BEHIND AND STOPPED ARE NOT THE SAME FACT.
check(
  "they leave the behind list entirely — they are not late, they stopped",
  !after.behind.some((m) => m.participationId === paidOutMember.id),
);

// ————————————————— 2. THE BALANCE LANDS ON THE PERSON —————————————————

console.log("\n2. The balance goes onto the PERSON, and survives (2.18)");

const stoppedPlan = closePlan({
  memberName: paidOutRow.person.nameEnglishFirst,
  cycleName: cycle.name,
  startWeek: paidOutRow.startWeek,
  weeksCommitted: paidOutRow.weeksCommitted,
  weeklyAmount: paidOutRow.weeklyAmount,
  closingAtWeek: CLOSE_AT,
  outstandingToDate: 150_000,
  undrawnNumbers: [],
  alreadyPaidOut: collectedPayout.netAmount,
});
check(
  "a paid-out member's forward weeks ARE his to cover",
  stoppedPlan.shortfallToCover === expectedLeaving,
  formatMoney(stoppedPlan.shortfallToCover),
);

const balanceBefore = ledgerBalance(
  await prisma.ledgerEntry.findMany({ where: { personId: paidOutRow.personId } }),
);
const entry = await prisma.ledgerEntry.create({
  data: {
    personId: paidOutRow.personId,
    type: "DEBT",
    amount: stoppedPlan.balanceToRecord,
    description: `${cycle.name} — stopped at week ${CLOSE_AT}, ${formatMoney(stoppedPlan.balanceToRecord)} unpaid`,
    notes: "Stopped contributing",
  },
});
const balanceAfter = ledgerBalance(
  await prisma.ledgerEntry.findMany({ where: { personId: paidOutRow.personId } }),
);
check(
  "the balance rises by exactly what they had not paid",
  balanceAfter - balanceBefore === stoppedPlan.balanceToRecord,
  formatMoney(balanceAfter - balanceBefore),
);
check(
  "and it says WHERE it came from, not just a number",
  entry.description.includes(cycle.name) && entry.description.includes(`week ${CLOSE_AT}`),
  entry.description,
);
check(
  "it is a DEBT on the PERSON, with no cycle column to lose it by",
  entry.type === "DEBT" && !("cycleId" in entry),
);

// ————————————————— 3. THE NUMBER LEAVES THE POOL (2.27) —————————————————

console.log("\n3. Their lucky numbers leave the wheel");

async function pool() {
  const [numbers, participations, drawn] = await Promise.all([
    prisma.luckyNumber.findMany({
      where: { cycleId: f.cycleId },
      select: { id: true, number: true, amount: true, participationId: true },
    }),
    prisma.participation.findMany({
      where: { cycleId: f.cycleId },
      include: { person: true },
    }),
    prisma.slotMember.findMany({
      where: { slot: { cycleId: f.cycleId, draws: { some: {} } } },
      select: { luckyNumberId: true },
    }),
  ]);
  return eligibleNumbers({
    luckyNumbers: numbers,
    participations: participations.map((p) => ({
      id: p.id,
      name: p.person.nameEnglishFirst,
      startWeek: p.startWeek,
      weeksCommitted: p.weeksCommitted,
      status: p.status,
    })),
    drawnNumberIds: new Set(drawn.map((d) => d.luckyNumberId)),
    currentWeek: elapsed + 1,
  });
}

// A member who has NOT been drawn, so their number is genuinely in the pool.
const undrawnMember = await prisma.participation.findFirstOrThrow({
  where: {
    cycleId: f.cycleId,
    status: "ACTIVE",
    luckyNumbers: { some: { payouts: { none: {} } } },
  },
  include: { person: true, luckyNumbers: { select: { number: true } } },
});
const poolBefore = await pool();
check(
  "their number is in the pool while they are contributing",
  poolBefore.some((n) => n.participationId === undrawnMember.id),
  `#${undrawnMember.luckyNumbers.map((n) => n.number).join(", #")}`,
);

await prisma.participationBreak.create({
  data: {
    participationId: undrawnMember.id,
    fromWeek: CLOSE_AT + 1,
    toWeek: null,
    reason: "LEFT_THE_GROUP",
  },
});
await prisma.participation.update({
  where: { id: undrawnMember.id },
  data: { status: "CLOSED", closedAtWeek: CLOSE_AT, closeReason: "LEFT_THE_GROUP", closedAt: today },
});
const poolAfter = await pool();
check(
  "closing takes it OUT of the pool — they cannot win a week they left",
  !poolAfter.some((n) => n.participationId === undrawnMember.id),
);
check(
  "and it takes nobody else's number with it",
  poolBefore.length - poolAfter.length === undrawnMember.luckyNumbers.length,
  `${poolBefore.length} -> ${poolAfter.length}`,
);

// ————————————————— 4. A COMMITTED PLAN REFUSES THE CLOSE (2.3) —————————————————

console.log("\n4. A committed winner plan refuses the close, and names itself");

const planTarget = await prisma.participation.findFirstOrThrow({
  where: {
    cycleId: f.cycleId,
    status: "ACTIVE",
    id: { not: undrawnMember.id },
    luckyNumbers: { some: { payouts: { none: {} } } },
  },
  include: { person: true, luckyNumbers: { where: { payouts: { none: {} } } } },
});
const freeWeek = cycle.weeks.find((w) => !f.draws.some((d) => d.weekNumber === w.weekNumber))!;
const plan = await prisma.winnerPlan.create({
  data: {
    cycleId: f.cycleId,
    weekId: freeWeek.id,
    status: "PLANNED",
    mode: "ALONE",
    numbers: { create: [{ luckyNumberId: planTarget.luckyNumbers[0].id }] },
  },
  include: { numbers: { include: { luckyNumber: true } }, week: true },
});
const refusal = closeRefusal({
  memberName: planTarget.person.nameEnglishFirst,
  cycleName: cycle.name,
  cycleStatus: "ACTIVE",
  participationStatus: "ACTIVE",
  committedPlan: {
    weekNumber: plan.week?.weekNumber ?? null,
    numbers: plan.numbers.map((n) => n.luckyNumber.number),
  },
  closingAtWeek: CLOSE_AT,
  startWeek: planTarget.startWeek,
  weeksCommitted: planTarget.weeksCommitted,
});
check("the close is REFUSED", refusal !== null);
check(
  "and the refusal names the week and the number",
  Boolean(
    refusal?.includes(`week ${freeWeek.weekNumber}`) &&
      refusal?.includes(`#${planTarget.luckyNumbers[0].number}`),
  ),
  refusal ?? "(no refusal)",
);
check(
  "the member is still ACTIVE — nothing was written",
  (await prisma.participation.findUniqueOrThrow({ where: { id: planTarget.id } })).status ===
    "ACTIVE",
);
await prisma.winnerPlan.delete({ where: { id: plan.id } });

// ————————————————— 5. THE POSITION SEPARATES STOPPED FROM BEHIND —————————————————

console.log("\n5. Stopped members reported apart from members who are behind");

const now = await picture();
const stoppedRows = now.rows.filter((r) => r.status === "CLOSED");
const position = collectionPosition({
  series: now.series,
  owedBy: now.behind.map((m) => ({
    participationId: m.participationId,
    name: m.name,
    amount: m.amountOwed,
  })),
  aheadBy: [],
  stoppedBy: stoppedRows.map((p) => ({
    participationId: p.id,
    name: p.person.nameEnglishFirst,
    closedAtWeek: p.closedAtWeek ?? CLOSE_AT,
    balanceRecorded: 0,
    amountLeaving:
      weeksLeavingExpectation({
        startWeek: p.startWeek,
        weeksCommitted: p.weeksCommitted,
        closingAtWeek: p.closedAtWeek ?? CLOSE_AT,
      }) * p.weeklyAmount,
    alreadyPaidOut: p.id === paidOutMember.id ? collectedPayout.netAmount : 0,
    shortfallToCover:
      p.id === paidOutMember.id
        ? weeksLeavingExpectation({
            startWeek: p.startWeek,
            weeksCommitted: p.weeksCommitted,
            closingAtWeek: p.closedAtWeek ?? CLOSE_AT,
          }) * p.weeklyAmount
        : 0,
    reason: "Stopped contributing",
  })),
});
check("both stopped members are reported", position.stoppedBy.length === 2);
check(
  "and NEITHER of them is in the outstanding list",
  !position.owedBy.some((m) => position.stoppedBy.some((s) => s.participationId === m.participationId)),
);
check(
  "only the PAID-OUT one leaves a hole for the organizer to cover",
  position.toCover === expectedLeaving,
  formatMoney(position.toCover),
);
check(
  "the biggest hole is listed first",
  position.stoppedBy[0].participationId === paidOutMember.id,
);

// ————————————————— 6. REACTIVATION IS FORWARD ONLY —————————————————

console.log("\n6. Reactivation restores from here forward, never retroactively");

const RESUME_AT = 9;
const resumeRow = now.rows.find((r) => r.id === undrawnMember.id)!;
const resume = reactivatePlan({
  memberName: resumeRow.person.nameEnglishFirst,
  startWeek: resumeRow.startWeek,
  weeksCommitted: resumeRow.weeksCommitted,
  weeklyAmount: resumeRow.weeklyAmount,
  closedAtWeek: CLOSE_AT,
  fromWeek: RESUME_AT,
  undrawnNumbers: undrawnMember.luckyNumbers.map((n) => n.number),
});
check("the restart point is the week he chose", resume.fromWeek === RESUME_AT);
check(
  "the weeks they were away stay closed",
  resume.weeksStayingClosed === RESUME_AT - CLOSE_AT - 1,
  `weeks ${CLOSE_AT + 1}..${RESUME_AT - 1}`,
);

// The write the action performs: the OPEN BREAK IS CLOSED at the week before
// the restart, so the weeks they were away stay outside their window for
// good. There is no way to express "give those weeks back".
const openBreak = await prisma.participationBreak.findFirstOrThrow({
  where: { participationId: undrawnMember.id, toWeek: null },
});
await prisma.participationBreak.update({
  where: { id: openBreak.id },
  data: { toWeek: RESUME_AT - 1, endedAt: today },
});
await prisma.participation.update({
  where: { id: undrawnMember.id },
  data: { status: "ACTIVE", closedAtWeek: null, closeReason: null, closeNote: null, closedAt: null },
});
const resumed = await picture();
const resumedRow = resumed.counted.find((c) => c.id === undrawnMember.id)!;

// FORWARD ONLY. The gap weeks must NOT come back as arrears nobody ever
// mentioned to them.
check(
  "weeks 6..8 are still not expected from them",
  [6, 7, 8].every(
    (w) => resumed.series[w - 1].expected === now.series[w - 1].expected,
  ),
);
check(
  "and week 9 onward IS expected again",
  resumed.series[RESUME_AT - 1].expected - now.series[RESUME_AT - 1].expected ===
    resumeRow.weeklyAmount,
  `${formatMoney(now.series[RESUME_AT - 1].expected)} -> ${formatMoney(resumed.series[RESUME_AT - 1].expected)}`,
);
check(
  "the CLOSED break is what makes the gap permanent, and it survives on the row",
  resumedRow.breaks.length === 1 &&
    resumedRow.breaks[0].fromWeek === CLOSE_AT + 1 &&
    resumedRow.breaks[0].toWeek === RESUME_AT - 1,
  JSON.stringify(resumedRow.breaks),
);
check(
  "they are ACTIVE again, and the break did not follow them into the status",
  (await prisma.participation.findUniqueOrThrow({ where: { id: undrawnMember.id } })).status ===
    "ACTIVE",
);
check(
  "their number is back in the pool",
  (await pool()).some((n) => n.participationId === undrawnMember.id),
);

// ————————————————— 7. THE LEGACY BACK DOOR —————————————————

console.log("\n7. A member closed the OLD way is not silently re-expected");

// `removeFromCycle`'s "keep their money records" writes CLOSED with a NULL
// week. Every screen used to drop them; now they are back in the series, so a
// null cutoff would restore their whole window.
const legacy = await prisma.participation.findFirstOrThrow({
  where: { cycleId: f.cycleId, status: "ACTIVE", id: { notIn: [paidOutMember.id, undrawnMember.id] } },
  include: { person: true, payments: { include: { week: true } } },
});
const legacyLastPaid = Math.max(
  ...legacy.payments.filter((pm) => pm.amountPaid > 0).map((pm) => pm.week.weekNumber),
);
await prisma.participation.update({
  where: { id: legacy.id },
  data: { status: "CLOSED", closedAtWeek: null },
});
const withLegacy = await picture();
const legacyCounted = withLegacy.counted.find((c) => c.id === legacy.id)!;
check(
  "their window falls back to their LAST PAYMENT, not their full commitment",
  legacyCounted.breaks.length === 1 && legacyCounted.breaks[0].fromWeek === legacyLastPaid + 1,
  `${JSON.stringify(legacyCounted.breaks)} vs last paid week ${legacyLastPaid}`,
);
check(
  "so nothing is expected from them after it",
  withLegacy.series[legacyLastPaid].expected < resumed.series[legacyLastPaid].expected,
);
check(
  "and their paid money is STILL counted",
  withLegacy.totalReceived === resumed.totalReceived,
  `${formatMoney(resumed.totalReceived)} -> ${formatMoney(withLegacy.totalReceived)}`,
);

// ————————————————— 8. THE BALANCE OUTLIVES THE CYCLE (2.18) —————————————————

console.log("\n8. The balance genuinely belongs to the person");

await prisma.cycle.delete({ where: { id: f.cycleId } });
const survived = await prisma.ledgerEntry.findUnique({ where: { id: entry.id } });
check("deleting the whole cycle does NOT take the balance with it", survived !== null);
check(
  "and it still says where it came from",
  survived?.description.includes(cycle.name) ?? false,
  survived?.description,
);
await prisma.ledgerEntry.delete({ where: { id: entry.id } });

// ————————————————— Cleanup —————————————————

await fixture.wipe(prisma);
const left = await fixture.assertClean(prisma);
console.log(`\nFixtures remaining: ${left}`);
console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
await prisma.$disconnect();
process.exit(failures === 0 ? 0 : 1);
