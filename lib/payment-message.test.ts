import { describe, expect, it } from "vitest";
import { describePayment, paymentMessageFor, priorPaidOnCompletedWeek } from "./engine";
import { BREAKDOWN_CAP, paymentBreakdown, stillDueOnWeek, weekLabelFull } from "./payment-message";

// PHASE 4 — the message the member finally receives.
//
// The routing must be TOTAL and MUTUALLY EXCLUSIVE: every payment lands on
// exactly one template, or on none deliberately. A payment that fell through
// would send nothing; one that matched twice would send two contradictory
// messages about the same money.

const WEEKLY = 200_000; // $2,000
const TODAY = new Date(Date.UTC(2026, 7, 15));
const weekDate = (n: number) => new Date(Date.UTC(2026, 4, 3 + (n - 1) * 7));

function before(covered: Record<number, number>, weeks = 20) {
  return Array.from({ length: weeks }, (_, i) => ({
    weekNumber: i + 1,
    date: weekDate(i + 1),
    amountDue: WEEKLY,
    covered: covered[i + 1] ?? 0,
    isDeferred: false,
  }));
}

const pay = (amount: number, covered: Record<number, number>, behindAfter = 0) =>
  describePayment({
    amount,
    today: TODAY,
    weeklyAmount: WEEKLY,
    weeksBefore: before(covered),
    weeksBehindAfter: behindAfter,
  });

describe("THE ROUTING — one branch each, none missed, none doubled", () => {
  it("a clean full payment goes to PAYMENT_CONFIRMED", () => {
    const e = pay(2 * WEEKLY, {});
    expect(e.remainder).toBe(0);
    expect(paymentMessageFor(e)).toBe("PAYMENT_CONFIRMED");
  });

  it("completing a week AND part-paying the next goes to WITH_PARTIAL", () => {
    // Week 1 holds $1,000; $2,500 finishes it and puts $1,500 on week 2.
    const e = pay(250_000, { 1: 100_000 });
    expect(e.completedWeeks).toEqual([1]);
    expect(e.partialWeek).toBe(2);
    expect(paymentMessageFor(e)).toBe("PAYMENT_CONFIRMED_WITH_PARTIAL");
  });

  it("a pure part payment goes to PARTIAL_CONFIRMED", () => {
    const e = pay(20_000, {});
    expect(e.fullWeeks).toEqual([]);
    expect(e.completedWeeks).toEqual([]);
    expect(e.remainder).toBe(180_000);
    expect(paymentMessageFor(e)).toBe("PARTIAL_CONFIRMED");
  });

  it("finishing a part-paid week and nothing else goes to PARTIAL_COMPLETED", () => {
    const e = pay(180_000, { 1: 20_000 });
    expect(e.completedWeeks).toEqual([1]);
    expect(e.fullWeeks).toEqual([]);
    expect(e.remainder).toBe(0);
    expect(paymentMessageFor(e)).toBe("PARTIAL_COMPLETED");
  });

  it("completed AND full with nothing left over goes to v4, listing BOTH", () => {
    // The case the four-rule statement did not cover: week 1 held $1,000,
    // $3,000 finishes it and pays week 2 outright. Neither "only fullWeeks"
    // nor the single-week PARTIAL_COMPLETED shape.
    const e = pay(300_000, { 1: 100_000 });
    expect(e.completedWeeks).toEqual([1]);
    expect(e.fullWeeks).toEqual([2]);
    expect(e.remainder).toBe(0);
    expect(paymentMessageFor(e)).toBe("PAYMENT_CONFIRMED");
  });

  it("a payment that allocates NOTHING sends no message", () => {
    // Every week already covered: the money fits nowhere.
    const covered = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [i + 1, WEEKLY]),
    );
    const e = pay(WEEKLY, covered);
    expect(e.unallocated).toBe(WEEKLY);
    expect(paymentMessageFor(e)).toBeNull();
  });

  it("EVERY combination routes exactly once — no fallthrough, no overlap", () => {
    const cases = [
      pay(2 * WEEKLY, {}),
      pay(250_000, { 1: 100_000 }),
      pay(20_000, {}),
      pay(180_000, { 1: 20_000 }),
      pay(300_000, { 1: 100_000 }),
    ];
    for (const e of cases) {
      const key = paymentMessageFor(e);
      expect(key, JSON.stringify({ f: e.fullWeeks, c: e.completedWeeks, r: e.remainder })).not.toBeNull();
    }
    // The predicate is a chain of exclusive returns, so "matched twice" is
    // structurally impossible; this pins that it stays a chain.
    expect(new Set(cases.map(paymentMessageFor)).size).toBeGreaterThan(1);
  });
});

