import { describe, expect, it } from "vitest";
import {
  allocationOutsideSelection,
  buildPaymentGrid,
  bulkCatchUpAmount,
  describeAllocation,
  resolveTargetWeek,
  splitWeekRoster,
  type GridMemberInput,
  type RosterMember,
} from "./payments-view";

describe("describeAllocation — the preview sentence (2.15)", () => {
  it("names the weeks a payment clears", () => {
    expect(
      describeAllocation({
        allocations: [
          { weekNumber: 8, applied: 25_000, fillsWeek: true },
          { weekNumber: 9, applied: 25_000, fillsWeek: true },
          { weekNumber: 10, applied: 25_000, fillsWeek: true },
        ],
        unallocated: 0,
      }),
    ).toBe("Clears weeks 8, 9, 10");
  });

  it("calls out a partial week (the $650 example)", () => {
    expect(
      describeAllocation({
        allocations: [
          { weekNumber: 8, applied: 25_000, fillsWeek: true },
          { weekNumber: 9, applied: 25_000, fillsWeek: true },
          { weekNumber: 10, applied: 15_000, fillsWeek: false },
        ],
        unallocated: 0,
      }),
    ).toBe("Clears weeks 8, 9 · $150 partial on week 10");
  });

  it("uses the singular for one week", () => {
    expect(
      describeAllocation({
        allocations: [{ weekNumber: 12, applied: 25_000, fillsWeek: true }],
        unallocated: 0,
      }),
    ).toBe("Clears week 12");
  });

  it("reports money the window cannot absorb", () => {
    expect(
      describeAllocation({
        allocations: [{ weekNumber: 20, applied: 25_000, fillsWeek: true }],
        unallocated: 20_000,
      }),
    ).toBe("Clears week 20 · $200 unallocated");
  });

  it("says so plainly when nothing would be applied", () => {
    expect(describeAllocation({ allocations: [], unallocated: 0 })).toMatch(/already covered/);
  });
});

describe("bulkCatchUpAmount — sizing a catch-up receipt", () => {
  const week = (weekNumber: number, paid = 0, isSkipped = false) => ({
    weekNumber,
    amountDue: 25_000,
    amountAlreadyPaid: paid,
    isDeferred: false,
    isSkipped,
  });

  it("sums the shortfall across the selected weeks", () => {
    expect(bulkCatchUpAmount([week(8), week(9), week(10)])).toBe(75_000);
  });

  it("counts only what is still owed on partially paid weeks", () => {
    expect(bulkCatchUpAmount([week(8, 10_000), week(9)])).toBe(40_000);
  });

  it("excuses SKIPPED weeks entirely — nobody owed them", () => {
    expect(bulkCatchUpAmount([week(8, 0, true), week(9)])).toBe(25_000);
  });

  it("INCLUDES deferred weeks — the money is still owed (Aug 2026 ruling)", () => {
    expect(
      bulkCatchUpAmount([
        { weekNumber: 8, amountDue: 25_000, amountAlreadyPaid: 0, isDeferred: true, isSkipped: false },
        week(9),
      ]),
    ).toBe(50_000);
  });

  it("is zero when every selected week is already settled", () => {
    expect(bulkCatchUpAmount([week(8, 25_000), week(9, 30_000)])).toBe(0);
    expect(bulkCatchUpAmount([])).toBe(0);
  });

  it("rejects fractional cents", () => {
    expect(() =>
      bulkCatchUpAmount([
        { weekNumber: 1, amountDue: 100.5, amountAlreadyPaid: 0, isDeferred: false, isSkipped: false },
      ]),
    ).toThrow(RangeError);
  });
});

describe("allocationOutsideSelection — honest about oldest-debt-first", () => {
  it("flags weeks the money lands on that were not selected", () => {
    expect(
      allocationOutsideSelection({
        allocations: [
          { weekNumber: 5, applied: 25_000, fillsWeek: true },
          { weekNumber: 6, applied: 25_000, fillsWeek: true },
          { weekNumber: 10, applied: 25_000, fillsWeek: true },
        ],
        selectedWeeks: [10, 11],
      }),
    ).toEqual([5, 6]);
  });

  it("is empty when the money lands exactly where selected", () => {
    expect(
      allocationOutsideSelection({
        allocations: [{ weekNumber: 10, applied: 25_000, fillsWeek: true }],
        selectedWeeks: [10, 11],
      }),
    ).toEqual([]);
  });
});

