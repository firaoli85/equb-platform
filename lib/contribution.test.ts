import { describe, expect, it } from "vitest";
import { contribution, savingSummary, totalContributed } from "./contribution";
import { computeStanding, type StandingWeekInput } from "./standing";

// This is a SAVINGS group (2.1). The headline is what a member HAS SAVED, and
// "still to save" must never be dressed up as debt: someone perfectly current
// has most of their commitment ahead of them and owes nothing.

const CYCLE_START = Date.UTC(2026, 4, 17); // Sunday, May 17 2026
const weekDate = (n: number) => new Date(CYCLE_START + (n - 1) * 7 * 86_400_000);
const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);

function weeks(
  from: number,
  to: number,
  amountDue: number,
  overrides: Partial<Record<number, Partial<StandingWeekInput>>> = {},
): StandingWeekInput[] {
  const list: StandingWeekInput[] = [];
  for (let n = from; n <= to; n++) {
    list.push({
      weekNumber: n,
      date: weekDate(n),
      amountDue,
      storedPaid: 0,
      isDeferred: false,
      isSkipped: false,
      ...overrides[n],
    });
  }
  return list;
}

describe("totalContributed — the sum of the receipts, nothing else", () => {
  it("adds every receipt", () => {
    expect(totalContributed([{ amount: 50_000 }, { amount: 50_000 }, { amount: 25_000 }])).toBe(
      125_000,
    );
  });

  it("is zero for a member who has paid nothing", () => {
    expect(totalContributed([])).toBe(0);
  });

  it("counts partials exactly — no rounding to whole weeks", () => {
    expect(totalContributed([{ amount: 50_000 }, { amount: 12_345 }])).toBe(62_345);
  });

  it("refuses fractional or negative cents rather than quietly mis-stating money", () => {
    expect(() => totalContributed([{ amount: 100.5 }])).toThrow(RangeError);
    expect(() => totalContributed([{ amount: -1 }])).toThrow(RangeError);
  });
});

describe("the three figures are never conflated", () => {
  // $500/week for 20 weeks = a $10,000 commitment.
  const base = { weeklyAmount: 50_000, weeksCommitted: 20 };

  it("a member fully CURRENT has plenty to save and owes NOTHING", () => {
    const c = contribution({
      ...base,
      receipts: Array.from({ length: 10 }, () => ({ amount: 50_000 })),
      overdue: 0,
    });
    expect(c.paidIn).toBe(500_000); // $5,000 saved
    expect(c.commitmentTotal).toBe(1_000_000); // $10,000 committed
    expect(c.stillToSave).toBe(500_000); // $5,000 still to save
    expect(c.overdue).toBe(0); // and nothing overdue
    expect(savingSummary(c)).toContain("Nothing is overdue");
    expect(savingSummary(c)).not.toContain("owe");
  });

  it("still-to-save is NOT the overdue figure — they are independent", () => {
    const behind = contribution({
      ...base,
      receipts: Array.from({ length: 8 }, () => ({ amount: 50_000 })),
      overdue: 100_000, // two closed weeks unpaid
    });
    expect(behind.stillToSave).toBe(600_000);
    expect(behind.overdue).toBe(100_000);
    expect(behind.stillToSave).not.toBe(behind.overdue);
  });

  it("weeks covered and progress track the money, not the calendar", () => {
    const c = contribution({
      ...base,
      receipts: [{ amount: 500_000 }],
      overdue: 0,
    });
    expect(c.weeksCovered).toBe(10);
    expect(c.weeksCommitted).toBe(20);
    expect(c.progress).toBeCloseTo(0.5);
  });

  it("a PARTIAL week counts every cent toward the total", () => {
    const c = contribution({
      ...base,
      receipts: [{ amount: 50_000 }, { amount: 20_000 }],
      overdue: 30_000,
    });
    expect(c.paidIn).toBe(70_000);
    // The partial does not round up to a covered week...
    expect(c.weeksCovered).toBe(1);
    // ...but it is fully counted in what remains.
    expect(c.stillToSave).toBe(930_000);
  });

  it("finishing the commitment leaves nothing to save, whatever is overdue", () => {
    const done = contribution({
      ...base,
      receipts: [{ amount: 1_000_000 }],
      overdue: 0,
    });
    expect(done.stillToSave).toBe(0);
    expect(done.progress).toBe(1);
    expect(savingSummary(done)).toBe("Your whole commitment is saved.");
  });

  it("paying beyond the commitment is SURPLUS, never a negative target", () => {
    const over = contribution({
      ...base,
      receipts: [{ amount: 1_200_000 }],
      overdue: 0,
    });
    expect(over.stillToSave).toBe(0);
    expect(over.surplus).toBe(200_000);
    expect(over.progress).toBe(1);
  });

  it("a member who has paid nothing owes only what has CLOSED, not the lot", () => {
    const nothing = contribution({ ...base, receipts: [], overdue: 150_000 });
    expect(nothing.paidIn).toBe(0);
    expect(nothing.stillToSave).toBe(1_000_000); // the whole commitment ahead
    expect(nothing.overdue).toBe(150_000); // but only 3 closed weeks are owed
    expect(nothing.overdue).toBeLessThan(nothing.stillToSave);
  });
});

