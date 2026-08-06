import { describe, expect, it } from "vitest";
import { allocatePayment, type AllocationWeek } from "./allocation";

/** Build a run of weeks at one rate, all unpaid unless overridden. */
function weeks(
  from: number,
  to: number,
  amountDue: number,
  overrides: Partial<Record<number, Partial<AllocationWeek>>> = {},
): AllocationWeek[] {
  const list: AllocationWeek[] = [];
  for (let n = from; n <= to; n++) {
    list.push({
      weekNumber: n,
      amountDue,
      amountAlreadyPaid: 0,
      isSkipped: false,
      ...overrides[n],
    });
  }
  return list;
}

describe("allocatePayment — the ground-truth cases (2.15, 2.19)", () => {
  it("$250/wk owing weeks 8–12, receive $750 -> clears 8, 9, 10", () => {
    const result = allocatePayment(75_000, weeks(8, 12, 25_000));
    expect(result.allocations).toEqual([
      { weekNumber: 8, applied: 25_000, fillsWeek: true, runningRemainder: 50_000 },
      { weekNumber: 9, applied: 25_000, fillsWeek: true, runningRemainder: 25_000 },
      { weekNumber: 10, applied: 25_000, fillsWeek: true, runningRemainder: 0 },
    ]);
    expect(result.totalApplied).toBe(75_000);
    expect(result.unallocated).toBe(0);
  });

  it("same member receives $650 -> clears 8 and 9, leaves $150 partial on week 10", () => {
    const result = allocatePayment(65_000, weeks(8, 12, 25_000));
    expect(result.allocations).toEqual([
      { weekNumber: 8, applied: 25_000, fillsWeek: true, runningRemainder: 40_000 },
      { weekNumber: 9, applied: 25_000, fillsWeek: true, runningRemainder: 15_000 },
      { weekNumber: 10, applied: 15_000, fillsWeek: false, runningRemainder: 0 },
    ]);
    expect(result.totalApplied).toBe(65_000);
    expect(result.unallocated).toBe(0);
  });

  it("uneven rate: $450/wk, receive $1,000 -> 2 full weeks + $100 partial", () => {
    const result = allocatePayment(100_000, weeks(1, 5, 45_000));
    expect(result.allocations).toEqual([
      { weekNumber: 1, applied: 45_000, fillsWeek: true, runningRemainder: 55_000 },
      { weekNumber: 2, applied: 45_000, fillsWeek: true, runningRemainder: 10_000 },
      { weekNumber: 3, applied: 10_000, fillsWeek: false, runningRemainder: 0 },
    ]);
  });

  it("paying ahead: fully current, extra money lands on future weeks", () => {
    const list = weeks(1, 6, 25_000, {
      1: { amountAlreadyPaid: 25_000 },
      2: { amountAlreadyPaid: 25_000 },
      3: { amountAlreadyPaid: 25_000 },
    });
    const result = allocatePayment(50_000, list);
    expect(result.allocations).toEqual([
      { weekNumber: 4, applied: 25_000, fillsWeek: true, runningRemainder: 25_000 },
      { weekNumber: 5, applied: 25_000, fillsWeek: true, runningRemainder: 0 },
    ]);
  });

  it("SKIPPED weeks are passed over entirely — nobody ever owed them", () => {
    const list = weeks(8, 10, 25_000, { 8: { isSkipped: true } });
    const result = allocatePayment(25_000, list);
    expect(result.allocations).toEqual([
      { weekNumber: 9, applied: 25_000, fillsWeek: true, runningRemainder: 0 },
    ]);
  });

  it("a skipped week between debts is passed over, not filled", () => {
    const list = weeks(8, 12, 25_000, { 10: { isSkipped: true } });
    const result = allocatePayment(75_000, list);
    expect(result.allocations.map((a) => a.weekNumber)).toEqual([8, 9, 11]);
  });

  // The organizer ruling (Aug 2026): a DEFERRED week is still owed, so the
  // engine never even hears about deferral — money lands on it like any other
  // week, oldest first. There is no isDeferred on AllocationWeek by design.
  it("a deferred week is an ordinary week to the engine — money lands on it", () => {
    const list = weeks(8, 10, 25_000);
    const result = allocatePayment(25_000, list);
    expect(result.allocations).toEqual([
      { weekNumber: 8, applied: 25_000, fillsWeek: true, runningRemainder: 0 },
    ]);
  });
});

