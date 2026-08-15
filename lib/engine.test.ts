import { describe, expect, it } from "vitest";
import { weekReceipts } from "./dashboard";
import { amountOutstanding, weekCountsAsDue } from "./derived";
import {
  cashExpected,
  describePayment,
  memberTruth,
  weekLabel,
  weekShortfall,
  type MemberTruthInput,
} from "./engine";
import { computeStanding } from "./standing";

// THE ENGINE EARNS TRUST HERE (2.24).
//
// Every expected figure below is a LITERAL, worked out by hand from the member
// state above it. A figure derived by calling the thing under test would pass
// whatever the engine did, which is the shape of test that let both §1 bugs
// ship (§5.7).

const WEEKLY = 200_000; // $2,000
const FEE_PERCENT = 2.0;

/** Weeks run Sundays from 3 May 2026; window closes 5 days later. */
function weekDate(n: number): Date {
  return new Date(Date.UTC(2026, 4, 3 + (n - 1) * 7));
}

function week(
  n: number,
  over: Partial<{ storedPaid: number; isDeferred: boolean; isSkipped: boolean; markedLate: boolean }> = {},
) {
  return {
    weekNumber: n,
    date: weekDate(n),
    amountDue: WEEKLY,
    storedPaid: 0,
    isDeferred: false,
    isSkipped: false,
    markedLate: false,
    ...over,
  };
}

function truthFor(
  over: Partial<MemberTruthInput> & { windowWeeks: MemberTruthInput["windowWeeks"] },
) {
  return memberTruth({
    participationId: "p1",
    weeklyAmount: WEEKLY,
    startWeek: 1,
    weeksCommitted: 20,
    today: new Date(Date.UTC(2026, 7, 15)),
    totalPaid: 0,
    feePercent: FEE_PERCENT,
    ...over,
  });
}

describe("the status PAIR — money and calendar, never one word (§3.0 rule 1)", () => {
  const base = { deferred: false, skipped: false, markedLate: false };
  it("fully paid reads PAID whenever it arrived", () => {
    expect(weekLabel({ ...base, money: "paid", windowClosed: true })).toBe("PAID");
    expect(weekLabel({ ...base, money: "paid", windowClosed: false })).toBe("PAID");
  });
  it("part paid with the window OPEN is PARTIAL — the rest is still expected", () => {
    expect(weekLabel({ ...base, money: "part", windowClosed: false })).toBe("PARTIAL");
  });
  it("part paid with the window CLOSED is PARTIAL_LATE — the sixth state R2 ruled", () => {
    expect(weekLabel({ ...base, money: "part", windowClosed: true })).toBe("PARTIAL_LATE");
  });
  it("unpaid and closed is LATE; unpaid and open is UPCOMING", () => {
    expect(weekLabel({ ...base, money: "none", windowClosed: true })).toBe("LATE");
    expect(weekLabel({ ...base, money: "none", windowClosed: false })).toBe("UPCOMING");
  });
  it("the organizer's mark chases an OPEN week without the calendar (2.2)", () => {
    expect(weekLabel({ ...base, money: "none", windowClosed: false, markedLate: true })).toBe("LATE");
    expect(weekLabel({ ...base, money: "part", windowClosed: false, markedLate: true })).toBe(
      "PARTIAL_LATE",
    );
  });
  it("deferral outranks the mark and the calendar (2.29), and money outranks deferral", () => {
    expect(weekLabel({ ...base, money: "none", windowClosed: true, deferred: true })).toBe("DEFERRED");
    expect(weekLabel({ ...base, money: "part", windowClosed: true, deferred: true, markedLate: true })).toBe(
      "DEFERRED",
    );
    expect(weekLabel({ ...base, money: "paid", windowClosed: true, deferred: true })).toBe("PAID");
  });
  it("a skipped week owes nothing and says so", () => {
    expect(weekLabel({ ...base, money: "none", windowClosed: true, skipped: true })).toBe("SKIPPED");
  });
});