describe("total contributed always equals the sum of the receipts (2.14)", () => {
  // The guarantee: however the money is allocated across weeks, the headline
  // figure is the receipts and can never drift from them.
  const RECEIPTS = [{ amount: 50_000 }, { amount: 50_000 }, { amount: 20_000 }];

  it("matches the standing engine's own totalPaid for the same money", () => {
    const paidIn = totalContributed(RECEIPTS);
    const s = computeStanding({
      weeklyAmount: 50_000,
      startWeek: 1,
      weeksCommitted: 20,
      cycleWeek: 5,
      today: utc("2026-06-30"),
      windowWeeks: weeks(1, 20, 50_000, {
        1: { storedPaid: 50_000 },
        2: { storedPaid: 50_000 },
        3: { storedPaid: 20_000 },
      }),
      totalPaid: paidIn,
    });
    expect(s.totalPaid).toBe(paidIn);
    expect(contribution({
      receipts: RECEIPTS,
      weeklyAmount: 50_000,
      weeksCommitted: 20,
      overdue: s.amountOutstanding,
    }).paidIn).toBe(paidIn);
  });

  it("a DEFERRED week does not reduce what they have saved", () => {
    // Deferral is about chasing, not about money received (Aug 2026 ruling).
    const paidIn = totalContributed(RECEIPTS);
    const s = computeStanding({
      weeklyAmount: 50_000,
      startWeek: 1,
      weeksCommitted: 20,
      cycleWeek: 5,
      today: utc("2026-06-30"),
      windowWeeks: weeks(1, 20, 50_000, {
        1: { storedPaid: 50_000 },
        2: { storedPaid: 50_000 },
        3: { storedPaid: 20_000 },
        4: { isDeferred: true },
      }),
      totalPaid: paidIn,
    });
    const c = contribution({
      receipts: RECEIPTS,
      weeklyAmount: 50_000,
      weeksCommitted: 20,
      overdue: s.amountOutstanding,
    });
    expect(c.paidIn).toBe(120_000);
    expect(c.stillToSave).toBe(880_000);
  });

  it("a SKIPPED week reduces what is OWED but not the commitment they save toward", () => {
    const paidIn = totalContributed(RECEIPTS);
    const withSkip = computeStanding({
      weeklyAmount: 50_000,
      startWeek: 1,
      weeksCommitted: 20,
      cycleWeek: 5,
      today: utc("2026-06-30"),
      windowWeeks: weeks(1, 20, 50_000, {
        1: { storedPaid: 50_000 },
        2: { storedPaid: 50_000 },
        3: { storedPaid: 20_000 },
        4: { isSkipped: true },
      }),
      totalPaid: paidIn,
    });
    const withoutSkip = computeStanding({
      weeklyAmount: 50_000,
      startWeek: 1,
      weeksCommitted: 20,
      cycleWeek: 5,
      today: utc("2026-06-30"),
      windowWeeks: weeks(1, 20, 50_000, {
        1: { storedPaid: 50_000 },
        2: { storedPaid: 50_000 },
        3: { storedPaid: 20_000 },
      }),
      totalPaid: paidIn,
    });
    expect(withSkip.amountOutstanding).toBeLessThan(withoutSkip.amountOutstanding);
    // The saved figure is untouched either way — it is the receipts.
    for (const s of [withSkip, withoutSkip]) {
      expect(
        contribution({
          receipts: RECEIPTS,
          weeklyAmount: 50_000,
          weeksCommitted: 20,
          overdue: s.amountOutstanding,
        }).paidIn,
      ).toBe(120_000);
    }
  });
});
