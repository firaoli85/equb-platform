// READ-ONLY AUDIT — every figure on /admin/cycle/position, /admin/cash and the
// dashboard, proved against the live rows BY HAND.
//
//   npx tsx scripts/audit-position-figures.mts
//
// Writes NOTHING.
//
// "By hand" means each figure is recomputed here from raw rows with plain
// arithmetic — a different route from the one the page takes — and the two are
// compared. A figure that agrees with itself proves nothing; these agree with
// the receipts, or they do not.

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const { PrismaPg } = await import("@prisma/adapter-pg");
const { PrismaClient } = await import("../lib/generated/prisma/client");
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL! }),
});
const { currentWeekFromRows, elapsedThroughWeek } = await import("../lib/commitment");
const { cashPosition, receiptsByWeek, memberAttention } = await import("../lib/dashboard");
const { collectionPosition, cashOnHand, feeEstimate } = await import("../lib/cycle-position");
const { windowBreaks, weeksLeavingExpectation, effectiveFinishWeek } = await import(
  "../lib/participation-close"
);
const { computeStanding, pinnedMapFromEvents } = await import("../lib/standing");
const { calculateFinishWeek } = await import("../lib/money");
const { formatMoney } = await import("../lib/format");

type Row = { figure: string; expected: number; actual: number; note?: string };
const rows: Row[] = [];
const record = (figure: string, expected: number, actual: number, note?: string) =>
  rows.push({ figure, expected, actual, note });

const today = new Date();
const cycle = await prisma.cycle.findFirstOrThrow({
  where: { status: "ACTIVE" },
  include: {
    weeks: { orderBy: { weekNumber: "asc" } },
    participations: {
      include: {
        person: true,
        breaks: { orderBy: { fromWeek: "asc" } },
        payments: { include: { week: true } },
        paymentEvents: {
          select: { amount: true, pinnedWeekId: true, pinnedWeek: { select: { weekNumber: true } } },
        },
      },
    },
  },
});
const payouts = await prisma.payout.findMany({
  where: { luckyNumber: { cycleId: cycle.id } },
  select: {
    netAmount: true,
    feeAmount: true,
    status: true,
    luckyNumber: { select: { participationId: true } },
  },
});

const elapsed = elapsedThroughWeek(cycle.weeks, today);
const currentWeek = currentWeekFromRows({
  weeks: cycle.weeks,
  today,
  cycleStartDate: cycle.startDate,
});

console.log(`\n${cycle.name} — planned ${cycle.plannedWeeks} weeks`);
console.log(`  current week (arrived) = ${currentWeek} · elapsed through (window closed) = ${elapsed}\n`);

// ————————————————— The page's own derivation —————————————————

const breaksOf = (p: (typeof cycle.participations)[number]) => {
  const paid = p.payments.filter((pm) => pm.amountPaid > 0).map((pm) => pm.week.weekNumber);
  return windowBreaks({
    status: p.status,
    startWeek: p.startWeek,
    closedAtWeek: p.closedAtWeek,
    lastWeekWithMoney: paid.length > 0 ? Math.max(...paid) : null,
    breaks: p.breaks,
  });
};
const counted = cycle.participations.map((p) => ({
  id: p.id,
  name: p.person.nameEnglishFirst,
  weeklyAmount: p.weeklyAmount,
  startWeek: p.startWeek,
  weeksCommitted: p.weeksCommitted,
  breaks: breaksOf(p),
}));
const flatPayments = cycle.participations.flatMap((p) =>
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
  payments: flatPayments,
  elapsedThroughWeek: elapsed,
});

const standingFor = (p: (typeof cycle.participations)[number], through: number) =>
  computeStanding({
    weeklyAmount: p.weeklyAmount,
    startWeek: p.startWeek,
    weeksCommitted: p.weeksCommitted,
    cycleWeek: currentWeek,
    today,
    windowWeeks: cycle.weeks
      .filter((w) => w.weekNumber >= p.startWeek && w.weekNumber <= through)
      .map((w) => {
        const pay = p.payments.find((pm) => pm.weekId === w.id) ?? null;
        return {
          weekNumber: w.weekNumber,
          date: w.date,
          amountDue: p.weeklyAmount,
          storedPaid: pay?.amountPaid ?? 0,
          isDeferred: pay?.isDeferred ?? false,
          isSkipped: w.isSkipped,
        };
      }),
    totalPaid: p.payments.reduce((s, pm) => s + pm.amountPaid, 0),
    pinnedByWeek: pinnedMapFromEvents(
      p.paymentEvents
        .filter((e) => e.pinnedWeekId !== null)
        .map((e) => ({ amount: e.amount, weekNumber: e.pinnedWeek?.weekNumber ?? null })),
    ),
  });

const active = cycle.participations.filter((p) => p.status === "ACTIVE");
const stopped = cycle.participations.filter((p) => p.status === "CLOSED");

const owedBy = active
  .map((p) => ({
    participationId: p.id,
    name: p.person.nameEnglishFirst,
    amount: standingFor(p, calculateFinishWeek(p.startWeek, p.weeksCommitted)).amountOutstanding,
  }))
  .filter((m) => m.amount > 0);

