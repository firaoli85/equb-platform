import { describe, expect, it } from "vitest";
import {
  cashPosition,
  cashSeries,
  receivedByMember,
  receiptsByWeek,
  memberAttention,
  weekReceipts,
  weekMemberStatus,
  type DashboardParticipation,
  type DashboardPayment,
} from "./dashboard";

describe("cashPosition — pinned to the REAL imported Cycle 1 figures", () => {
  it("reproduces the verified import: $197,175 in, $124,950 out, $72,225 held, $49,000 pending", () => {
    // The payout rows below are the EXACT live books after the Cycle 1
    // import (queried 2026-08-04): 9 collected, 5 drawn-but-pending. A
    // regression in any summation breaks against reality, not a toy.
    const payments = [
      { amountPaid: 19_717_500 - 500_000 }, // the bulk...
      { amountPaid: 500_000 }, // ...plus a second row so summation is exercised
    ];
    const payouts = [
      // 5 drawn but pending totalling $49,000 — already owed out
      { netAmount: 490_000, status: "PENDING" as const },
      { netAmount: 980_000, status: "PENDING" as const },
      { netAmount: 980_000, status: "PENDING" as const },
      { netAmount: 980_000, status: "PENDING" as const },
      { netAmount: 1_470_000, status: "PENDING" as const },
      // 9 collected totalling $124,950
      { netAmount: 490_000, status: "COLLECTED" as const },
      { netAmount: 490_000, status: "COLLECTED" as const },
      { netAmount: 490_000, status: "COLLECTED" as const },
      { netAmount: 1_225_000, status: "COLLECTED" as const },
      { netAmount: 1_960_000, status: "COLLECTED" as const },
      { netAmount: 1_960_000, status: "COLLECTED" as const },
      { netAmount: 1_960_000, status: "COLLECTED" as const },
      { netAmount: 1_960_000, status: "COLLECTED" as const },
      { netAmount: 1_960_000, status: "COLLECTED" as const },
    ];
    const position = cashPosition({ payments, payouts });
    expect(position.totalReceived).toBe(19_717_500); // $197,175.00
    expect(position.totalPaidOut).toBe(12_495_000); // $124,950.00
    expect(position.currentlyHeld).toBe(7_222_500); // $72,225.00
    expect(position.committedPending).toBe(4_900_000); // $49,000.00
    expect(position.uncommitted).toBe(2_322_500); // $23,225.00
    expect(position.pendingPayoutCount).toBe(5);
  });

  it("empty books are all zero", () => {
    expect(cashPosition({ payments: [], payouts: [] })).toEqual({
      totalReceived: 0,
      totalPaidOut: 0,
      currentlyHeld: 0,
      committedPending: 0,
      uncommitted: 0,
      pendingPayoutCount: 0,
    });
  });

  it("rejects fractional cents", () => {
    expect(() => cashPosition({ payments: [{ amountPaid: 10.5 }], payouts: [] })).toThrow(RangeError);
  });
});

const participations: (DashboardParticipation & { name: string })[] = [
  { id: "a", name: "Early", weeklyAmount: 25_000, startWeek: 1, weeksCommitted: 20 },
  { id: "b", name: "Late", weeklyAmount: 50_000, startWeek: 12, weeksCommitted: 9 },
];

function pay(
  participationId: string,
  weekNumber: number,
  amountPaid: number,
  isDeferred = false,
  isSkipped = false,
): DashboardPayment {
  return { participationId, weekNumber, amountPaid, isDeferred, isSkipped };
}

describe("weekReceipts — window-aware (2.7)", () => {
  it("a week-12 joiner is NOT expected in week 5", () => {
    const week5 = weekReceipts({
      weekNumber: 5,
      participations,
      payments: [pay("a", 5, 25_000)],
    });
    expect(week5.expected).toBe(25_000); // only the early member
    expect(week5.received).toBe(25_000);
    expect(week5.membersExpected).toBe(1);
    expect(week5.membersPaid).toBe(1);
    expect(week5.shortfall).toBe(0);
  });

  it("both members expected once both windows cover the week", () => {
    const week12 = weekReceipts({
      weekNumber: 12,
      participations,
      payments: [pay("a", 12, 25_000)],
    });
    expect(week12.expected).toBe(75_000);
    expect(week12.membersExpected).toBe(2);
    expect(week12.membersPaid).toBe(1);
    expect(week12.shortfall).toBe(50_000);
  });

  it("deferred members are excused from expectation", () => {
    const week3 = weekReceipts({
      weekNumber: 3,
      participations,
      payments: [pay("a", 3, 0, true)],
    });
    expect(week3.expected).toBe(0);
    expect(week3.membersExpected).toBe(0);
  });

  it("a skipped week expects nothing but still shows money that arrived", () => {
    const week4 = weekReceipts({
      weekNumber: 4,
      isSkipped: true,
      participations,
      payments: [pay("a", 4, 10_000)],
    });
    expect(week4.expected).toBe(0);
    expect(week4.received).toBe(10_000);
    expect(week4.shortfall).toBe(0);
  });

  it("a partial payment does not count the member as paid", () => {
    const week1 = weekReceipts({
      weekNumber: 1,
      participations,
      payments: [pay("a", 1, 10_000)],
    });
    expect(week1.membersPaid).toBe(0);
    expect(week1.received).toBe(10_000);
  });
});

