import { describe, expect, it } from "vitest";
import { allocatePayment } from "./allocation";
import { computeStanding, planCommit, type StandingWeekInput } from "./standing";

const START = Date.UTC(2026, 4, 17); // Sunday, May 17 2026
const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);
const weekDate = (n: number) => new Date(START + (n - 1) * 7 * 86_400_000);

function mkWeeks(
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
      ...overrides[n],
    });
  }
  return list;
}

describe("computeStanding — ordinary mid-cycle position", () => {
  it("member at $250/wk, 3 of 5 elapsed weeks paid", () => {
    const s = computeStanding({
      weeklyAmount: 25_000,
      startWeek: 1,
      weeksCommitted: 10,
      cycleWeek: 5,
      today: utc("2026-06-16"), // inside week 5's window
      windowWeeks: mkWeeks(1, 10, 25_000, {
        1: { storedPaid: 25_000 },
        2: { storedPaid: 25_000 },
        3: { storedPaid: 25_000 },
      }),
      totalPaid: 75_000,
    });
    expect(s.finishWeek).toBe(10);
    expect(s.weeksElapsedInWindow).toBe(5);
    expect(s.missingWeekRows).toBe(0);
    expect(s.weeksCredited).toBe(3);
    expect(s.weeksBehind).toBe(2);
    expect(s.amountOutstanding).toBe(50_000);
    expect(s.surplus).toBe(0);
    expect(s.lastPaymentWeek).toBe(3);
    expect(s.weeks.slice(0, 5).map((w) => w.status)).toEqual([
      "PAID",
      "PAID",
      "PAID",
      "LATE", // week 4's window closed
      "UNPAID", // week 5 still open on Jun 16
    ]);
  });
});

describe("computeStanding — the 2.14 rate-change examples", () => {
  it("rate INCREASE: $1,500 paid at $250/wk becomes 3 credited at $500/wk", () => {
    // Receipts: weeks 1-6 each hold $250 recorded at the old rate.
    const s = computeStanding({
      weeklyAmount: 50_000, // the new rate
      startWeek: 1,
      weeksCommitted: 10,
      cycleWeek: 6,
      today: utc("2026-06-23"), // inside week 6's window
      windowWeeks: mkWeeks(1, 10, 50_000, {
        1: { storedPaid: 25_000 },
        2: { storedPaid: 25_000 },
        3: { storedPaid: 25_000 },
        4: { storedPaid: 25_000 },
        5: { storedPaid: 25_000 },
        6: { storedPaid: 25_000 },
      }),
      totalPaid: 150_000,
    });
    expect(s.weeksCredited).toBe(3); // the law's own number
    expect(s.weeksBehind).toBe(3); // "they are now 3 weeks behind"
    expect(s.amountOutstanding).toBe(150_000); // 6 x $500 due - $1,500 paid
    // The fungible money covers the OLDEST weeks at the new rate...
    expect(s.weeks.slice(0, 6).map((w) => w.status)).toEqual([
      "PAID",
      "PAID",
      "PAID",
      "LATE",
      "LATE",
      "UNPAID", // week 6's window still open
    ]);
    // ...while the stored receipts remain untouched facts.
    expect(s.weeks[0].amountPaid).toBe(25_000);
    expect(s.weeks[0].coveredAtCurrentRate).toBe(50_000);
  });

  it("rate DECREASE: surplus on old weeks nets forward — no phantom debt, no LATE", () => {
    // Receipts: weeks 1-6 each hold $500 recorded at the old rate; the rate
    // is now $250 and 8 weeks have elapsed.
    const s = computeStanding({
      weeklyAmount: 25_000,
      startWeek: 1,
      weeksCommitted: 10,
      cycleWeek: 8,
      today: utc("2026-07-07"),
      windowWeeks: mkWeeks(1, 10, 25_000, {
        1: { storedPaid: 50_000 },
        2: { storedPaid: 50_000 },
        3: { storedPaid: 50_000 },
        4: { storedPaid: 50_000 },
        5: { storedPaid: 50_000 },
        6: { storedPaid: 50_000 },
      }),
      totalPaid: 300_000,
    });
    expect(s.weeksCredited).toBe(12);
    expect(s.weeksBehind).toBe(0);
    expect(s.amountOutstanding).toBe(0); // NOT $500 of stranded per-week debt
    expect(s.weeks.every((w) => w.status === "PAID")).toBe(true); // no LATE contradiction
    expect(s.surplus).toBe(50_000); // $3,000 paid - $2,500 window = $500 beyond the window
  });
});

describe("computeStanding — deferred weeks and missing rows", () => {
  it("2 skipped weeks among 4 elapsed, the other 2 paid -> not behind at all", () => {
    const s = computeStanding({
      weeklyAmount: 25_000,
      startWeek: 1,
      weeksCommitted: 4,
      cycleWeek: 4,
      today: utc("2026-06-10"),
      windowWeeks: mkWeeks(1, 4, 25_000, {
        1: { isDeferred: true },
        2: { isDeferred: true },
        3: { storedPaid: 25_000 },
        4: { storedPaid: 25_000 },
      }),
      totalPaid: 50_000,
    });
    expect(s.weeksBehind).toBe(0);
    expect(s.amountOutstanding).toBe(0);
    expect(s.weeks.map((w) => w.status)).toEqual(["DEFERRED", "DEFERRED", "PAID", "PAID"]);
  });

  it("pre-D-31 data with missing week rows stays honest and reports the gap", () => {
    const s = computeStanding({
      weeklyAmount: 25_000,
      startWeek: 15,
      weeksCommitted: 10, // finishWeek 24, but the cycle only has rows to 20
      cycleWeek: 24,
      today: utc("2026-11-01"),
      windowWeeks: mkWeeks(15, 20, 25_000),
      totalPaid: 0,
    });
    expect(s.finishWeek).toBe(24);
    expect(s.missingWeekRows).toBe(4);
    expect(s.weeksElapsedInWindow).toBe(6); // existing rows only
    expect(s.weeksBehind).toBe(6);
    expect(s.amountOutstanding).toBe(150_000); // over rows that exist
  });
});