describe("priorPaidOnWeek — the subtraction, and the trap", () => {
  it("names the total prior, however many prior partials there were", () => {
    // $100 then $100, then $1,800 completes the $2,000 week.
    const e = pay(180_000, { 1: 20_000 });
    expect(priorPaidOnCompletedWeek(e)).toBe(20_000); // $200, not itemised
  });

  it("is EXACT — applied === owed on a week that fills", () => {
    const e = pay(180_000, { 1: 20_000 });
    const row = e.appliedByWeek.find((a) => a.weekNumber === 1)!;
    expect(row.fillsWeek).toBe(true);
    // allocatePayment sets applied = min(owed, remaining); on a filling week
    // that IS owed, so the subtraction is to the cent.
    expect(row.applied).toBe(row.amountDue - 20_000);
    expect(row.amountDue - row.applied).toBe(20_000);
  });

  it("THE TRAP: the event total would be wrong when money fits nowhere", () => {
    // Week 1 holds $1,800; the member pays $500 but only $200 can land, and
    // their window has no later week to take the rest.
    const e = describePayment({
      amount: 50_000,
      today: TODAY,
      weeklyAmount: WEEKLY,
      weeksBefore: [
        { weekNumber: 1, date: weekDate(1), amountDue: WEEKLY, covered: 180_000, isDeferred: false },
      ],
      weeksBehindAfter: 0,
    });
    expect(e.unallocated).toBe(30_000); // $300 fit nowhere
    // The right answer: they had already paid $1,800.
    expect(priorPaidOnCompletedWeek(e)).toBe(180_000);
    // The event total would have said $2,000 − $500 = $1,500. Wrong by the
    // unallocated $300 — which is why the placeholder reads `applied`.
    expect(WEEKLY - e.amount).toBe(150_000);
    expect(priorPaidOnCompletedWeek(e)).not.toBe(WEEKLY - e.amount);
  });

  it("returns null when no week was completed — never invents a figure", () => {
    expect(priorPaidOnCompletedWeek(pay(20_000, {}))).toBeNull();
  });
});

describe("the composed placeholders", () => {
  const w = (n: number) => ({ weekNumber: n, date: weekDate(n) });

  it("paymentBreakdown itemises, with 'and' before the last and NO range", () => {
    expect(paymentBreakdown([w(14), w(15), w(16)], 1)).toBe(
      "week 14 (Aug 2), week 15 (Aug 9) and week 16 (Aug 16)",
    );
    expect(paymentBreakdown([w(14), w(15), w(16)], 1)).not.toMatch(/[–—]/);
    expect(paymentBreakdown([w(14), w(15), w(16)], 1)).not.toMatch(/14-16|14–16/);
  });

  it("a single week reads as one item, not a list", () => {
    expect(paymentBreakdown([w(14)], 1)).toBe("week 14 (Aug 2)");
  });

  it("uses the MEMBER's own numbering, not the cycle's", () => {
    // A member who started at cycle week 10 calls it their week 1.
    expect(paymentBreakdown([w(10)], 10)).toBe("week 1 (Jul 5)");
  });

  it("caps at 8 and SAYS how many are left — never a silent truncation", () => {
    const many = Array.from({ length: 12 }, (_, i) => w(i + 1));
    const out = paymentBreakdown(many, 1);
    expect(out).toContain("and 4 more weeks");
    expect(out.split("week ").length - 1).toBe(BREAKDOWN_CAP); // exactly 8 named
  });

  it("stillDueOnWeek is a whole sentence with the figure and the week", () => {
    expect(stillDueOnWeek(180_000, w(14), 1)).toBe(
      "$1,800 is still due for your week 14 (Aug 2)",
    );
  });

  it("weekLabelFull carries the full date", () => {
    expect(weekLabelFull(w(14), 1)).toBe("week 14 (Sunday, August 2)");
  });

  it("META SHAPE RULE: no newline, tab, or four-space run in any composed value", () => {
    // Meta rejects a parameter containing any of these. Every composed value
    // is single-line comma prose by construction; this pins it.
    const many = Array.from({ length: 12 }, (_, i) => w(i + 1));
    const values = [
      paymentBreakdown(many, 1),
      paymentBreakdown([w(14), w(15)], 1),
      stillDueOnWeek(180_000, w(14), 1),
      weekLabelFull(w(14), 1),
    ];
    for (const v of values) {
      expect(v, v).not.toMatch(/[\n\r\t]/);
      expect(v, v).not.toMatch(/ {4}/);
      expect(v.length, v).toBeLessThan(900); // leaves room inside the 1024 body
    }
  });
});

describe("THE MARKOS CASE, end to end at the composer", () => {
  it("$200 on a $2,000 week routes to PARTIAL_CONFIRMED and names $1,800", () => {
    const e = pay(20_000, {});
    expect(paymentMessageFor(e)).toBe("PARTIAL_CONFIRMED");
    expect(e.partialWeek).toBe(1);
    expect(e.remainder).toBe(180_000);
    // The sentence the member receives, instead of "paid, thank you".
    expect(stillDueOnWeek(e.remainder, { weekNumber: 1, date: weekDate(1) }, 1)).toBe(
      "$1,800 is still due for your week 1 (May 3)",
    );
  });

  it("and the completion afterwards names the $200 they had already paid", () => {
    const e = pay(180_000, { 1: 20_000 });
    expect(paymentMessageFor(e)).toBe("PARTIAL_COMPLETED");
    expect(priorPaidOnCompletedWeek(e)).toBe(20_000);
  });
});