describe("known member states — figures as literals", () => {
  it("FULLY PAID: 8 elapsed weeks, all covered", () => {
    const t = truthFor({
      windowWeeks: Array.from({ length: 8 }, (_, i) => week(i + 1, { storedPaid: WEEKLY })),
      totalPaid: 8 * WEEKLY, // $16,000
    });
    expect(t.amountOutstanding).toBe(0);
    expect(t.amountDeferred).toBe(0);
    expect(t.weeksBehind).toBe(0);
    expect(t.weeksPaid).toBe(8);
    expect(t.expectedByNow).toBe(8 * WEEKLY);
    expect(t.paidUpToWeek).toBe(8);
    expect(t.weeks.every((w) => w.label === "PAID")).toBe(true);
  });

  it("THE FIRAOLI CASE: week 14 part paid $200 of $2,000, window CLOSED", () => {
    // Thirteen weeks paid in full, then $200 on week 14. Week 14 opened
    // 2 Aug 2026 and closed 7 Aug; today is 15 Aug, so it is closed.
    const t = truthFor({
      windowWeeks: [
        ...Array.from({ length: 13 }, (_, i) => week(i + 1, { storedPaid: WEEKLY })),
        week(14, { storedPaid: 20_000 }),
      ],
      totalPaid: 13 * WEEKLY + 20_000, // $26,200
    });
    const w14 = t.weeks.find((w) => w.weekNumber === 14)!;
    expect(w14.money).toBe("part");
    expect(w14.windowClosed).toBe(true);
    expect(w14.label).toBe("PARTIAL_LATE");
    // THE FIGURE THE MESSAGE MUST NAME. $2,000 − $200 = $1,800.
    expect(w14.remainder).toBe(180_000);
    expect(t.amountOutstanding).toBe(180_000);
    expect(t.weeksPaid).toBe(13);
    expect(t.paidUpToWeek).toBe(13);
  });

  it("PARTIAL, WINDOW OPEN: same money, week not yet closed — not late", () => {
    // Today is 5 Aug: week 14 opened 2 Aug and closes 7 Aug.
    const t = truthFor({
      today: new Date(Date.UTC(2026, 7, 5)),
      windowWeeks: [
        ...Array.from({ length: 13 }, (_, i) => week(i + 1, { storedPaid: WEEKLY })),
        week(14, { storedPaid: 20_000 }),
      ],
      totalPaid: 13 * WEEKLY + 20_000,
    });
    const w14 = t.weeks.find((w) => w.weekNumber === 14)!;
    expect(w14.label).toBe("PARTIAL");
    expect(w14.remainder).toBe(180_000);
    // NOT YET OWED: the window is open, so it is not in the current expectation.
    expect(t.amountOutstanding).toBe(0);
    expect(t.weeksBehind).toBe(0);
  });

  it("DEFERRED is not counted now, and is not forgotten (D-42)", () => {
    // Weeks 1-6 paid, weeks 7 and 8 elapsed: 7 deferred, 8 simply unpaid.
    const t = truthFor({
      windowWeeks: [
        ...Array.from({ length: 6 }, (_, i) => week(i + 1, { storedPaid: WEEKLY })),
        week(7, { isDeferred: true }),
        week(8),
      ],
      totalPaid: 6 * WEEKLY, // $12,000
    });
    // Week 8 alone is owed now. Week 7's $2,000 is HELD, not owed and not gone.
    expect(t.amountOutstanding).toBe(WEEKLY);
    expect(t.amountDeferred).toBe(WEEKLY);
    // Behind counts week 8 only: deferred leaves the current expectation.
    expect(t.weeksBehind).toBe(1);
    expect(t.expectedByNow).toBe(7 * WEEKLY); // 8 elapsed − 1 deferred
    expect(t.weeks.find((w) => w.weekNumber === 7)!.label).toBe("DEFERRED");
    expect(t.weeks.find((w) => w.weekNumber === 8)!.label).toBe("LATE");
  });

  it("a later payment FILLS the deferred week first — oldest first (rule 3)", () => {
    // Same member, now $2,000 more. It must land on week 7 (the oldest hole),
    // not on week 8, and week 7 must stop being deferred money.
    const t = truthFor({
      windowWeeks: [
        ...Array.from({ length: 6 }, (_, i) => week(i + 1, { storedPaid: WEEKLY })),
        week(7, { isDeferred: true }),
        week(8),
      ],
      totalPaid: 7 * WEEKLY, // $14,000
    });
    expect(t.weeks.find((w) => w.weekNumber === 7)!.money).toBe("paid");
    expect(t.weeks.find((w) => w.weekNumber === 7)!.label).toBe("PAID");
    expect(t.amountDeferred).toBe(0);
    // Week 8 is still owed.
    expect(t.amountOutstanding).toBe(WEEKLY);
  });

  it("A MID-CYCLE JOINER owes nothing for the weeks before they joined", () => {
    // Starts week 10, committed 6 weeks. Weeks 10-12 elapsed, none paid.
    const t = truthFor({
      startWeek: 10,
      weeksCommitted: 6,
      windowWeeks: [10, 11, 12, 13, 14, 15].map((n) => week(n)),
      totalPaid: 0,
    });
    expect(t.finishWeek).toBe(15);
    // All six of weeks 10-15 have closed by 15 Aug: week 15 opened 9 Aug and
    // its 5-day window shut on the 14th.
    expect(t.amountOutstanding).toBe(6 * WEEKLY); // $12,000
    expect(t.weeksBehind).toBe(6);
    expect(t.weeks[0].ownWeekNumber).toBe(1);
  });

  it("PAID AHEAD: money on weeks that have not happened", () => {
    // Six weeks elapsed and paid, plus two future weeks covered.
    const t = truthFor({
      windowWeeks: Array.from({ length: 20 }, (_, i) => week(i + 1)),
      totalPaid: 17 * WEEKLY,
    });
    expect(t.amountOutstanding).toBe(0);
    expect(t.weeksBehind).toBe(0);
    expect(t.weeksPaid).toBe(17);
    // A future week that is covered reads PAID, not UPCOMING.
    expect(t.weeks.find((w) => w.weekNumber === 17)!.label).toBe("PAID");
    expect(t.weeks.find((w) => w.weekNumber === 18)!.label).toBe("UPCOMING");
  });

  it("A STOPPED member's shortened window owes only its own weeks", () => {
    // Closed at week 12: the caller passes the truncated window, and the
    // engine never invents weeks it was not given.
    const t = truthFor({
      weeksCommitted: 20,
      windowWeeks: Array.from({ length: 12 }, (_, i) => week(i + 1, { storedPaid: WEEKLY })),
      totalPaid: 12 * WEEKLY,
    });
    expect(t.amountOutstanding).toBe(0);
    expect(t.missingWeekRows).toBe(8); // honest about the gap, never composes over it
  });

  it("the fee and payout follow the COMMITMENT, not attendance (2.30)", () => {
    const t = truthFor({ windowWeeks: [week(1)], totalPaid: 0 });
    expect(t.grossProjected).toBe(20 * WEEKLY); // $40,000
    expect(t.feeProjected).toBe(80_000); // 2% of $40,000 = $800
    expect(t.payoutNet).toBe(20 * WEEKLY - 80_000); // $39,200
  });
});