describe("receiptsByWeek", () => {
  it("produces the ordered series with per-week windows applied", () => {
    const series = receiptsByWeek({
      weeks: [
        { weekNumber: 2, isSkipped: false },
        { weekNumber: 1, isSkipped: false },
        { weekNumber: 13, isSkipped: false },
      ],
      participations,
      payments: [pay("a", 1, 25_000), pay("b", 13, 50_000)],
      elapsedThroughWeek: 2,
    });
    expect(series.map((w) => w.weekNumber)).toEqual([1, 2, 13]);
    // One rule, stamped once: the charts read this rather than re-deriving it.
    expect(series.map((w) => w.elapsed)).toEqual([true, true, false]);
    expect(series[0].expected).toBe(25_000);
    expect(series[2].expected).toBe(75_000); // both in window at week 13
    expect(series[2].received).toBe(50_000);
  });
});

describe("receivedByMember — what the received figure is made of", () => {
  it("totals per member, largest first, zeros included", () => {
    const result = receivedByMember({
      participations: [
        { id: "a", name: "Early" },
        { id: "b", name: "Late" },
        { id: "c", name: "Nothing" },
      ],
      payments: [
        { participationId: "a", amountPaid: 25_000 },
        { participationId: "a", amountPaid: 25_000 },
        { participationId: "b", amountPaid: 150_000 },
      ],
    });
    expect(result).toEqual([
      { participationId: "b", name: "Late", total: 150_000 },
      { participationId: "a", name: "Early", total: 50_000 },
      { participationId: "c", name: "Nothing", total: 0 },
    ]);
  });
});

describe("weekMemberStatus — who has paid and who has not", () => {
  it("classifies in-window members and skips out-of-window ones", () => {
    const rows = weekMemberStatus({
      weekNumber: 5,
      participations,
      payments: [pay("a", 5, 25_000)],
    });
    // Late (week-12 joiner) is out of window at week 5 — not listed at all.
    expect(rows).toEqual([
      { participationId: "a", name: "Early", weeklyAmount: 25_000, amountPaid: 25_000, status: "PAID" },
    ]);
  });

  it("distinguishes PARTIAL, UNPAID, and DEFERRED", () => {
    const many = [
      { id: "p", name: "Part", weeklyAmount: 25_000, startWeek: 1, weeksCommitted: 20 },
      { id: "u", name: "Unpaid", weeklyAmount: 25_000, startWeek: 1, weeksCommitted: 20 },
      { id: "d", name: "Deferred", weeklyAmount: 25_000, startWeek: 1, weeksCommitted: 20 },
    ];
    const rows = weekMemberStatus({
      weekNumber: 2,
      participations: many,
      payments: [pay("p", 2, 10_000), pay("d", 2, 0, true)],
    });
    expect(rows.map((r) => [r.name, r.status])).toEqual([
      ["Deferred", "DEFERRED"],
      ["Part", "PARTIAL"],
      ["Unpaid", "UNPAID"],
    ]);
  });
});

describe("memberAttention — worst first, deferred excluded", () => {
  it("finds who is behind, by how much, sorted worst first", () => {
    // Week 14: Early (from wk 1) has paid 10 of 14; Late (from wk 12) paid 0 of 3.
    const payments = [
      ...Array.from({ length: 10 }, (_, i) => pay("a", i + 1, 25_000)),
    ];
    const list = memberAttention({ participations, payments, elapsedThroughWeek: 14 });
    expect(list).toEqual([
      { participationId: "b", name: "Late", weeksBehind: 3, amountOwed: 150_000 },
      { participationId: "a", name: "Early", weeksBehind: 4, amountOwed: 100_000 },
    ]);
  });

  it("SKIPPED weeks never count as behind — nobody owed them", () => {
    const payments = [
      pay("a", 1, 25_000),
      pay("a", 2, 0, false, true), // the week did not happen for anyone
      pay("a", 3, 25_000),
    ];
    const list = memberAttention({
      participations: [participations[0]],
      payments,
      elapsedThroughWeek: 3,
    });
    expect(list).toEqual([]);
  });

  it("DEFERRED weeks DO count as behind — not chased, still owed (Aug 2026)", () => {
    const payments = [
      pay("a", 1, 25_000),
      pay("a", 2, 0, true), // deferred: the debt is real, the chasing is not
      pay("a", 3, 25_000),
    ];
    const list = memberAttention({
      participations: [participations[0]],
      payments,
      elapsedThroughWeek: 3,
    });
    expect(list).toHaveLength(1);
    expect(list[0].weeksBehind).toBe(1);
  });

  it("weeks with no stored row still count as owed", () => {
    const list = memberAttention({
      participations: [participations[0]],
      payments: [], // nothing recorded at all
      elapsedThroughWeek: 4,
    });
    expect(list).toEqual([
      { participationId: "a", name: "Early", weeksBehind: 4, amountOwed: 100_000 },
    ]);
  });

  it("paid-ahead members never appear", () => {
    const payments = [pay("a", 1, 250_000)]; // 10 weeks of money in week 1
    expect(
      memberAttention({ participations: [participations[0]], payments, elapsedThroughWeek: 5 }),
    ).toEqual([]);
  });
});

