import { describe, expect, it } from "vitest";
import { feePreview, feeSentence, splitSentence } from "./fee-preview";
import { formatMoney } from "./format";
import { calculateFee, splitIntoLuckyNumbers } from "./money";
import { calculatePayout } from "./wheel";

// THE REAL SITUATION. The organizer is on the phone with someone deciding
// whether to join. They ask "if I put in $750 a week, what's your fee?" — and
// people propose irregular figures, so this must answer for ANY amount.

const UNIT = 100_000; // $1,000, the live cycle's unit
const FEE = 2;

describe("feePreview — the organizer's own worked example", () => {
  it("answers $750 a week for 20 weeks exactly as he says it", () => {
    const p = feePreview({ weeklyAmount: 75_000, weeksCommitted: 20, unitAmount: UNIT, feePercent: FEE })!;
    expect(p.gross).toBe(1_500_000); // $15,000
    expect(p.fee).toBe(30_000); //     $300
    expect(p.net).toBe(1_470_000); //  $14,700
    expect(feeSentence(p, formatMoney)).toBe(
      "$750 a week for 20 weeks: they receive $15,000, my fee is $300, they get $14,700.",
    );
  });

  it("says nothing about splitting when the amount is one number", () => {
    const p = feePreview({ weeklyAmount: 75_000, weeksCommitted: 20, unitAmount: UNIT, feePercent: FEE })!;
    expect(p.splits).toBe(false);
    expect(splitSentence(p, formatMoney)).toBe("");
  });
});

// ANY FIGURE, NOT A TIER LIST. These are the shapes people actually propose.
describe("irregular amounts — no tiers anywhere", () => {
  const cases: { weekly: number; weeks: number; gross: number; fee: number; net: number }[] = [
    { weekly: 80_000, weeks: 20, gross: 1_600_000, fee: 32_000, net: 1_568_000 }, // $800
    { weekly: 32_500, weeks: 20, gross: 650_000, fee: 13_000, net: 637_000 }, //     $325
    { weekly: 32_500, weeks: 13, gross: 422_500, fee: 8_450, net: 414_050 }, //      $325, odd weeks
    { weekly: 45_000, weeks: 9, gross: 405_000, fee: 8_100, net: 396_900 }, //       $450
    { weekly: 1_234, weeks: 7, gross: 8_638, fee: 173, net: 8_465 }, //              $12.34
  ];

  for (const c of cases) {
    it(`${formatMoney(c.weekly)} a week for ${c.weeks} weeks`, () => {
      const p = feePreview({
        weeklyAmount: c.weekly,
        weeksCommitted: c.weeks,
        unitAmount: UNIT,
        feePercent: FEE,
      })!;
      expect(p.gross).toBe(c.gross);
      expect(p.fee).toBe(c.fee);
      expect(p.net).toBe(c.net);
      expect(p.net).toBe(p.gross - p.fee);
    });
  }
});

describe("multi-number splits — each number is its own payout and its own fee (rule 2)", () => {
  it("$1,250 becomes $1,000 and $250, and the sentence names both", () => {
    const p = feePreview({ weeklyAmount: 125_000, weeksCommitted: 20, unitAmount: UNIT, feePercent: FEE })!;
    expect(p.numbers.map((n) => n.amount)).toEqual([100_000, 25_000]);
    expect(p.splits).toBe(true);
    expect(splitSentence(p, formatMoney)).toBe(
      "That splits into 2 lucky numbers — $1,000 and $250 — each drawn separately and each paying its own fee.",
    );
  });

  it("each line carries ITS OWN gross, fee and net — the record the archive keeps", () => {
    const p = feePreview({ weeklyAmount: 200_000, weeksCommitted: 20, unitAmount: UNIT, feePercent: FEE })!;
    // DOMAIN_RULES rule 2, verbatim: two payouts of $20,000 / $400 / $19,600 —
    // NOT one $40,000 payout with a single $800 fee.
    expect(p.numbers).toEqual([
      { amount: 100_000, gross: 2_000_000, fee: 40_000, net: 1_960_000 },
      { amount: 100_000, gross: 2_000_000, fee: 40_000, net: 1_960_000 },
    ]);
    expect(p.fee).toBe(80_000);
  });

  it("$1,875 splits into $1,000 and $875", () => {
    const p = feePreview({ weeklyAmount: 187_500, weeksCommitted: 20, unitAmount: UNIT, feePercent: FEE })!;
    expect(p.numbers.map((n) => n.amount)).toEqual([100_000, 87_500]);
    expect(p.gross).toBe(3_750_000);
    expect(p.fee).toBe(75_000);
  });

  it("three numbers list correctly in the sentence", () => {
    const p = feePreview({ weeklyAmount: 250_000, weeksCommitted: 20, unitAmount: UNIT, feePercent: FEE })!;
    expect(splitSentence(p, formatMoney)).toContain("3 lucky numbers — $1,000, $1,000 and $500");
  });
});