describe("remainders ROLL FORWARD — nothing is forgotten because a week passed (rule 2)", () => {
  it("$300 left on week 4 plus an unpaid week 5 is $800 behind, not $500", () => {
    const W = 50_000; // $500 a week
    const t = memberTruth({
      participationId: "p1",
      weeklyAmount: W,
      startWeek: 1,
      weeksCommitted: 20,
      today: new Date(Date.UTC(2026, 7, 15)),
      feePercent: FEE_PERCENT,
      windowWeeks: [1, 2, 3, 4, 5].map((n) => ({
        weekNumber: n,
        date: weekDate(n),
        amountDue: W,
        storedPaid: 0,
        isDeferred: false,
        isSkipped: false,
        markedLate: false,
      })),
      // Weeks 1-3 fully paid, $200 of week 4. Nothing on week 5.
      totalPaid: 3 * W + 20_000,
    });
    expect(t.weeks.find((w) => w.weekNumber === 4)!.remainder).toBe(30_000); // $300
    expect(t.weeks.find((w) => w.weekNumber === 5)!.remainder).toBe(50_000); // $500
    expect(t.amountOutstanding).toBe(80_000); // $800 — the rolled total
  });
});

describe("THE PAYMENT EVENT — what the money did (§3.7)", () => {
  const weeksBefore = (covered: number[]) =>
    covered.map((c, i) => ({
      weekNumber: i + 1,
      date: weekDate(i + 1),
      amountDue: WEEKLY,
      covered: c,
      isDeferred: false,
    }));

  it("names a week paid in full, and the week left part paid, with the remainder", () => {
    // Owed weeks 1 and 2 in full; pays $3,000. Week 1 fills, week 2 gets $1,000.
    const e = describePayment({
      amount: 300_000,
      today: new Date(Date.UTC(2026, 7, 15)),
      weeklyAmount: WEEKLY,
      weeksBefore: weeksBefore([0, 0]),
      weeksBehindAfter: 1,
    });
    expect(e.fullWeeks).toEqual([1]);
    expect(e.partialWeek).toBe(2);
    expect(e.remainder).toBe(100_000); // $1,000 still due on week 2
    expect(e.completedWeeks).toEqual([]);
    expect(e.nowCurrent).toBe(false);
  });

  it("distinguishes COMPLETING a prior partial from paying a week outright", () => {
    // Week 1 already has $500 on it; $1,500 finishes it.
    const e = describePayment({
      amount: 150_000,
      today: new Date(Date.UTC(2026, 7, 15)),
      weeklyAmount: WEEKLY,
      weeksBefore: weeksBefore([50_000, 0]),
      weeksBehindAfter: 1,
    });
    expect(e.completedWeeks).toEqual([1]);
    expect(e.fullWeeks).toEqual([]);
    expect(e.partialWeek).toBeNull();
    expect(e.remainder).toBe(0);
  });

  it("names the forward weeks when a payment runs ahead", () => {
    // Weeks 1-14 are due by 15 Aug; paying for 16 weeks reaches weeks 15-16.
    const e = describePayment({
      amount: 16 * WEEKLY,
      today: new Date(Date.UTC(2026, 7, 15)),
      weeklyAmount: WEEKLY,
      weeksBefore: Array.from({ length: 20 }, (_, i) => ({
        weekNumber: i + 1,
        date: weekDate(i + 1),
        amountDue: WEEKLY,
        covered: 0,
        isDeferred: false,
      })),
      weeksBehindAfter: 0,
    });
    expect(e.fullWeeks).toHaveLength(16);
    expect(e.aheadWeeks).toEqual([16]); // week 15 closed 14 Aug; 16 has not
    expect(e.nowCurrent).toBe(true);
    expect(e.partialWeek).toBeNull();
  });

  it("fills the oldest DEFERRED week before anything newer (rule 3)", () => {
    const e = describePayment({
      amount: WEEKLY,
      today: new Date(Date.UTC(2026, 7, 15)),
      weeklyAmount: WEEKLY,
      weeksBefore: [
        { weekNumber: 1, date: weekDate(1), amountDue: WEEKLY, covered: 0, isDeferred: true },
        { weekNumber: 2, date: weekDate(2), amountDue: WEEKLY, covered: 0, isDeferred: false },
      ],
      weeksBehindAfter: 1,
    });
    expect(e.fullWeeks).toEqual([1]); // the deferred week, not week 2
  });

  it("reports money that fits nowhere rather than swallowing it", () => {
    const e = describePayment({
      amount: 3 * WEEKLY,
      today: new Date(Date.UTC(2026, 7, 15)),
      weeklyAmount: WEEKLY,
      weeksBefore: weeksBefore([0]),
      weeksBehindAfter: 0,
    });
    expect(e.unallocated).toBe(2 * WEEKLY);
  });
});

