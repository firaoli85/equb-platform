import { describe, expect, it } from "vitest";
import {
  feeOnReturn,
  finalPosition,
  finalPositionAdminLine,
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
  const tsion = { paidIn: 470_000, received: 0, weeklyAmount: 50_000, weeksCommitted: 20 };

  it("owes them everything they paid in", () => {
    const p = finalPosition(tsion);
    expect(p.direction).toBe("owed-to-them");
    if (p.direction !== "owed-to-them") throw new Error("unreachable");
    expect(p.paidIn).toBe(470_000);
    expect(p.amount).toBe(470_000);
  });

  // THE READING, PINNED. A fee is defined against a PAYOUT everywhere it is
  // defined — DOMAIN_RULES rule 2: "charged per member payout ... BECAUSE THEY
  // RECEIVE THREE PAYOUTS". Someone never drawn never had one, so no fee has
  // ever been taken from them and none is owed now.
  it("withholds NO fee — a fee is only ever taken from a payout", () => {
    const p = finalPosition(tsion);
    if (p.direction !== "owed-to-them") throw new Error("unreachable");
    expect(p.fee).toBe(0);
    expect(feeOnReturn()).toBe(0);
    // NOT $4,606. That figure charges 2% for a payout they never received.
    expect(p.amount).not.toBe(460_600);
  });

  it("says it plainly, and names who will arrange it", () => {
    expect(finalPositionSentence(finalPosition(tsion), "Firaoli", money)).toBe(
      "You paid in $4,700. You were not drawn. $4,700 is owed to you — Firaoli will arrange it.",
    );
  });

  it("tells the organizer he owes it, and why no fee applies", () => {
    const line = finalPositionAdminLine(finalPosition(tsion), "Tsion", money);
    expect(line).toContain("You owe Tsion $4,700");
    expect(line).toContain("never drawn");
    expect(line).toContain("a fee is only ever taken from a payout");
  });

  it("is money he is HOLDING that is not his — positive, from his side", () => {
    expect(owedToStoppedMember(finalPosition(tsion))).toBe(470_000);
  });

  it("says nothing is outstanding when they paid nothing and were never drawn", () => {
    const p = finalPosition({ ...tsion, paidIn: 0 });
    expect(p.direction).toBe("settled");
    expect(finalPositionSentence(p, "Firaoli", money)).toContain("Nothing is outstanding either way");
  });
});

describe("DRAWN, THEN STOPPED — they owe the group", () => {
  // The organizer's own example: $1,000/week for 20 weeks, drawn and paid
  // $19,600 net, stopped having paid $12,000.
  const meheret = { paidIn: 1_200_000, received: 1_960_000, weeklyAmount: 100_000, weeksCommitted: 20 };

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
    expect(finalPositionSentence(finalPosition(meheret), "Firaoli", money)).toBe(
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
    expect(finalPositionSentence(p, "Firaoli", money)).toContain("received $19,600");
  });

  it("is settled, not owed-to-them, when they overpaid a payout they took", () => {
    const p = finalPosition({ ...meheret, paidIn: 2_500_000 });
    expect(p.direction).toBe("settled");
  });
});

describe("the direction is decided by the DRAW, not by the size of the figures", () => {
  it("never drawn is owed, however little they paid", () => {
    const p = finalPosition({ paidIn: 5_000, received: 0, weeklyAmount: 100_000, weeksCommitted: 20 });
    expect(p.direction).toBe("owed-to-them");
  });

  it("drawn is owing, however much they paid — short of the commitment", () => {
    const p = finalPosition({
      paidIn: 1_999_999,
      received: 1_960_000,
      weeklyAmount: 100_000,
      weeksCommitted: 20,
    });
    expect(p.direction).toBe("they-owe");
    if (p.direction !== "they-owe") throw new Error("unreachable");
    expect(p.amount).toBe(1);
  });
});

describe("the sentence is fit to be read by the person it is about", () => {
  const cases = [
    { paidIn: 470_000, received: 0, weeklyAmount: 50_000, weeksCommitted: 20 },
    { paidIn: 1_200_000, received: 1_960_000, weeklyAmount: 100_000, weeksCommitted: 20 },
    { paidIn: 2_000_000, received: 1_960_000, weeklyAmount: 100_000, weeksCommitted: 20 },
    { paidIn: 0, received: 0, weeklyAmount: 50_000, weeksCommitted: 20 },
  ];

  // Their own frame: dates and their own counts, never the organizer's week
  // numbers (UI_STANDARDS 8c).
  it("never mentions a cycle week number", () => {
    for (const c of cases) {
      const s = finalPositionSentence(finalPosition(c), "Firaoli", money);
      expect(s).not.toMatch(/\bweek \d+\b/i);
    }
  });

  it("never leaves the figure implicit, and never emits a broken one", () => {
    for (const c of cases) {
      const s = finalPositionSentence(finalPosition(c), "Firaoli", money);
      expect(s).not.toContain("NaN");
      expect(s).not.toContain("undefined");
      expect(s).not.toContain("$-");
      expect(s.length).toBeGreaterThan(40);
      // Every sentence states what happens next, or that nothing does.
      expect(s).toMatch(/will arrange it|will be in touch|Nothing is outstanding/);
    }
  });

  it("uses no accounting vocabulary (UI_STANDARDS 8b)", () => {
    const banned = /\b(uncommitted|committed to|owed forward|net|reconcil\w*|arrears|debit|credit)\b/i;
    for (const c of cases) {
      expect(finalPositionSentence(finalPosition(c), "Firaoli", money)).not.toMatch(banned);
    }
  });

  it("the member's figure and the organizer's are the SAME figure", () => {
    for (const c of cases) {
      const p = finalPosition(c);
      const owed = owedToStoppedMember(p);
      if (p.direction === "owed-to-them") {
        expect(finalPositionSentence(p, "F", money)).toContain(money(owed));
        expect(finalPositionAdminLine(p, "T", money)).toContain(money(owed));
      }
      if (p.direction === "they-owe") {
        expect(finalPositionSentence(p, "F", money)).toContain(money(-owed));
        expect(finalPositionAdminLine(p, "T", money)).toContain(money(-owed));
      }
    }
  });
});
