import { describe, expect, it } from "vitest";
import {
  collectionPosition,
  collectionSentence,
  expectedHolding,
  positionVerdict,
} from "./cycle-position";
import { cashPosition, receiptsByWeek } from "./dashboard";
import { formatMoney } from "./format";

// "Am I in negative, am I using someone else's money, or am I on track."
//
// The piece that was invisible is PAID AHEAD: money received for weeks that
// have not elapsed. A balance that looks healthy because four people paid
// early is not healthy, and nothing said so.

const week = (n: number, expected: number, received: number, elapsed: boolean) => ({
  weekNumber: n,
  expected,
  received,
  shortfall: Math.max(0, expected - received),
  membersPaid: 0,
  membersExpected: 0,
  elapsed,
});

describe("collectionPosition — should-vs-actual, and the money owed forward", () => {
  const series = [
    week(1, 100_000, 100_000, true),
    week(2, 100_000, 100_000, true),
    week(3, 100_000, 60_000, true), // someone short
    week(4, 100_000, 50_000, false), // NOT elapsed — paid ahead
    week(5, 100_000, 25_000, false), // NOT elapsed — paid ahead
  ];

  it("sums expectations over ELAPSED weeks only", () => {
    const p = collectionPosition({ series, owedBy: [], aheadBy: [] });
    expect(p.shouldHaveCollected).toBe(300_000);
    expect(p.elapsedThroughWeek).toBe(3);
  });

  it("counts only elapsed receipts as collected", () => {
    const p = collectionPosition({ series, owedBy: [], aheadBy: [] });
    expect(p.collected).toBe(260_000);
    expect(p.shortfall).toBe(40_000);
  });

  // THE PIECE HE CANNOT SEE TODAY.
  it("separates money paid toward weeks that have NOT happened", () => {
    const p = collectionPosition({ series, owedBy: [], aheadBy: [] });
    expect(p.paidAhead).toBe(75_000);
    // And it is NOT counted as collected — that is the whole distinction.
    expect(p.collected).toBe(260_000);
  });

  it("never reports a negative shortfall when a week is overpaid", () => {
    const over = [week(1, 100_000, 130_000, true)];
    expect(collectionPosition({ series: over, owedBy: [], aheadBy: [] }).shortfall).toBe(0);
  });

  it("reports zero paid-ahead when every week has elapsed", () => {
    const all = series.map((w) => ({ ...w, elapsed: true }));
    expect(collectionPosition({ series: all, owedBy: [], aheadBy: [] }).paidAhead).toBe(0);
  });

  it("names who makes up the shortfall, largest first", () => {
    const p = collectionPosition({
      series,
      owedBy: [
        { participationId: "a", name: "Abebe", amount: 10_000 },
        { participationId: "b", name: "Bekele", amount: 30_000 },
        { participationId: "c", name: "Chala", amount: 0 },
      ],
      aheadBy: [],
    });
    expect(p.owedBy.map((m) => m.name)).toEqual(["Bekele", "Abebe"]);
  });

  it("names who paid ahead, largest first", () => {
    const p = collectionPosition({
      series,
      owedBy: [],
      aheadBy: [
        { participationId: "a", name: "Abebe", amount: 25_000, weeks: 1 },
        { participationId: "b", name: "Bekele", amount: 50_000, weeks: 2 },
      ],
    });
    expect(p.aheadBy.map((m) => m.name)).toEqual(["Bekele", "Abebe"]);
  });
});

describe("agreement with the dashboard — one derivation, not two", () => {
  // The series the cycle position reads is the SAME one the dashboard builds.
  // If receiptsByWeek's elapsed rule ever changes, both move together.
  const weeks = [
    { weekNumber: 1, isSkipped: false },
    { weekNumber: 2, isSkipped: false },
    { weekNumber: 3, isSkipped: false },
  ];
  const participations = [
    { id: "p1", weeklyAmount: 100_000, startWeek: 1, weeksCommitted: 3 },
    { id: "p2", weeklyAmount: 100_000, startWeek: 1, weeksCommitted: 3 },
  ];
  const payments = [
    { participationId: "p1", weekNumber: 1, amountPaid: 100_000, isDeferred: false, isSkipped: false },
    { participationId: "p2", weekNumber: 1, amountPaid: 100_000, isDeferred: false, isSkipped: false },
    { participationId: "p1", weekNumber: 2, amountPaid: 100_000, isDeferred: false, isSkipped: false },
    // p2 has not paid week 2; p1 has already paid week 3 (not elapsed).
    { participationId: "p1", weekNumber: 3, amountPaid: 100_000, isDeferred: false, isSkipped: false },
  ];

  it("reads elapsed-ness from the dashboard series, never its own rule", () => {
    const series = receiptsByWeek({ weeks, participations, payments, elapsedThroughWeek: 2 });
    const p = collectionPosition({ series, owedBy: [], aheadBy: [] });
    expect(p.elapsedThroughWeek).toBe(2);
    expect(p.shouldHaveCollected).toBe(400_000); // weeks 1+2, two members
    expect(p.collected).toBe(300_000);
    expect(p.shortfall).toBe(100_000); // p2's week 2
    expect(p.paidAhead).toBe(100_000); // p1's week 3
  });

  it("moving the elapsed boundary moves collected and paid-ahead together", () => {
    const later = receiptsByWeek({ weeks, participations, payments, elapsedThroughWeek: 3 });
    const p = collectionPosition({ series: later, owedBy: [], aheadBy: [] });
    // Week 3 is now elapsed, so its money is collection, not owed forward.
    expect(p.paidAhead).toBe(0);
    expect(p.collected).toBe(400_000);
  });

  it("the expected holding starts from the dashboard's own cash position", () => {
    const cash = cashPosition({
      payments: [{ amountPaid: 400_000 }],
      payouts: [
        { netAmount: 100_000, status: "COLLECTED" },
        { netAmount: 90_000, status: "PENDING" },
      ],
    });
    const holding = expectedHolding({
      totalReceived: cash.totalReceived,
      totalPaidOut: cash.totalPaidOut,
      committedPending: cash.committedPending,
      feeOnCollected: 2_000,
      feeOnPending: 1_800,
      paidAhead: 100_000,
    });
    expect(holding.expected).toBe(cash.currentlyHeld);
    expect(holding.committedToPayouts).toBe(cash.committedPending);
  });
});

