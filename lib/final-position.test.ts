import { describe, expect, it } from "vitest";
import {
  feeOnReturn,
  finalPosition,
  finalPositionAdminLine,
  finalPositionHeadline,
  finalPositionSentence,
  owedToStoppedMember,
} from "./final-position";
import { formatMoney } from "./format";

// Tsion stopped mid-cycle and her portal showed a blank wall. 2.18 says closed
// members KEEP access and can see where they stopped. The figure below is the
// one thing neither she nor the organizer can work out on their own.

const money = formatMoney;

describe("PAID IN, NEVER DRAWN — the group owes THEM", () => {
  // The organizer's own example: $4,700 paid in, never drawn.
  // $500/week for 20 weeks — a $10,000 commitment, so a $200 fee, whatever
  // she actually attended.
  const tsion = {
    paidIn: 470_000,
    received: 0,
    weeklyAmount: 50_000,
    weeksCommitted: 20,
    unitAmount: 100_000,
    feePercent: 2,
  };

  it("owes them what they paid in, LESS the fee on their commitment", () => {
    const p = finalPosition(tsion);
    expect(p.direction).toBe("owed-to-them");
    if (p.direction !== "owed-to-them") throw new Error("unreachable");
    expect(p.paidIn).toBe(470_000);
    expect(p.fee).toBe(20_000); // 2% of the $10,000 commitment
    expect(p.amount).toBe(450_000); // $4,700 − $200
  });

  // THE RULE, PINNED — the organizer's correction. THE FEE IS FIXED BY THE
  // COMMITMENT, NOT BY ATTENDANCE. This replaces an earlier reading of
  // DOMAIN_RULES rule 2 ("charged per member payout") as "no payout, no fee",
  // which returned her the full $4,700. Rule 2 now states the commitment rule
  // outright so it cannot be read that way again.
  it("the fee follows the COMMITMENT, not how much of it they attended", () => {
    const commitmentFee = feeOnReturn({
      weeklyAmount: 50_000,
      weeksCommitted: 20,
      unitAmount: 100_000,
      feePercent: 2,
    });
    expect(commitmentFee).toBe(20_000); // 20 × $500 = $10,000 → $200

    // Stopping at week 12 does not reduce it. Neither does stopping at week 1.
    for (const paidIn of [50_000, 600_000, 470_000]) {
      const p = finalPosition({ ...tsion, paidIn });
      if (p.direction !== "owed-to-them") throw new Error("unreachable");
      expect(p.fee).toBe(20_000);
    }
  });

  // Only the contribution RATE moves it.
  it("the fee changes when the RATE changes, and only then", () => {
    expect(
      feeOnReturn({ weeklyAmount: 25_000, weeksCommitted: 20, unitAmount: 100_000, feePercent: 2 }),
    ).toBe(10_000); // $250/week → 20 × $250 = $5,000 → $100
    // Same rate, fewer weeks committed: a smaller commitment, a smaller fee.
    expect(
      feeOnReturn({ weeklyAmount: 50_000, weeksCommitted: 10, unitAmount: 100_000, feePercent: 2 }),
    ).toBe(10_000);
  });

  // ONE DERIVATION: summed PER LUCKY NUMBER, like every other fee figure.
  it("sums per lucky number, so it cannot drift from the portal", () => {
    // $2,000/week at a $1,000 unit is TWO numbers, each its own fee.
    expect(
      feeOnReturn({ weeklyAmount: 200_000, weeksCommitted: 20, unitAmount: 100_000, feePercent: 2 }),
    ).toBe(80_000); // 2 × ($20,000 × 2%)
  });

  // MONEY IS RETURNED AT THE END OF THE CYCLE, not on stopping — paying out
  // early takes it from the members still contributing. The date is part of
  // the sentence, not a footnote.
  it("states the figure, the fee, and WHEN it will be settled", () => {
    expect(
      finalPositionSentence(
        finalPosition(tsion),
        "Firaoli",
        money,
        "Sunday, September 27, 2026",
      ),
    ).toBe(
      "You paid in $4,700. You were not drawn. $4,500 is owed to you after the $200 fee — " +
        "Firaoli will settle this when the cycle finishes on Sunday, September 27, 2026.",
    );
  });

  it("still says WHEN, even with no date to give", () => {
    const s = finalPositionSentence(finalPosition(tsion), "Firaoli", money, null);
    expect(s).toContain("when the cycle finishes");
    expect(s).not.toContain("null");
    expect(s).not.toContain("undefined");
  });

  it("tells the organizer what he owes, and NOT to settle it yet", () => {
    const line = finalPositionAdminLine(finalPosition(tsion), "Tsion", money);
    expect(line).toContain("You owe Tsion $4,500");
    expect(line).toContain("never drawn");
    expect(line).toContain("$200 fee on their commitment");
    expect(line).toContain("Settle it when the cycle finishes, not before");
    expect(line).toContain("takes it from the members still contributing");
  });

  it("is money he is HOLDING that is not his — positive, from his side", () => {
    expect(owedToStoppedMember(finalPosition(tsion))).toBe(450_000);
  });

  it("says nothing is outstanding when they paid nothing and were never drawn", () => {
    const p = finalPosition({ ...tsion, paidIn: 0 });
    expect(p.direction).toBe("settled");
    expect(finalPositionSentence(p, "Firaoli", money, "Sunday, September 27, 2026")).toContain("Nothing is outstanding either way");
  });
});

