import { describe, expect, it } from "vitest";
import {
  addWinnerPreview,
  addWinnerRefusal,
  candidatePayout,
  movePayoutPreview,
  movePayoutRefusal,
  previewSentences,
  removeWinnerPreview,
  removeWinnerRefusal,
  settlementFor,
  type WeekWinners,
  type WinnerCandidate,
  type WinnerPayout,
} from "./week-winners";
import { formatMoney } from "./format";

// THE REAL CASE. Week 6 records Hana (#19) alone at $4,900 — she contributes
// $250/week and nobody wins $4,900 alone when the pot is ~$20,000. She was
// paired with someone; the record has her solo and there was no way to fix it.
//
// These tests are the arithmetic of fixing it, plus the distinction that has
// already misled the organizer once: REMOVING A WINNER returns their number to
// the wheel; DELETING A PAYOUT does not.

const FEE = 2;

const hana: WinnerPayout = {
  payoutId: "po-hana",
  luckyNumberId: "ln-19",
  number: 19,
  participationId: "part-hana",
  memberName: "Hana",
  gross: 500_000, // $5,000 = $250 × 20
  fee: 10_000, // 2%
  net: 465_000, // $4,900 gross-fee, less her own $250 week... see below
  settlement: 25_000, // her week-6 contribution, settled from the payout
  status: "PENDING",
};

const week6: WeekWinners = {
  weekId: "wk-6",
  weekNumber: 6,
  undrawn: false,
  isSkipped: false,
  payouts: [hana],
};

const partner: WinnerCandidate = {
  luckyNumberId: "ln-31",
  number: 31,
  amount: 100_000, // $1,000 a week
  participationId: "part-abebe",
  memberName: "Abebe",
  weeksCommitted: 20,
  startWeek: 1,
  weeklyAmount: 100_000,
};

describe("a payout is worth the same however the winner got there", () => {
  it("uses the identical arithmetic a spun draw uses", () => {
    // $1,000 × 20 weeks = $20,000 gross, 2% = $400 fee, $19,600 net.
    expect(candidatePayout(partner, FEE)).toEqual({
      gross: 2_000_000,
      fee: 40_000,
      net: 1_960_000,
    });
  });

  it("scales with the NUMBER's amount, not the member's total contribution", () => {
    // A $2,000/week member holding two $1,000 numbers gets two payouts of
    // this size, each paying its own fee — never one doubled payout.
    const half = candidatePayout({ amount: 100_000, weeksCommitted: 20 }, FEE);
    expect(half.gross).toBe(2_000_000);
    expect(half.fee).toBe(40_000);
  });
});

describe("the winner does not pay the week they win", () => {
  it("settles their whole weekly contribution for that week", () => {
    expect(
      settlementFor({ candidate: partner, weekNumber: 6, weekIsSkipped: false }),
    ).toBe(100_000);
  });

  it("settles only the REMAINDER when they already paid part of it", () => {
    expect(
      settlementFor({ candidate: partner, weekNumber: 6, weekIsSkipped: false, alreadyPaid: 40_000 }),
    ).toBe(60_000);
  });

  it("settles nothing on a SKIPPED week — nobody owes it", () => {
    expect(settlementFor({ candidate: partner, weekNumber: 6, weekIsSkipped: true })).toBe(0);
  });

  it("settles nothing outside their window", () => {
    const lateJoiner = { ...partner, startWeek: 12, weeksCommitted: 9 };
    expect(settlementFor({ candidate: lateJoiner, weekNumber: 6, weekIsSkipped: false })).toBe(0);
    expect(settlementFor({ candidate: lateJoiner, weekNumber: 12, weekIsSkipped: false })).toBe(100_000);
  });

  it("never settles more than they owe, even on an overpaid week", () => {
    expect(
      settlementFor({ candidate: partner, weekNumber: 6, weekIsSkipped: false, alreadyPaid: 150_000 }),
    ).toBe(0);
  });
});