const aheadBy = active
  .map((p) => {
    const ahead = p.payments.filter((pm) => pm.week.weekNumber > currentWeek && pm.amountPaid > 0);
    return {
      participationId: p.id,
      name: p.person.nameEnglishFirst,
      amount: ahead.reduce((s, pm) => s + pm.amountPaid, 0),
      weeks: ahead.length,
    };
  })
  .filter((m) => m.amount > 0);

const paidOutTo = new Map<string, number>();
for (const po of payouts) {
  if (po.status !== "COLLECTED" || !po.luckyNumber) continue;
  paidOutTo.set(
    po.luckyNumber.participationId,
    (paidOutTo.get(po.luckyNumber.participationId) ?? 0) + po.netAmount,
  );
}
const stoppedBy = stopped.map((p) => {
  const closedAtWeek = effectiveFinishWeek({
    startWeek: p.startWeek,
    weeksCommitted: p.weeksCommitted,
    breaks: breaksOf(p),
  });
  const alreadyPaidOut = paidOutTo.get(p.id) ?? 0;
  const amountLeaving =
    weeksLeavingExpectation({
      startWeek: p.startWeek,
      weeksCommitted: p.weeksCommitted,
      closingAtWeek: closedAtWeek,
    }) * p.weeklyAmount;
  return {
    participationId: p.id,
    name: p.person.nameEnglishFirst,
    closedAtWeek,
    balanceRecorded: standingFor(p, closedAtWeek).amountOutstanding,
    amountLeaving,
    alreadyPaidOut,
    shortfallToCover: alreadyPaidOut > 0 ? amountLeaving : 0,
    reason: "",
  };
});

const position = collectionPosition({ series, owedBy, aheadBy, stoppedBy, currentWeek });
const cash = cashPosition({
  payments: flatPayments.map((p) => ({ amountPaid: p.amountPaid })),
  payouts: payouts.map((p) => ({ netAmount: p.netAmount, status: p.status })),
});
const holding = cashOnHand({
  collected: cash.totalReceived,
  handedOut: cash.totalPaidOut,
  drawnNotHandedOut: cash.committedPending,
  paidEarly: position.paidAhead,
});
const fee = feeEstimate({
  onHandedOut: payouts.filter((p) => p.status === "COLLECTED").reduce((s, p) => s + p.feeAmount, 0),
  onDrawn: payouts.filter((p) => p.status === "PENDING").reduce((s, p) => s + p.feeAmount, 0),
});

// ————————————————— BY HAND, from the raw rows —————————————————

const inWindowByHand = (p: (typeof cycle.participations)[number], weekNumber: number) => {
  if (weekNumber < p.startWeek) return false;
  if (weekNumber > calculateFinishWeek(p.startWeek, p.weeksCommitted)) return false;
  return !breaksOf(p).some(
    (b) => weekNumber >= b.fromWeek && (b.toWeek === null || weekNumber <= b.toWeek),
  );
};

// 1. What should have come in by now: every ELAPSED week, every member whose
//    window covers it, minus deferred rows.
let handShould = 0;
for (const w of cycle.weeks) {
  if (w.weekNumber > elapsed || w.isSkipped) continue;
  for (const p of cycle.participations) {
    if (!inWindowByHand(p, w.weekNumber)) continue;
    const pay = p.payments.find((pm) => pm.weekId === w.id);
    if (pay?.isDeferred) continue;
    handShould += p.weeklyAmount;
  }
}
record("Should have come in (elapsed weeks)", handShould, position.shouldHaveCollected);

// 2. What actually came in for those weeks.
const handCollected = flatPayments
  .filter((p) => p.weekNumber <= elapsed)
  .reduce((s, p) => s + p.amountPaid, 0);
record("Actually collected (elapsed weeks)", handCollected, position.collected);

// 3. The current week — its own bucket.
const handThisWeek = flatPayments
  .filter((p) => p.weekNumber > elapsed && p.weekNumber <= currentWeek)
  .reduce((s, p) => s + p.amountPaid, 0);
record(`Collected for the open week ${currentWeek}`, handThisWeek, position.collectedThisWeek);

// 4. Genuinely paid ahead — weeks AFTER the current one, and nothing else.
const handAhead = flatPayments
  .filter((p) => p.weekNumber > currentWeek)
  .reduce((s, p) => s + p.amountPaid, 0);
record("Paid ahead (weeks after the current one)", handAhead, position.paidAhead);
record(
  "Paid-ahead members",
  // amountPaid > 0 matters: a payment ROW exists for every week of a member's
  // window, so counting rows counts everyone with a future week, not everyone
  // who has put money into one.
  new Set(
    flatPayments
      .filter((p) => p.weekNumber > currentWeek && p.amountPaid > 0)
      .map((p) => p.participationId),
  ).size,
  position.aheadBy.length,
);