describe("DRAWN, THEN STOPPED — they owe the group", () => {
  // The organizer's own example: $1,000/week for 20 weeks, drawn and paid
  // $19,600 net, stopped having paid $12,000.
  const meheret = {
    paidIn: 1_200_000,
    received: 1_960_000,
    weeklyAmount: 100_000,
    weeksCommitted: 20,
    unitAmount: 100_000,
    feePercent: 2,
  };

  it("owes their WHOLE commitment, less what they paid", () => {
    const p = finalPosition(meheret);
    expect(p.direction).toBe("they-owe");
    if (p.direction !== "they-owe") throw new Error("unreachable");
    expect(p.committed).toBe(2_000_000); // 20 × $1,000
    expect(p.amount).toBe(800_000); // $20,000 − $12,000
  });

  // The pot they took was funded by everyone paying EVERY week. Owing only up
  // to where they stopped would let the pot be taken for part of the price.
  it("does not stop at the week they stopped — the pot was the whole price", () => {
    const p = finalPosition(meheret);
    if (p.direction !== "they-owe") throw new Error("unreachable");
    expect(p.amount).toBe(2_000_000 - 1_200_000);
  });

  it("says it plainly, in the organizer's own words", () => {
    expect(finalPositionSentence(finalPosition(meheret), "Firaoli", money, "Sunday, September 27, 2026")).toBe(
      "You paid in $12,000 and received $19,600. $8,000 of your contributions was not paid. " +
        "Firaoli will be in touch.",
    );
  });

  it("tells the organizer what he is owed", () => {
    const line = finalPositionAdminLine(finalPosition(meheret), "Meheret", money);
    expect(line).toContain("Meheret owes $8,000");
    expect(line).toContain("received $19,600");
    expect(line).toContain("$20,000 commitment");
  });

  it("is NEGATIVE from his side — it is not money he is holding", () => {
    expect(owedToStoppedMember(finalPosition(meheret))).toBe(-800_000);
  });

  it("is settled when they took the pot AND paid every week", () => {
    const p = finalPosition({ ...meheret, paidIn: 2_000_000 });
    expect(p.direction).toBe("settled");
    expect(owedToStoppedMember(p)).toBe(0);
    expect(finalPositionSentence(p, "Firaoli", money, "Sunday, September 27, 2026")).toContain("received $19,600");
  });

  it("is settled, not owed-to-them, when they overpaid a payout they took", () => {
    const p = finalPosition({ ...meheret, paidIn: 2_500_000 });
    expect(p.direction).toBe("settled");
  });
});

