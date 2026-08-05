import { describe, expect, it } from "vitest";
import {
  cashPosition,
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
): DashboardPayment {
  return { participationId, weekNumber, amountPaid, isDeferred };
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
    });
    expect(series.map((w) => w.weekNumber)).toEqual([1, 2, 13]);
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
    const list = memberAttention({ participations, payments, currentWeek: 14 });
    expect(list).toEqual([
      { participationId: "b", name: "Late", weeksBehind: 3, amountOwed: 150_000 },
      { participationId: "a", name: "Early", weeksBehind: 4, amountOwed: 100_000 },
    ]);
  });

  it("deferred weeks never count as behind (excused is excused)", () => {
    const payments = [
      pay("a", 1, 25_000),
      pay("a", 2, 0, true), // excused
      pay("a", 3, 25_000),
    ];
    const list = memberAttention({
      participations: [participations[0]],
      payments,
      currentWeek: 3,
    });
    expect(list).toEqual([]);
  });

  it("weeks with no stored row still count as owed", () => {
    const list = memberAttention({
      participations: [participations[0]],
      payments: [], // nothing recorded at all
      currentWeek: 4,
    });
    expect(list).toEqual([
      { participationId: "a", name: "Early", weeksBehind: 4, amountOwed: 100_000 },
    ]);
  });

  it("paid-ahead members never appear", () => {
    const payments = [pay("a", 1, 250_000)]; // 10 weeks of money in week 1
    expect(
      memberAttention({ participations: [participations[0]], payments, currentWeek: 5 }),
    ).toEqual([]);
  });
});