// ————————————————— THE TWO RECONCILIATION TESTS —————————————————
//
// Pass 3 Part B: these are the tests whose ABSENCE let both §1 bugs ship. Each
// asserts BOTH that the old path gets it wrong and that the engine gets it
// right, so the proof is permanent rather than a claim made once.

describe("RECONCILIATION 1 — an out-of-window overpayer cannot mask a shortfall", () => {
  // THE FIXTURE THAT WAS NEVER BUILT. lib/dashboard.test.ts has three tests
  // over `weekReceipts` asserting `shortfall`, and in every one the payers are
  // IN window at the week under test — so none of them can fail on the defect.
  //
  // Two members, week 12:
  //   Abebe   — in window, owes $2,000, has paid nothing for week 12.
  //   Bereket — window ENDED at week 10, but a receipt sits on week 12 for
  //             $3,000 (an edited or mis-entered row: the case the comment at
  //             lib/dashboard.ts:247 says "always counts").
  const WEEK = 12;
  const participations = [
    { id: "abebe", weeklyAmount: WEEKLY, startWeek: 1, weeksCommitted: 20 },
    { id: "bereket", weeklyAmount: WEEKLY, startWeek: 1, weeksCommitted: 10 },
  ];
  const payments = [
    { participationId: "bereket", weekNumber: WEEK, amountPaid: 300_000, isDeferred: false, isSkipped: false, markedLate: false },
  ];

  it("THE OLD PATH gets it wrong: it reports the group as short NOTHING", () => {
    const old = weekReceipts({ weekNumber: WEEK, participations, payments });
    expect(old.expected).toBe(WEEKLY); // only Abebe is in window
    // Bereket's $3,000 counts as received even though he owes nothing for it…
    expect(old.received).toBe(300_000);
    // …so the group subtraction hides Abebe's $2,000 entirely.
    expect(old.shortfall).toBe(0);
  });

  it("THE ENGINE gets it right: short is the sum of what in-window members owe", () => {
    const abebe = truthFor({
      participationId: "abebe",
      windowWeeks: Array.from({ length: 20 }, (_, i) => week(i + 1)),
      totalPaid: 11 * WEEKLY, // weeks 1-11 covered, week 12 owed in full
    });
    const bereket = truthFor({
      participationId: "bereket",
      weeksCommitted: 10,
      windowWeeks: Array.from({ length: 10 }, (_, i) => week(i + 1, { storedPaid: WEEKLY })),
      totalPaid: 13 * WEEKLY, // overpaid, beyond his whole window
    });
    // Bereket has no week 12 at all, so he contributes nothing to it — the
    // per-member cap is structural, not a clamp bolted on afterwards.
    expect(bereket.weeks.some((w) => w.weekNumber === WEEK)).toBe(false);
    expect(weekShortfall([abebe, bereket], WEEK)).toBe(WEEKLY); // $2,000, correctly
    // And the surplus stays HIS, visible, instead of vanishing into a total.
    expect(bereket.surplus).toBe(3 * WEEKLY);
    expect(bereket.amountOutstanding).toBe(0);
  });

  it("cash expected is the sum of members' truths, never a group netting", () => {
    const owing = truthFor({
      participationId: "owing",
      windowWeeks: Array.from({ length: 20 }, (_, i) => week(i + 1)),
      totalPaid: 11 * WEEKLY,
    });
    const ahead = truthFor({
      participationId: "ahead",
      windowWeeks: Array.from({ length: 20 }, (_, i) => week(i + 1)),
      totalPaid: 18 * WEEKLY,
    });
    // Weeks 1-15 have closed by 15 Aug. `owing` covered 11, so owes 4 × $2,000.
    expect(owing.amountOutstanding).toBe(4 * WEEKLY);
    expect(ahead.amountOutstanding).toBe(0);
    // The member who paid ahead does NOT cancel the member who is behind.
    expect(cashExpected([owing, ahead])).toBe(4 * WEEKLY);
  });
});