describe("the direction is decided by the DRAW, not by the size of the figures", () => {
  it("never drawn is owed, whenever they paid in more than the fee", () => {
    const p = finalPosition({
      paidIn: 45_000,
      received: 0,
      weeklyAmount: 100_000,
      weeksCommitted: 20,
      unitAmount: 100_000,
      feePercent: 2,
    });
    expect(p.direction).toBe("owed-to-them");
    if (p.direction !== "owed-to-them") throw new Error("unreachable");
    expect(p.fee).toBe(40_000); // 2% of the $20,000 commitment
    expect(p.amount).toBe(5_000);
  });

  // THE EDGE THE COMMITMENT RULE CREATES, and an OPEN QUESTION for the
  // organizer. Someone who paid $50 against a $20,000 commitment owes a $400
  // fee they have not covered. Nothing is returned to them — that much is
  // certain, and it is what this does. Whether he then CHASES the remaining
  // $350 is his ruling to make, and nothing here decides it for him: the
  // amount is floored at zero rather than turned into a debt nobody agreed to.
  it("returns nothing when the commitment fee exceeds what they paid in", () => {
    const p = finalPosition({
      paidIn: 5_000,
      received: 0,
      weeklyAmount: 100_000,
      weeksCommitted: 20,
      unitAmount: 100_000,
      feePercent: 2,
    });
    expect(p.direction).toBe("settled");
    // Never a negative return, and never silently converted into a debt.
    expect(owedToStoppedMember(p)).toBe(0);
  });

  it("drawn is owing, however much they paid — short of the commitment", () => {
    const p = finalPosition({
      paidIn: 1_999_999,
      received: 1_960_000,
      weeklyAmount: 100_000,
      weeksCommitted: 20,
      unitAmount: 100_000,
      feePercent: 2,
    });
    expect(p.direction).toBe("they-owe");
    if (p.direction !== "they-owe") throw new Error("unreachable");
    expect(p.amount).toBe(1);
  });
});

describe("the sentence is fit to be read by the person it is about", () => {
  const cases = [
    { paidIn: 470_000, received: 0, weeklyAmount: 50_000, weeksCommitted: 20, unitAmount: 100_000, feePercent: 2 },
    { paidIn: 1_200_000, received: 1_960_000, weeklyAmount: 100_000, weeksCommitted: 20, unitAmount: 100_000, feePercent: 2 },
    { paidIn: 2_000_000, received: 1_960_000, weeklyAmount: 100_000, weeksCommitted: 20, unitAmount: 100_000, feePercent: 2 },
    { paidIn: 0, received: 0, weeklyAmount: 50_000, weeksCommitted: 20, unitAmount: 100_000, feePercent: 2 },
  ];

  // Their own frame: dates and their own counts, never the organizer's week
  // numbers (UI_STANDARDS 8c).
  it("never mentions a cycle week number", () => {
    for (const c of cases) {
      const s = finalPositionSentence(finalPosition(c), "Firaoli", money, "Sunday, September 27, 2026");
      expect(s).not.toMatch(/\bweek \d+\b/i);
    }
  });

  it("never leaves the figure implicit, and never emits a broken one", () => {
    for (const c of cases) {
      const s = finalPositionSentence(finalPosition(c), "Firaoli", money, "Sunday, September 27, 2026");
      expect(s).not.toContain("NaN");
      expect(s).not.toContain("undefined");
      expect(s).not.toContain("$-");
      expect(s.length).toBeGreaterThan(40);
      // Every sentence states what happens next, or that nothing does.
      expect(s).toMatch(/will settle this when the cycle finishes|will be in touch|Nothing is outstanding/);
    }
  });

  it("uses no accounting vocabulary (UI_STANDARDS 8b)", () => {
    const banned = /\b(uncommitted|committed to|owed forward|net|reconcil\w*|arrears|debit|credit)\b/i;
    for (const c of cases) {
      expect(finalPositionSentence(finalPosition(c), "Firaoli", money, "Sunday, September 27, 2026")).not.toMatch(banned);
    }
  });

  it("the member's figure and the organizer's are the SAME figure", () => {
    for (const c of cases) {
      const p = finalPosition(c);
      const owed = owedToStoppedMember(p);
      if (p.direction === "owed-to-them") {
        expect(finalPositionSentence(p, "F", money, "Sunday, September 27, 2026")).toContain(money(owed));
        expect(finalPositionAdminLine(p, "T", money)).toContain(money(owed));
      }
      if (p.direction === "they-owe") {
        expect(finalPositionSentence(p, "F", money, "Sunday, September 27, 2026")).toContain(money(-owed));
        expect(finalPositionAdminLine(p, "T", money)).toContain(money(-owed));
      }
    }
  });
});