describe("resolveTargetWeek — the board's default week", () => {
  const weeks = Array.from({ length: 20 }, (_, i) => i + 1);

  it("honors an explicit request when the week exists", () => {
    expect(resolveTargetWeek({ requested: 5, cycleWeek: 12, weekNumbers: weeks })).toBe(5);
  });

  it("ignores a request for a week that does not exist", () => {
    expect(resolveTargetWeek({ requested: 99, cycleWeek: 12, weekNumbers: weeks })).toBe(12);
  });

  it("defaults to the derived current week", () => {
    expect(resolveTargetWeek({ cycleWeek: 12, weekNumbers: weeks })).toBe(12);
  });

  it("falls to the LAST week once the calendar runs past the cycle (2.7), never week 1", () => {
    expect(resolveTargetWeek({ cycleWeek: 23, weekNumbers: weeks })).toBe(20);
  });

  it("falls to the first week before the cycle starts (week 0)", () => {
    expect(resolveTargetWeek({ cycleWeek: 0, weekNumbers: weeks })).toBe(1);
  });

  it("throws on an empty week list", () => {
    expect(() => resolveTargetWeek({ cycleWeek: 1, weekNumbers: [] })).toThrow(RangeError);
  });
});

describe("splitWeekRoster — the action list and the paid list", () => {
  const base = (over: Partial<RosterMember> & { participationId: string; name: string }): RosterMember => ({
    amountDue: 25_000,
    amountPaidThisWeek: 0,
    isDeferred: false,
    weeksBehind: 0,
    amountOwed: 0,
    ...over,
  });

  it("separates owing from paid, and treats deferred as settled", () => {
    const { owing, paid } = splitWeekRoster([
      base({ participationId: "a", name: "Unpaid" }),
      base({ participationId: "b", name: "Paid", amountPaidThisWeek: 25_000 }),
      base({ participationId: "c", name: "Excused", isDeferred: true }),
      base({ participationId: "d", name: "Partial", amountPaidThisWeek: 10_000 }),
    ]);
    // Equal debt, so the tiebreak is alphabetical.
    expect(owing.map((m) => m.name)).toEqual(["Partial", "Unpaid"]);
    expect(paid.map((m) => m.name)).toEqual(["Excused", "Paid"]);
  });

  it("puts the deepest debt at the top of the action list", () => {
    const { owing } = splitWeekRoster([
      base({ participationId: "a", name: "Small", amountOwed: 25_000, weeksBehind: 1 }),
      base({ participationId: "b", name: "Big", amountOwed: 150_000, weeksBehind: 6 }),
      base({ participationId: "c", name: "Middle", amountOwed: 50_000, weeksBehind: 2 }),
    ]);
    expect(owing.map((m) => m.name)).toEqual(["Big", "Middle", "Small"]);
  });

  it("an overpaid week counts as paid", () => {
    const { paid } = splitWeekRoster([
      base({ participationId: "a", name: "Ahead", amountPaidThisWeek: 40_000 }),
    ]);
    expect(paid).toHaveLength(1);
  });
});