describe("RECONCILIATION 2 — the confirmation cannot claim a part-paid week is covered", () => {
  // The Markos bug: `weeksCovered` carried week numbers only, so a week left
  // part paid was named as "recorded on" and the member was chased for it later.
  it("THE OLD SHAPE loses it: week numbers alone cannot tell the two apart", () => {
    const e = describePayment({
      amount: 150_000, // $1,500 against two $2,000 weeks
      today: new Date(Date.UTC(2026, 7, 15)),
      weeklyAmount: WEEKLY,
      weeksBefore: [
        { weekNumber: 12, date: weekDate(12), amountDue: WEEKLY, covered: 100_000, isDeferred: false },
        { weekNumber: 13, date: weekDate(13), amountDue: WEEKLY, covered: 0, isDeferred: false },
      ],
      weeksBehindAfter: 1,
    });
    // What the old path kept — the union of week numbers touched.
    const oldWeeksCovered = [
      ...e.fullWeeks,
      ...e.completedWeeks,
      ...(e.partialWeek === null ? [] : [e.partialWeek]),
    ].sort((a, b) => a - b);
    expect(oldWeeksCovered).toEqual([12, 13]);
    // From THAT alone, "recorded on your week(s) 12 and 13" is all you can say
    // — and it is false about week 13.
  });

  it("THE EVENT names it: week 12 completed, week 13 part paid, $1,000 still due", () => {
    const e = describePayment({
      amount: 150_000,
      today: new Date(Date.UTC(2026, 7, 15)),
      weeklyAmount: WEEKLY,
      weeksBefore: [
        { weekNumber: 12, date: weekDate(12), amountDue: WEEKLY, covered: 100_000, isDeferred: false },
        { weekNumber: 13, date: weekDate(13), amountDue: WEEKLY, covered: 0, isDeferred: false },
      ],
      weeksBehindAfter: 1,
    });
    expect(e.completedWeeks).toEqual([12]);
    expect(e.partialWeek).toBe(13);
    // $1,500 of the $2,000 week 13: the $1,500 paid filled week 12s $1,000 hole
    // first, so only $500 reached week 13.
    expect(e.remainder).toBe(150_000);
    // A payment that leaves a remainder can NEVER select the "paid in full"
    // message, because the event that selects it records the remainder.
    expect(e.partialWeek !== null && e.remainder > 0).toBe(true);
  });
});