describe("expectedHolding — the fee is why this is not one number", () => {
  const base = {
    totalReceived: 1_000_000,
    totalPaidOut: 200_000,
    committedPending: 150_000,
    feeOnCollected: 4_000,
    feeOnPending: 3_000,
    paidAhead: 50_000,
  };

  it("splits what he holds into the claims on it", () => {
    const h = expectedHolding(base);
    expect(h.expected).toBe(800_000);
    expect(h.owedForward).toBe(50_000);
    expect(h.committedToPayouts).toBe(150_000);
    expect(h.feeEarned).toBe(4_000);
    expect(h.uncommitted).toBe(800_000 - 50_000 - 150_000 - 4_000);
  });

  it("lets uncommitted go NEGATIVE — that is the signal, not an error", () => {
    const h = expectedHolding({ ...base, committedPending: 900_000 });
    expect(h.uncommitted).toBeLessThan(0);
  });

  it("keeps committed fee separate from earned fee", () => {
    const h = expectedHolding(base);
    expect(h.feeEarned).toBe(4_000);
    expect(h.feeCommitted).toBe(3_000);
    // Only the EARNED fee is subtracted: the pending one is not his yet.
    expect(h.uncommitted).toBe(596_000);
  });
});

describe("positionVerdict — never just a number", () => {
  const expected = expectedHolding({
    totalReceived: 1_000_000,
    totalPaidOut: 200_000,
    committedPending: 150_000,
    feeOnCollected: 835_00, // $835
    feeOnPending: 0,
    paidAhead: 50_000,
  });

  it("SURPLUS: says how much more, and how much of it is his fee", () => {
    const v = positionVerdict({ expected, actual: expected.expected + 230_000, formatMoney });
    expect(v.kind).toBe("surplus");
    expect(v.difference).toBe(230_000);
    expect(v.sentence).toContain("$2,300 MORE than expected");
    expect(v.sentence).toContain("$835");
    expect(v.sentence).toContain("you are covered");
  });

  it("SHORT: says by how much, what it is against, and what he must do", () => {
    // Holding less than what is owed out plus owed forward.
    const v = positionVerdict({ expected, actual: 100_000, formatMoney });
    expect(v.kind).toBe("short");
    expect(v.shortBy).toBe(100_000);
    expect(v.sentence).toContain("short by $1,000");
    expect(v.sentence).toContain("promised to winners");
    expect(v.sentence).toContain("weeks that have not happened");
    expect(v.sentence).toContain("cover that before the next payout");
  });

  it("a gap in the books is reported even when he can still cover everything", () => {
    const v = positionVerdict({ expected, actual: expected.expected - 40_000, formatMoney });
    expect(v.kind).toBe("covered");
    expect(v.sentence).toContain("$400 LESS than expected");
    // Two different questions, both answered.
    expect(v.sentence).toContain("still enough to cover");
    expect(v.sentence).toContain("not recorded");
  });

  it("EXACT: the books and the cash agree", () => {
    const v = positionVerdict({ expected, actual: expected.expected, formatMoney });
    expect(v.kind).toBe("exact");
    expect(v.difference).toBe(0);
    expect(v.sentence).toContain("exactly what the books say");
  });

  it("coverage ignores the fee — the fee is his, what is owed is not", () => {
    const v = positionVerdict({ expected, actual: 200_000, formatMoney });
    // owed = paidAhead 50,000 + committed 150,000 = 200,000
    expect(v.coverage).toBe(0);
    expect(v.kind).not.toBe("short");
  });

  it("never emits a bare number, NaN or a negative-looking amount", () => {
    for (const actual of [0, 1, 200_000, 800_000, 5_000_000]) {
      const v = positionVerdict({ expected, actual, formatMoney });
      expect(v.sentence.length).toBeGreaterThan(40);
      expect(v.sentence).not.toContain("NaN");
      expect(v.sentence).not.toContain("undefined");
      expect(v.sentence).not.toContain("$-");
    }
  });
});

describe("collectionSentence — the dashboard's register", () => {
  it("states should, actual, who is short, and what is owed forward", () => {
    const p = collectionPosition({
      series: [week(1, 100_000, 100_000, true), week(2, 100_000, 60_000, true), week(3, 100_000, 30_000, false)],
      owedBy: [{ participationId: "a", name: "Abebe", amount: 40_000 }],
      aheadBy: [{ participationId: "b", name: "Bekele", amount: 30_000, weeks: 1 }],
    });
    const s = collectionSentence(p, formatMoney);
    expect(s).toContain("Through week 2");
    expect(s).toContain("$2,000 should have come in");
    expect(s).toContain("$1,600 has");
    expect(s).toContain("$400 is outstanding, from 1 member");
    expect(s).toContain("$300 has been paid toward weeks that have not happened");
    expect(s).toContain("owed forward, not collected");
  });

  it("says nothing about paid-ahead when there is none", () => {
    const p = collectionPosition({ series: [week(1, 100_000, 100_000, true)], owedBy: [], aheadBy: [] });
    const s = collectionSentence(p, formatMoney);
    expect(s).toContain("Nothing is outstanding.");
    expect(s).not.toContain("paid toward weeks");
  });
});