// ONE DERIVATION, NOT TWO. This is the requirement that made the module sum
// per number instead of computing the fee on the total.
describe("agreement with the member portal", () => {
  it("every line equals what the portal computes for that number", () => {
    // app/actions/member.ts derives each number through calculatePayout; so
    // does this. Any divergence would show the organizer one figure on the
    // phone and the member another on their own screen.
    for (const weekly of [32_500, 75_000, 125_000, 187_500, 250_000]) {
      const p = feePreview({ weeklyAmount: weekly, weeksCommitted: 20, unitAmount: UNIT, feePercent: FEE })!;
      const portal = splitIntoLuckyNumbers(weekly, UNIT).map((amount, i) =>
        calculatePayout({
          luckyNumber: { id: `n${i}`, amount },
          participation: { weeksCommitted: 20 },
          cycle: { feePercent: FEE },
        }),
      );
      expect(p.numbers.map((n) => ({ gross: n.gross, fee: n.fee, net: n.net }))).toEqual(
        portal.map((x) => ({ gross: x.gross, fee: x.fee, net: x.net })),
      );
    }
  });

  // THE CASE THAT PROVES IT IS NOT A COINCIDENCE. At 2% on round units the
  // per-number and total-first roads happen to meet. On a fee percent that
  // does not divide evenly they do NOT, and the portal's answer is the
  // per-number one — so this module must give the same and not the tidier
  // total-first figure.
  it("rounds PER NUMBER, matching the portal, where total-first would differ", () => {
    const oddUnit = 12_345; // $123.45
    const p = feePreview({
      weeklyAmount: oddUnit * 2,
      weeksCommitted: 1,
      unitAmount: oddUnit,
      feePercent: 2.5,
    })!;
    expect(p.numbers.map((n) => n.fee)).toEqual([309, 309]);
    expect(p.fee).toBe(618);
    // The road not taken: a fee computed on the combined gross.
    expect(calculateFee(p.gross, 2.5)).toBe(617);
    expect(p.fee).not.toBe(calculateFee(p.gross, 2.5));
  });
});

describe("the cycle's real configuration, never hardcoded (2.6)", () => {
  it("uses the cycle's fee percent", () => {
    const at2 = feePreview({ weeklyAmount: 75_000, weeksCommitted: 20, unitAmount: UNIT, feePercent: 2 })!;
    const at5 = feePreview({ weeklyAmount: 75_000, weeksCommitted: 20, unitAmount: UNIT, feePercent: 5 })!;
    expect(at2.fee).toBe(30_000);
    expect(at5.fee).toBe(75_000);
  });

  it("uses the cycle's unit amount to decide the split", () => {
    const atThousand = feePreview({ weeklyAmount: 150_000, weeksCommitted: 20, unitAmount: 100_000, feePercent: FEE })!;
    const atFiveHundred = feePreview({ weeklyAmount: 150_000, weeksCommitted: 20, unitAmount: 50_000, feePercent: FEE })!;
    expect(atThousand.numbers).toHaveLength(2);
    expect(atFiveHundred.numbers).toHaveLength(3);
    // The split changes; the money does not.
    expect(atThousand.gross).toBe(atFiveHundred.gross);
  });

  it("a zero fee percent is honoured, not treated as missing", () => {
    const p = feePreview({ weeklyAmount: 75_000, weeksCommitted: 20, unitAmount: UNIT, feePercent: 0 })!;
    expect(p.fee).toBe(0);
    expect(p.net).toBe(p.gross);
  });
});

describe("a half-typed form shows nothing, never a wrong number", () => {
  const base = { weeksCommitted: 20, unitAmount: UNIT, feePercent: FEE };
  it("returns null for an empty or zero amount", () => {
    expect(feePreview({ ...base, weeklyAmount: 0 })).toBeNull();
    expect(feePreview({ ...base, weeklyAmount: Number.NaN })).toBeNull();
  });
  it("returns null for a fractional cent", () => {
    expect(feePreview({ ...base, weeklyAmount: 1_234.5 })).toBeNull();
  });
  it("returns null before a week count is entered", () => {
    expect(feePreview({ ...base, weeklyAmount: 75_000, weeksCommitted: 0 })).toBeNull();
  });
  it("returns null rather than throwing when the amount would produce absurd numbers", () => {
    // splitIntoLuckyNumbers throws past the per-member ceiling; a live-typing
    // field must never surface that as a crash.
    expect(feePreview({ weeklyAmount: 99_999_999, weeksCommitted: 20, unitAmount: 100, feePercent: FEE })).toBeNull();
  });
  it("returns null for a nonsense fee percent", () => {
    expect(feePreview({ ...base, weeklyAmount: 75_000, feePercent: -1 })).toBeNull();
    expect(feePreview({ ...base, weeklyAmount: 75_000, feePercent: 101 })).toBeNull();
  });
});

describe("the sentence reads aloud", () => {
  it("is singular for a one-week commitment", () => {
    const p = feePreview({ weeklyAmount: 75_000, weeksCommitted: 1, unitAmount: UNIT, feePercent: FEE })!;
    expect(feeSentence(p, formatMoney)).toContain("for 1 week:");
  });
  it("never contains a placeholder, NaN or undefined", () => {
    for (const weekly of [1, 32_500, 125_000, 1_000_000]) {
      const p = feePreview({ weeklyAmount: weekly, weeksCommitted: 20, unitAmount: UNIT, feePercent: FEE })!;
      const text = `${feeSentence(p, formatMoney)} ${splitSentence(p, formatMoney)}`;
      expect(text).not.toContain("NaN");
      expect(text).not.toContain("undefined");
      expect(text).not.toContain("$-");
    }
  });
});