describe("planCommit — money conservation at the commit boundary (2.14, 2.19)", () => {
  const window = [
    { weekNumber: 1, amountDue: 25_000, amountAlreadyPaid: 0, isDeferred: false },
    { weekNumber: 2, amountDue: 25_000, amountAlreadyPaid: 0, isDeferred: false },
  ];

  it("refuses an amount the window cannot absorb — nothing to write", () => {
    const plan = planCommit(75_000, window);
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.error).toContain("$500"); // what fits
      expect(plan.error).toContain("$250"); // what does not
    }
  });

  it("accepts an exact fit and matches the preview engine result identically", () => {
    const plan = planCommit(50_000, window);
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.result).toEqual(allocatePayment(50_000, window)); // one engine (2.19)
    }
  });

  it("accepts a partial second week", () => {
    const plan = planCommit(30_000, window);
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.result.allocations).toEqual([
        { weekNumber: 1, applied: 25_000, fillsWeek: true, runningRemainder: 5_000 },
        { weekNumber: 2, applied: 5_000, fillsWeek: false, runningRemainder: 0 },
      ]);
    }
  });
});

describe("computeStanding — payout settlements are PINNED, never fungible", () => {
  // The organizer's rule: the winner does not pay the week they win. Their
  // $500 settlement belongs to the drawn week even when older weeks are owed.
  it("keeps the settled money on the drawn week while older debt stays owed", () => {
    const s = computeStanding({
      weeklyAmount: 50_000,
      startWeek: 12,
      weeksCommitted: 9,
      cycleWeek: 12,
      today: utc("2026-08-05"),
      windowWeeks: mkWeeks(12, 20, 50_000, { 13: { storedPaid: 50_000 } }),
      totalPaid: 50_000,
      pinnedByWeek: new Map([[13, 50_000]]),
    });
    const wk12 = s.weeks.find((w) => w.weekNumber === 12)!;
    const wk13 = s.weeks.find((w) => w.weekNumber === 13)!;
    expect(wk13.coveredAtCurrentRate).toBe(50_000);
    expect(wk13.status).toBe("PAID");
    // Week 12 stays uncovered — the settlement never slides oldest-first.
    expect(wk12.coveredAtCurrentRate).toBe(0);
    expect(wk12.status).not.toBe("PAID");
  });

  it("without the pin the same money would slide onto the oldest week", () => {
    const s = computeStanding({
      weeklyAmount: 50_000,
      startWeek: 12,
      weeksCommitted: 9,
      cycleWeek: 12,
      today: utc("2026-08-05"),
      windowWeeks: mkWeeks(12, 20, 50_000, { 13: { storedPaid: 50_000 } }),
      totalPaid: 50_000,
    });
    expect(s.weeks.find((w) => w.weekNumber === 12)!.coveredAtCurrentRate).toBe(50_000);
    expect(s.weeks.find((w) => w.weekNumber === 13)!.coveredAtCurrentRate).toBe(0);
  });

  it("fungible money fills around the pinned week; totals stay consistent", () => {
    const s = computeStanding({
      weeklyAmount: 50_000,
      startWeek: 12,
      weeksCommitted: 9,
      cycleWeek: 14,
      today: utc("2026-08-20"),
      windowWeeks: mkWeeks(12, 20, 50_000, {
        12: { storedPaid: 50_000 },
        13: { storedPaid: 50_000 },
      }),
      totalPaid: 100_000, // one ordinary $500 receipt + the $500 settlement
      pinnedByWeek: new Map([[13, 50_000]]),
    });
    expect(s.weeks.find((w) => w.weekNumber === 12)!.status).toBe("PAID");
    expect(s.weeks.find((w) => w.weekNumber === 13)!.status).toBe("PAID");
    expect(s.weeks.find((w) => w.weekNumber === 14)!.coveredAtCurrentRate).toBe(0);
  });

  it("a pinned amount larger than the week's due frees the excess as fungible", () => {
    // Weekly later cut to $250: the $500 settlement covers the drawn week's
    // $250 and the other $250 flows oldest-first like any money.
    const s = computeStanding({
      weeklyAmount: 25_000,
      startWeek: 12,
      weeksCommitted: 9,
      cycleWeek: 12,
      today: utc("2026-08-05"),
      windowWeeks: mkWeeks(12, 20, 25_000),
      totalPaid: 50_000,
      pinnedByWeek: new Map([[13, 50_000]]),
    });
    expect(s.weeks.find((w) => w.weekNumber === 13)!.coveredAtCurrentRate).toBe(25_000);
    expect(s.weeks.find((w) => w.weekNumber === 12)!.coveredAtCurrentRate).toBe(25_000);
  });

  it("a deferred drawn week takes nothing — the settlement money becomes fungible", () => {
    const s = computeStanding({
      weeklyAmount: 50_000,
      startWeek: 12,
      weeksCommitted: 9,
      cycleWeek: 13,
      today: utc("2026-08-12"),
      windowWeeks: mkWeeks(12, 20, 50_000, { 13: { isDeferred: true } }),
      totalPaid: 50_000,
      pinnedByWeek: new Map([[13, 50_000]]),
    });
    expect(s.weeks.find((w) => w.weekNumber === 13)!.status).toBe("DEFERRED");
    expect(s.weeks.find((w) => w.weekNumber === 12)!.coveredAtCurrentRate).toBe(50_000);
  });
});