// ————————————————— THE DEFERRAL FIX, MEASURED —————————————————

describe("D-42 — exactly what moves, and for whom", () => {
  const windowWeeks = [
    ...Array.from({ length: 6 }, (_, i) => week(i + 1, { storedPaid: WEEKLY })),
    week(7, { isDeferred: true }),
    week(8),
  ];
  const shared = {
    weeklyAmount: WEEKLY,
    startWeek: 1,
    weeksCommitted: 20,
    today: new Date(Date.UTC(2026, 7, 15)),
    windowWeeks,
    totalPaid: 6 * WEEKLY,
  };

  it("a member with NO deferred week is IDENTICAL under both", () => {
    const plain = windowWeeks.map((w) => ({ ...w, isDeferred: false }));
    const before = computeStanding({ ...shared, windowWeeks: plain, cycleWeek: 0 });
    const after = memberTruth({
      ...shared,
      windowWeeks: plain,
      participationId: "p1",
      feePercent: FEE_PERCENT,
    });
    expect(after.amountOutstanding).toBe(before.amountOutstanding);
    expect(after.weeksBehind).toBe(before.weeksBehind);
    expect(after.weeksCredited).toBe(before.weeksCredited);
    expect(after.amountDeferred).toBe(0);
  });

  it("the engine and the nucleus now AGREE — one answer, not two (phase 3)", () => {
    // In phase 2 these differed: the engine held D-42 and `computeStanding`
    // still held the old reading. Phase 3 moved the rule INTO the nucleus, so
    // the two must now be identical — a difference here would mean the engine
    // had quietly become a second implementation again (§5.10).
    const nucleus = computeStanding({ ...shared, cycleWeek: 0 });
    const engine = memberTruth({ ...shared, participationId: "p1", feePercent: FEE_PERCENT });
    expect(engine.amountOutstanding).toBe(nucleus.amountOutstanding);
    expect(engine.amountDeferred).toBe(nucleus.amountDeferred);
    expect(engine.weeksBehind).toBe(nucleus.weeksBehind);
  });

  it("the deferred week is out of what is owed, and its money is held", () => {
    const t = memberTruth({ ...shared, participationId: "p1", feePercent: FEE_PERCENT });
    // Week 8 alone is owed; week 7 is paused. Before D-42 both counted:
    // outstanding was 2 x $2,000 and behind was 2.
    expect(t.amountOutstanding).toBe(WEEKLY);
    expect(t.weeksBehind).toBe(1);
    expect(t.amountDeferred).toBe(WEEKLY);
    // NOTHING IS LOST — the partition is exact, which is what makes "paused"
    // safe to say. The whole debt is still $4,000.
    expect(t.amountOutstanding + t.amountDeferred).toBe(2 * WEEKLY);
  });

  it("THE PRIMITIVES NOW HOLD D-42 — §6.4's three gap sites are closed", () => {
    // The inverse of the phase-2 assertion, which recorded that they still held
    // the OLD rule. Every reader has moved, so the rule moved with them.
    expect(
      weekCountsAsDue({ weekDate: weekDate(7), today: shared.today, isDeferred: true }),
    ).toBe(false);
    expect(
      amountOutstanding([{ amountDue: WEEKLY, amountAlreadyPaid: 0, isDeferred: true }]),
    ).toBe(0);
  });
});
