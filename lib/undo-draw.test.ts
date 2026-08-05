import { describe, expect, it } from "vitest";
import { deletePayoutConsequences, undoDrawConsequences } from "./undo-draw";

// The payout-vs-draw deletion semantics, pinned with real figures:
// week 5, slot #7+#22; #7's payout was $19,600 net minus a $1,000 week
// settlement → $18,600; #22's $9,800 payout was already collected.

const PAYOUTS = [
  {
    payoutId: "p1",
    number: 7,
    netAmount: 1_860_000,
    status: "PENDING" as const,
    settlementAmount: 100_000,
  },
  {
    payoutId: "p2",
    number: 22,
    netAmount: 980_000,
    status: "COLLECTED" as const,
    settlementAmount: 0,
  },
];

describe("undoDrawConsequences — the week was not drawn", () => {
  it("removes draw AND payouts, reopens settled weeks, returns ALL numbers to the pool", () => {
    expect(
      undoDrawConsequences({ weekNumber: 5, slotNumbers: [22, 7], payouts: PAYOUTS }),
    ).toEqual({
      weekNumber: 5,
      payoutCount: 2,
      totalNet: 2_840_000,
      collectedCount: 1,
      collectedNet: 980_000,
      numbersReturning: [7, 22],
      unsettled: [{ number: 7, amount: 100_000 }],
      highStakes: true,
    });
  });

  it("is not high-stakes while everything is still pending", () => {
    const result = undoDrawConsequences({
      weekNumber: 5,
      slotNumbers: [7],
      payouts: [PAYOUTS[0]],
    });
    expect(result.highStakes).toBe(false);
    expect(result.collectedNet).toBe(0);
  });
});

describe("deletePayoutConsequences — the money record was wrong, the DRAW STANDS", () => {
  it("keeps the number drawn and reopens the week that was settled from it", () => {
    expect(
      deletePayoutConsequences({
        number: 7,
        netAmount: 1_860_000,
        status: "PENDING",
        settlement: { weekNumber: 5, amount: 100_000 },
      }),
    ).toEqual({
      number: 7,
      netAmount: 1_860_000,
      status: "PENDING",
      reopensWeek: { weekNumber: 5, amount: 100_000 },
      drawStands: true,
      highStakes: false,
    });
  });

  it("a collected payout is high-stakes; no settlement means no week reopens", () => {
    const result = deletePayoutConsequences({
      number: 22,
      netAmount: 980_000,
      status: "COLLECTED",
      settlement: null,
    });
    expect(result.highStakes).toBe(true);
    expect(result.reopensWeek).toBeNull();
    expect(result.drawStands).toBe(true);
  });
});