describe("buildPaymentGrid — the map (2.15)", () => {
  const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);
  const weeks = [
    { weekNumber: 1, date: utc("2026-05-17"), isSkipped: false },
    { weekNumber: 2, date: utc("2026-05-24"), isSkipped: false },
    { weekNumber: 3, date: utc("2026-05-31"), isSkipped: true },
    { weekNumber: 4, date: utc("2026-06-07"), isSkipped: false },
  ];
  const early: GridMemberInput = {
    participationId: "a",
    name: "Early",
    numbersLabel: "#1",
    startWeek: 1,
    finishWeek: 4,
    weeksCredited: 1,
    totalContributed: 25_000,
    outstanding: 25_000,
    weeks: [
      { weekNumber: 1, status: "PAID", storedPaid: 25_000, amountDue: 25_000 },
      { weekNumber: 2, status: "LATE", storedPaid: 0, amountDue: 25_000 },
      { weekNumber: 3, status: "DEFERRED", storedPaid: 0, amountDue: 25_000 },
      { weekNumber: 4, status: "UNPAID", storedPaid: 0, amountDue: 25_000 },
    ],
  };
  const late: GridMemberInput = {
    participationId: "b",
    name: "Late",
    numbersLabel: "#9",
    startWeek: 3,
    finishWeek: 4,
    weeksCredited: 0,
    totalContributed: 0,
    outstanding: 50_000,
    weeks: [
      { weekNumber: 3, status: "DEFERRED", storedPaid: 0, amountDue: 50_000 },
      { weekNumber: 4, status: "PARTIAL", storedPaid: 20_000, amountDue: 50_000 },
    ],
  };

  const grid = buildPaymentGrid({ weeks, members: [early, late] });

  it("a mid-cycle joiner's earlier weeks say 'not yet joined' — never blank, never unpaid", () => {
    expect(grid.rows[0].cells).toEqual([
      { kind: "week", status: "PAID", storedPaid: 25_000, amountDue: 25_000 },
      { kind: "before-start" },
    ]);
    expect(grid.rows[1].cells[1]).toEqual({ kind: "before-start" });
    expect(grid.rows[2].cells[1]).toEqual({ kind: "week", status: "DEFERRED", storedPaid: 0, amountDue: 50_000 });
  });

  it("weeks after a member's finish are 'after-finish', not unpaid", () => {
    const shortMember: GridMemberInput = {
      ...early,
      participationId: "s",
      name: "Short",
      finishWeek: 2,
      weeks: early.weeks.slice(0, 2),
    };
    const g = buildPaymentGrid({ weeks, members: [shortMember] });
    expect(g.rows[2].cells[0]).toEqual({ kind: "after-finish" });
    expect(g.rows[3].cells[0]).toEqual({ kind: "after-finish" });
  });

  it("column headers carry the join week so it can be STATED", () => {
    expect(grid.columns[1]).toMatchObject({ startWeek: 3, finishWeek: 4 });
  });

  it("passes derived statuses through untouched", () => {
    expect(
      grid.rows.map((r) => (r.cells[0]?.kind === "week" ? r.cells[0].status : null)),
    ).toEqual(["PAID", "LATE", "DEFERRED", "UNPAID"]);
    expect(grid.rows[3].cells[1]).toMatchObject({ kind: "week", status: "PARTIAL" });
  });

  it("row totals: received from stored placement, expected window-aware", () => {
    expect(grid.rows[0]).toMatchObject({ received: 25_000, expected: 25_000 });
    expect(grid.rows[1]).toMatchObject({ received: 0, expected: 25_000 });
    // Week 4: both in window, both non-deferred — $250 + $500 expected.
    expect(grid.rows[3]).toMatchObject({ received: 20_000, expected: 75_000 });
  });

  it("a skipped week expects nothing but still shows money that landed there", () => {
    expect(grid.rows[2]).toMatchObject({ received: 0, expected: 0, isSkipped: true });
  });

  it("column totals carry credited weeks, outstanding AND what they saved", () => {
    expect(grid.columns).toEqual([
      { participationId: "a", name: "Early", numbersLabel: "#1", startWeek: 1, finishWeek: 4, weeksCredited: 1, outstanding: 25_000, totalContributed: 25_000 },
      { participationId: "b", name: "Late", numbersLabel: "#9", startWeek: 3, finishWeek: 4, weeksCredited: 0, outstanding: 50_000, totalContributed: 0 },
    ]);
  });

  it("orders rows by week number even when input is unsorted", () => {
    const shuffled = buildPaymentGrid({ weeks: [weeks[3], weeks[0], weeks[2], weeks[1]], members: [early] });
    expect(shuffled.rows.map((r) => r.weekNumber)).toEqual([1, 2, 3, 4]);
  });
});