describe("ADD a winner — Hana's missing partner", () => {
  it("states the week's total before and after, in real money", () => {
    const p = addWinnerPreview({ week: week6, candidate: partner, feePercent: FEE });
    expect(p.weekTotalBefore).toBe(465_000); // Hana alone
    // $19,600 net less his own $1,000 week-6 contribution = $18,600 added.
    expect(p.weekTotalAfter).toBe(465_000 + 1_860_000);
  });

  it("takes the number OUT of the wheel pool (2.27)", () => {
    const p = addWinnerPreview({ week: week6, candidate: partner, feePercent: FEE });
    expect(p.numbersLeavingPool).toEqual([31]);
    expect(p.numbersReturningToPool).toEqual([]);
  });

  it("settles their own week from the payout, and says so", () => {
    const p = addWinnerPreview({ week: week6, candidate: partner, feePercent: FEE });
    expect(p.weeksSettling).toEqual([
      { weekNumber: 6, memberName: "Abebe", amount: 100_000 },
    ]);
    expect(p.weeksReopening).toEqual([]);
  });

  it("raises the money committed to payouts by exactly what they receive", () => {
    const p = addWinnerPreview({ week: week6, candidate: partner, feePercent: FEE });
    expect(p.cashPositionDelta).toBe(1_860_000);
    expect(p.cashPositionDelta).toBe(p.weekTotalAfter - p.weekTotalBefore);
  });

  it("adds the FULL payout when the week is skipped — nothing to settle", () => {
    const p = addWinnerPreview({
      week: { ...week6, isSkipped: true },
      candidate: partner,
      feePercent: FEE,
    });
    expect(p.weeksSettling).toEqual([]);
    expect(p.weekTotalAfter - p.weekTotalBefore).toBe(1_960_000);
  });

  describe("refusals", () => {
    it("refuses a number that has already been drawn (2.27)", () => {
      expect(
        addWinnerRefusal({
          week: week6,
          candidate: partner,
          drawnNumberIds: new Set(["ln-31"]),
        }),
      ).toBe("#31 has already been drawn — a number can only win once.");
    });

    it("refuses a number that is already a winner of THIS week", () => {
      expect(
        addWinnerRefusal({
          week: week6,
          candidate: { ...partner, luckyNumberId: "ln-19", number: 19 },
          drawnNumberIds: new Set(),
        }),
      ).toBe("#19 is already a winner of week 6.");
    });

    it("names the window when the week falls outside it", () => {
      expect(
        addWinnerRefusal({
          week: week6,
          candidate: { ...partner, startWeek: 12, weeksCommitted: 9 },
          drawnNumberIds: new Set(),
        }),
      ).toBe("Week 6 is outside Abebe's window (weeks 12–20).");
    });

    it("allows an ordinary addition", () => {
      expect(
        addWinnerRefusal({ week: week6, candidate: partner, drawnNumberIds: new Set() }),
      ).toBeNull();
    });
  });
});

describe("REMOVE one winner — the number comes BACK", () => {
  it("returns only that number to the pool, and leaves the week's others alone", () => {
    const twoWinners: WeekWinners = {
      ...week6,
      payouts: [
        hana,
        {
          ...hana,
          payoutId: "po-abebe",
          luckyNumberId: "ln-31",
          number: 31,
          memberName: "Abebe",
          net: 1_860_000,
          settlement: 100_000,
        },
      ],
    };
    const p = removeWinnerPreview({ week: twoWinners, payout: twoWinners.payouts[1] });

    // THE distinction from "delete payout", which leaves the number drawn.
    expect(p.numbersReturningToPool).toEqual([31]);
    expect(p.numbersLeavingPool).toEqual([]);
    // Hana's payout survives untouched.
    expect(p.weekTotalAfter).toBe(465_000);
  });

  it("makes their settled contribution owed again", () => {
    const p = removeWinnerPreview({ week: week6, payout: hana });
    expect(p.weeksReopening).toEqual([
      { weekNumber: 6, memberName: "Hana", amount: 25_000 },
    ]);
  });

  it("lowers the money committed to payouts", () => {
    const p = removeWinnerPreview({ week: week6, payout: hana });
    expect(p.cashPositionDelta).toBe(-465_000);
    expect(p.weekTotalAfter).toBe(0);
  });

  it("reopens nothing when nothing had settled", () => {
    const p = removeWinnerPreview({ week: week6, payout: { ...hana, settlement: 0 } });
    expect(p.weeksReopening).toEqual([]);
  });

  it("refuses a payout that is not part of this week", () => {
    expect(
      removeWinnerRefusal({ week: week6, payout: { ...hana, payoutId: "elsewhere" } }),
    ).toBe("That payout is not part of this week.");
  });
});