// ————————————————————————————————————————————————————————————————
// THE CASH POSITION OVER TIME (ADMIN_IA §5.2)
//
// A production-shaped cycle: 20 weeks, money coming in every week, six weeks
// drawn, one winner still waiting to collect. The figures below are the ones
// a chart draws, so what is tested is the thing the organizer READS.
// ————————————————————————————————————————————————————————————————

describe("the cash position week by week", () => {
  const weeks = Array.from({ length: 20 }, (_, i) => ({ weekNumber: i + 1 }));

  // 27 members × $1,000/week, in cents. Weeks 1-6 fully paid, week 7 partial.
  const payments = [
    ...Array.from({ length: 6 }, (_, i) => ({
      weekNumber: i + 1,
      amountPaid: 2_700_000,
    })),
    { weekNumber: 7, amountPaid: 1_800_000 },
  ];

  const payouts = [
    { weekNumber: 1, netAmount: 2_646_000, status: "COLLECTED" as const },
    { weekNumber: 2, netAmount: 2_646_000, status: "COLLECTED" as const },
    { weekNumber: 3, netAmount: 2_646_000, status: "COLLECTED" as const },
    { weekNumber: 4, netAmount: 2_646_000, status: "COLLECTED" as const },
    { weekNumber: 5, netAmount: 2_646_000, status: "COLLECTED" as const },
    { weekNumber: 6, netAmount: 2_646_000, status: "PENDING" as const },
  ];

  const series = cashSeries({ weeks, payments, payouts, elapsedThroughWeek: 6 });

  it("has one point per week, in order", () => {
    expect(series).toHaveLength(20);
    expect(series.map((p) => p.weekNumber)).toEqual(weeks.map((w) => w.weekNumber));
  });

  it("runs the held position forward rather than reporting each week alone", () => {
    // Week 1: in 2,700,000, out 2,646,000 → 54,000 held.
    expect(series[0].held).toBe(54_000);
    // Week 2 adds the same movement again: the position ACCUMULATES.
    expect(series[1].held).toBe(108_000);
    expect(series[4].held).toBe(270_000);
  });

  it("does not let a PENDING payout reduce the position — the cash has not left", () => {
    // Week 6 was drawn but not collected, so held rises by the full receipt.
    expect(series[5].paidOut).toBe(0);
    expect(series[5].pendingOut).toBe(2_646_000);
    expect(series[5].held).toBe(series[4].held + 2_700_000);
  });

  it("agrees exactly with cashPosition — the chart and the stat card are one figure", () => {
    // The whole point of 2.14: two screens showing the same money must not be
    // able to disagree. The last point of the series IS currentlyHeld.
    const snapshot = cashPosition({
      payments: payments.map((p) => ({ amountPaid: p.amountPaid })),
      payouts,
    });
    expect(series[series.length - 1].held).toBe(snapshot.currentlyHeld);
    const pending = series.reduce((s, p) => s + p.pendingOut, 0);
    expect(pending).toBe(snapshot.committedPending);
  });

  it("marks the elapsed/to-come divider from the week window, not from data", () => {
    // Week 7 has real money in it and is still OPEN. Drawing it as an actual
    // would show a collapse in the position that has not happened.
    expect(series[6].received).toBe(1_800_000);
    expect(series[6].elapsed).toBe(false);
    expect(series[5].elapsed).toBe(true);
    expect(series.filter((p) => p.elapsed)).toHaveLength(6);
  });

  it("keeps weeks with no movement at zero rather than dropping them", () => {
    // A gap in the axis would compress time and make the slope a lie.
    expect(series[10].received).toBe(0);
    expect(series[10].paidOut).toBe(0);
    expect(series[10].held).toBe(series[9].held);
  });

  it("folds a payout with no draw into the first week rather than losing it", () => {
    const undrawn = cashSeries({
      weeks,
      payments: [{ weekNumber: 1, amountPaid: 2_700_000 }],
      payouts: [{ weekNumber: null, netAmount: 1_000_000, status: "COLLECTED" }],
      elapsedThroughWeek: 1,
    });
    // Dropping it would make the chart's final held disagree with the stat card.
    expect(undrawn[0].paidOut).toBe(1_000_000);
    expect(undrawn[19].held).toBe(1_700_000);
  });

  it("refuses a non-integer or negative amount rather than drawing it", () => {
    expect(() =>
      cashSeries({
        weeks,
        payments: [{ weekNumber: 1, amountPaid: 12.5 }],
        payouts: [],
        elapsedThroughWeek: 1,
      }),
    ).toThrow(RangeError);
  });

  it("survives an empty cycle without inventing a position", () => {
    expect(cashSeries({ weeks: [], payments: [], payouts: [], elapsedThroughWeek: 0 })).toEqual([]);
  });
});