describe("allocatePayment — oldest debt first with existing money", () => {
  it("tops up a partially-paid oldest week before moving forward", () => {
    const list = weeks(8, 10, 25_000, { 8: { amountAlreadyPaid: 10_000 } });
    const result = allocatePayment(20_000, list);
    expect(result.allocations).toEqual([
      { weekNumber: 8, applied: 15_000, fillsWeek: true, runningRemainder: 5_000 },
      { weekNumber: 9, applied: 5_000, fillsWeek: false, runningRemainder: 0 },
    ]);
  });

  it("skips weeks that are already full (and overpaid weeks)", () => {
    const list = weeks(1, 3, 25_000, {
      1: { amountAlreadyPaid: 25_000 },
      2: { amountAlreadyPaid: 30_000 },
    });
    const result = allocatePayment(10_000, list);
    expect(result.allocations).toEqual([
      { weekNumber: 3, applied: 10_000, fillsWeek: false, runningRemainder: 0 },
    ]);
  });
});

describe("allocatePayment — edges", () => {
  it("zero received -> nothing applied, nothing unallocated", () => {
    const result = allocatePayment(0, weeks(1, 3, 25_000));
    expect(result).toEqual({ allocations: [], totalApplied: 0, unallocated: 0 });
  });

  it("exact fill of the whole window", () => {
    const result = allocatePayment(75_000, weeks(1, 3, 25_000));
    expect(result.allocations.every((a) => a.fillsWeek)).toBe(true);
    expect(result.totalApplied).toBe(75_000);
    expect(result.unallocated).toBe(0);
  });

  it("more money than weeks remaining -> surplus is unallocated", () => {
    const result = allocatePayment(100_000, weeks(1, 3, 25_000));
    expect(result.totalApplied).toBe(75_000);
    expect(result.unallocated).toBe(25_000);
  });

  it("no weeks at all -> everything unallocated", () => {
    const result = allocatePayment(50_000, []);
    expect(result).toEqual({ allocations: [], totalApplied: 0, unallocated: 50_000 });
  });

  it("all weeks skipped -> everything unallocated", () => {
    const list = weeks(1, 3, 25_000, {
      1: { isSkipped: true },
      2: { isSkipped: true },
      3: { isSkipped: true },
    });
    expect(allocatePayment(50_000, list).unallocated).toBe(50_000);
  });

  it("applied + unallocated always equals the amount received", () => {
    for (const amount of [0, 1, 24_999, 25_000, 65_000, 75_001, 500_000]) {
      const result = allocatePayment(amount, weeks(8, 12, 25_000, { 9: { isSkipped: true } }));
      const sum = result.allocations.reduce((s, a) => s + a.applied, 0);
      expect(sum).toBe(result.totalApplied);
      expect(result.totalApplied + result.unallocated).toBe(amount);
    }
  });

  it("rejects negative, fractional, and unordered input", () => {
    expect(() => allocatePayment(-1, [])).toThrow(RangeError);
    expect(() => allocatePayment(100.5, [])).toThrow(RangeError);
    expect(() =>
      allocatePayment(100, [
        { weekNumber: 2, amountDue: 100, amountAlreadyPaid: 0, isSkipped: false },
        { weekNumber: 1, amountDue: 100, amountAlreadyPaid: 0, isSkipped: false },
      ]),
    ).toThrow(RangeError);
    // Duplicate week numbers are as corrupt as descending ones.
    expect(() =>
      allocatePayment(100, [
        { weekNumber: 1, amountDue: 100, amountAlreadyPaid: 0, isSkipped: false },
        { weekNumber: 1, amountDue: 100, amountAlreadyPaid: 0, isSkipped: false },
      ]),
    ).toThrow(RangeError);
    expect(() =>
      allocatePayment(100, [
        { weekNumber: 1, amountDue: -5, amountAlreadyPaid: 0, isSkipped: false },
      ]),
    ).toThrow(RangeError);
  });
});