describe("MOVE a payout — the settlement follows the winner", () => {
  const week9: WeekWinners = {
    weekId: "wk-9",
    weekNumber: 9,
    undrawn: false,
    isSkipped: false,
    payouts: [],
  };
  const hanaTerms = {
    weeklyAmount: 25_000,
    startWeek: 1,
    weeksCommitted: 20,
    memberName: "Hana",
  };

  it("reopens the OLD week and settles the NEW one", () => {
    const p = movePayoutPreview({ from: week6, to: week9, payout: hana, candidate: hanaTerms });
    // The rule is "the winner does not pay the week they win" — so the week
    // they no longer win becomes owed, and the week they now win settles.
    expect(p.weeksReopening).toEqual([{ weekNumber: 6, memberName: "Hana", amount: 25_000 }]);
    expect(p.weeksSettling).toEqual([{ weekNumber: 9, memberName: "Hana", amount: 25_000 }]);
  });

  it("states BOTH weeks' totals after the move", () => {
    const p = movePayoutPreview({ from: week6, to: week9, payout: hana, candidate: hanaTerms });
    expect(p.fromTotalAfter).toBe(0); // week 6 loses its only payout
    expect(p.toTotalAfter).toBe(465_000); // same net, same settlement size
  });

  it("moves no number in or out of the pool — it stays drawn throughout", () => {
    const p = movePayoutPreview({ from: week6, to: week9, payout: hana, candidate: hanaTerms });
    expect(p.numbersLeavingPool).toEqual([]);
    expect(p.numbersReturningToPool).toEqual([]);
  });

  it("grows the payout when the destination week is SKIPPED (nothing to settle)", () => {
    const p = movePayoutPreview({
      from: week6,
      to: { ...week9, isSkipped: true },
      payout: hana,
      candidate: hanaTerms,
    });
    expect(p.weeksSettling).toEqual([]);
    // They keep the $250 the old week had taken.
    expect(p.toTotalAfter).toBe(465_000 + 25_000);
    expect(p.cashPositionDelta).toBe(25_000);
  });

  describe("refusals", () => {
    it("refuses a move onto the same week", () => {
      expect(movePayoutRefusal({ from: week6, to: week6, payout: hana })).toBe(
        "That payout is already on this week.",
      );
    });

    it("refuses an UNDRAWN destination and points at the right action instead", () => {
      const refusal = movePayoutRefusal({
        from: week6,
        to: { ...week9, undrawn: true },
        payout: hana,
      });
      // No second money route: moving a whole draw is an existing action.
      expect(refusal).toContain("has no draw yet");
      expect(refusal).toContain("Move the whole draw");
    });

    it("refuses when that number already wins the destination week", () => {
      expect(
        movePayoutRefusal({
          from: week6,
          to: { ...week9, payouts: [{ ...hana, payoutId: "other" }] },
          payout: hana,
        }),
      ).toBe("#19 is already a winner of week 9.");
    });

    it("allows an ordinary move", () => {
      expect(movePayoutRefusal({ from: week6, to: week9, payout: hana })).toBeNull();
    });
  });
});

describe("the sentences the organizer actually reads", () => {
  it("states every consequence in real money", () => {
    const p = addWinnerPreview({ week: week6, candidate: partner, feePercent: FEE });
    expect(previewSentences(p, formatMoney)).toEqual([
      "This week's total goes from $4,650 to $23,250.",
      "#31 leaves the wheel pool.",
      "Abebe's week-6 contribution of $1,000 settles from the payout.",
      "Money committed to payouts rises by $18,600.",
    ]);
  });

  it("says RETURNS for a removal — the distinction that misled the organizer", () => {
    const p = removeWinnerPreview({ week: week6, payout: hana });
    const lines = previewSentences(p, formatMoney);
    expect(lines).toContain("#19 returns to the wheel pool.");
    expect(lines).toContain("Hana's week-6 contribution of $250 becomes owed again.");
    expect(lines).toContain("Money committed to payouts falls by $4,650.");
  });

  it("never emits an empty or zero-money sentence", () => {
    const p = removeWinnerPreview({ week: week6, payout: { ...hana, settlement: 0 } });
    for (const line of previewSentences(p, formatMoney)) {
      expect(line.trim().length).toBeGreaterThan(0);
      expect(line).not.toContain("undefined");
      expect(line).not.toContain("NaN");
    }
  });
});