// ————————————————————————————————————————————————————————————————
// THE HEADLINE ON THE STOPPED-MEMBER CARD (organizer ruling, 14 Aug 2026 —
// audit item #8: the figure was computed on every closed profile and shown
// nowhere).
//
// All three branches against the SAME fixtures the derivation tests use
// above, so the sentence and the arithmetic can never drift apart (2.24).
// ————————————————————————————————————————————————————————————————

describe("finalPositionHeadline — the one line the organizer reads in a hurry", () => {
  /** Tsion: $4,700 in, never drawn, $200 fee on a $10,000 commitment. */
  const owedToThem = {
    paidIn: 470_000,
    received: 0,
    weeklyAmount: 50_000,
    weeksCommitted: 20,
    unitAmount: 100_000,
    feePercent: 2,
  };
  /** Meheret: drawn $19,600 net, paid $12,000 of a $20,000 commitment. */
  const theyOwe = {
    paidIn: 1_200_000,
    received: 1_960_000,
    weeklyAmount: 100_000,
    weeksCommitted: 20,
    unitAmount: 100_000,
    feePercent: 2,
  };

  it("HE OWES THEM: names the direction and the figure", () => {
    const p = finalPosition(owedToThem);
    expect(p.direction).toBe("owed-to-them");
    // $4,700 paid in − $200 fee. The figure is the one the derivation test
    // above pins, written out here rather than derived (lesson 5.6).
    expect(finalPositionHeadline(p, money)).toBe("Final position: you owe them $4,500.");
  });

  it("THEY OWE HIM: names the direction and the figure", () => {
    const p = finalPosition(theyOwe);
    expect(p.direction).toBe("they-owe");
    expect(finalPositionHeadline(p, money)).toBe("Final position: they owe you $8,000.");
  });

  it("SETTLED after a draw: says so plainly, with no figure to misread", () => {
    const p = finalPosition({ ...theyOwe, paidIn: 2_000_000 });
    expect(p.direction).toBe("settled");
    expect(finalPositionHeadline(p, money)).toBe(
      "Final position: settled, nothing owed either way.",
    );
  });

  it("SETTLED never drawn and never paid: the same sentence, not “$0 owed”", () => {
    const p = finalPosition({ ...owedToThem, paidIn: 0 });
    expect(p.direction).toBe("settled");
    expect(finalPositionHeadline(p, money)).toBe(
      "Final position: settled, nothing owed either way.",
    );
  });

  it("agrees with the signed figure, so the line and the ledger cannot disagree", () => {
    expect(owedToStoppedMember(finalPosition(owedToThem))).toBe(450_000);
    expect(finalPositionHeadline(finalPosition(owedToThem), money)).toContain("$4,500");
    expect(owedToStoppedMember(finalPosition(theyOwe))).toBe(-800_000);
    expect(finalPositionHeadline(finalPosition(theyOwe), money)).toContain("$8,000");
  });

  it("carries NO DASH — the standing rule for anything that may reach a member", () => {
    for (const input of [owedToThem, theyOwe, { ...theyOwe, paidIn: 2_000_000 }]) {
      const line = finalPositionHeadline(finalPosition(input), money);
      expect(line).not.toContain("—");
      expect(line).not.toContain("–");
    }
  });
});