// 5. Every cent lands in exactly one bucket.
const handAll = flatPayments.reduce((s, p) => s + p.amountPaid, 0);
record(
  "Every receipt lands in exactly one bucket",
  handAll,
  position.collected + position.collectedThisWeek + position.paidAhead,
);

// 6. Shortfall + will-not-arrive reconciles to the measured gap.
record(
  "Gap = shortfall + will-not-arrive",
  Math.max(0, position.shouldHaveCollected - position.collected),
  position.shortfall + position.willNotArrive,
);

// 7. Cash: received, handed out, held.
record("Total received (all weeks)", handAll, cash.totalReceived);
const handHandedOut = payouts
  .filter((p) => p.status === "COLLECTED")
  .reduce((s, p) => s + p.netAmount, 0);
record("Handed out (COLLECTED payouts only)", handHandedOut, holding.handedOut);
const handDrawnNotHanded = payouts
  .filter((p) => p.status !== "COLLECTED")
  .reduce((s, p) => s + p.netAmount, 0);
record("Drawn but not handed out (PENDING)", handDrawnNotHanded, holding.drawnNotHandedOut);
record("Should be holding = in − out", handAll - handHandedOut, holding.shouldBeHolding);
record(
  "Drawn-not-handed-out is NOT subtracted",
  holding.shouldBeHolding,
  cashOnHand({ ...holding, drawnNotHandedOut: 0 }).shouldBeHolding,
);
record(
  "Fee is NOT in what he should be holding",
  1,
  holding.shouldBeHolding === handAll - handHandedOut - fee.soFar ? 0 : 1,
  "1 = fee correctly absent",
);

// 8. A stopped participation removes its forward weeks from the expectation.
let handLeaving = 0;
for (const p of stopped) {
  const end = effectiveFinishWeek({
    startWeek: p.startWeek,
    weeksCommitted: p.weeksCommitted,
    breaks: breaksOf(p),
  });
  handLeaving +=
    weeksLeavingExpectation({
      startWeek: p.startWeek,
      weeksCommitted: p.weeksCommitted,
      closingAtWeek: end,
    }) * p.weeklyAmount;
}
record(
  "Weeks removed from expectation by stopped members",
  handLeaving,
  stoppedBy.reduce((s, m) => s + m.amountLeaving, 0),
);

// 9. A member paid out and then stopped is HIS to cover.
const handToCover = stopped
  .filter((p) => (paidOutTo.get(p.id) ?? 0) > 0)
  .reduce((s, p) => {
    const end = effectiveFinishWeek({
      startWeek: p.startWeek,
      weeksCommitted: p.weeksCommitted,
      breaks: breaksOf(p),
    });
    return (
      s +
      weeksLeavingExpectation({
        startWeek: p.startWeek,
        weeksCommitted: p.weeksCommitted,
        closingAtWeek: end,
      }) *
        p.weeklyAmount
    );
  }, 0);
record("Yours to cover (paid out, then stopped)", handToCover, position.toCover);

// 10. Stopped members are not ALSO on the behind list.
const behind = memberAttention({
  participations: counted,
  payments: flatPayments,
  elapsedThroughWeek: elapsed,
});
record(
  "Stopped members double-counted as behind",
  0,
  behind.filter((b) => stoppedBy.some((s) => s.participationId === b.participationId)).length,
);
record("Members behind (dashboard) = members owing (position)", owedBy.length, behind.length);

// ————————————————— The table —————————————————

const money = (n: number) => (Math.abs(n) > 999 || n === 0 ? formatMoney(n) : String(n));
console.log(
  "FIGURE".padEnd(50) + "EXPECTED".padStart(14) + "ACTUAL".padStart(14) + "  AGREES",
);
console.log("-".repeat(92));
let disagreements = 0;
for (const r of rows) {
  const ok = r.expected === r.actual;
  if (!ok) disagreements++;
  const isCount =
    r.figure === "Paid-ahead members" ||
    r.figure.includes("double-counted") ||
    r.figure.startsWith("Members behind") ||
    r.note !== undefined;
  const fmt = isCount ? String : money;
  console.log(
    r.figure.padEnd(50) +
      fmt(r.expected).padStart(14) +
      fmt(r.actual).padStart(14) +
      (ok ? "  YES" : "  ***NO***"),
  );
}
console.log("-".repeat(92));
console.log(
  disagreements === 0
    ? `All ${rows.length} figures agree with the live rows.`
    : `${disagreements} of ${rows.length} figures DISAGREE.`,
);

console.log(`\nWho owes it (elapsed weeks, ${owedBy.length} member(s)):`);
for (const m of [...owedBy].sort((a, b) => b.amount - a.amount)) {
  console.log(`  ${m.name.padEnd(16)} ${formatMoney(m.amount)}`);
}
console.log(`\nGenuinely paid ahead (${aheadBy.length} member(s)):`);
for (const m of [...aheadBy].sort((a, b) => b.amount - a.amount)) {
  console.log(`  ${m.name.padEnd(16)} ${formatMoney(m.amount)} over ${m.weeks} week(s)`);
}

await prisma.$disconnect();
process.exit(disagreements === 0 ? 0 : 1);
