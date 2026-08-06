import { describe, expect, it } from "vitest";
import { allocatePayment } from "./allocation";
import {
  buildMemberRows,
  cellForWeek,
  matchesFilter,
  matchesSearch,
  sortWorstFirst,
  visibleMembers,
  type MemberRow,
} from "./members-view";
import { buildPaymentGrid } from "./payments-view";

const D = (n: number) => new Date(Date.UTC(2026, 4, 17) + (n - 1) * 7 * 86_400_000);

const GRID = buildPaymentGrid({
  weeks: [1, 2, 3].map((weekNumber) => ({ weekNumber, date: D(weekNumber), isSkipped: false })),
  members: [
    {
      participationId: "p-tizita",
      name: "ትዝታ — Tizita",
      numbersLabel: "#1",
      startWeek: 1,
      finishWeek: 3,
      weeksCredited: 3,
      outstanding: 0,
      weeks: [1, 2, 3].map((weekNumber) => ({
        weekNumber,
        status: "PAID" as const,
        storedPaid: 50_000,
        amountDue: 50_000,
      })),
    },
    {
      participationId: "p-alem",
      name: "ዓለም — Alem",
      numbersLabel: "#4, #21",
      startWeek: 1,
      finishWeek: 3,
      weeksCredited: 1,
      outstanding: 150_000,
      weeks: [
        { weekNumber: 1, status: "PAID" as const, storedPaid: 100_000, amountDue: 100_000 },
        { weekNumber: 2, status: "PARTIAL" as const, storedPaid: 40_000, amountDue: 100_000 },
        { weekNumber: 3, status: "LATE" as const, storedPaid: 0, amountDue: 100_000 },
      ],
    },
    {
      participationId: "p-late",
      name: "መሓሪ — Mehari",
      numbersLabel: "#9",
      startWeek: 2,
      finishWeek: 3,
      weeksCredited: 1,
      outstanding: 50_000,
      weeks: [
        { weekNumber: 2, status: "PAID" as const, storedPaid: 50_000, amountDue: 50_000 },
        { weekNumber: 3, status: "UNPAID" as const, storedPaid: 0, amountDue: 50_000 },
      ],
    },
  ],
});

const ROWS = buildMemberRows(GRID);
const byId = (id: string) => ROWS.find((r) => r.participationId === id)!;

describe("buildMemberRows — the grid transposed into one row per member", () => {
  it("gives every member every cycle week, in order", () => {
    expect(ROWS).toHaveLength(3);
    expect(ROWS[0].cells.map((c) => c.weekNumber)).toEqual([1, 2, 3]);
  });

  it("marks weeks outside a member's window rather than leaving them blank", () => {
    // Mehari joined in week 2 — week 1 is explicitly "before-start", never an
    // ambiguous empty cell that reads as unpaid.
    expect(byId("p-late").cells[0].cell.kind).toBe("before-start");
    expect(cellForWeek(byId("p-late"), 1)).toBeNull();
    expect(cellForWeek(byId("p-late"), 2)?.status).toBe("PAID");
  });
});

describe("matchesFilter — everyone / behind / unpaid this week / partial", () => {
  it("'behind' keeps only members who owe", () => {
    expect(matchesFilter(byId("p-tizita"), "behind", 3)).toBe(false);
    expect(matchesFilter(byId("p-alem"), "behind", 3)).toBe(true);
  });

  it("'unpaid this week' looks at THAT week only, and excuses deferred", () => {
    expect(matchesFilter(byId("p-alem"), "unpaid-week", 3)).toBe(true);
    expect(matchesFilter(byId("p-alem"), "unpaid-week", 1)).toBe(false);
    // A week outside their window is not "unpaid" — they were not there.
    expect(matchesFilter(byId("p-late"), "unpaid-week", 1)).toBe(false);
  });

  it("'partial' finds members with money on an uncovered week", () => {
    expect(matchesFilter(byId("p-alem"), "partial", 3)).toBe(true);
    expect(matchesFilter(byId("p-tizita"), "partial", 3)).toBe(false);
  });

  it("'all' keeps everyone", () => {
    expect(ROWS.every((r) => matchesFilter(r, "all", 3))).toBe(true);
  });
});

describe("matchesSearch — by name or lucky number", () => {
  it("matches either name form, case-insensitively", () => {
    expect(matchesSearch(byId("p-alem"), "alem")).toBe(true);
    expect(matchesSearch(byId("p-alem"), "ዓለም")).toBe(true);
    expect(matchesSearch(byId("p-alem"), "ALE")).toBe(true);
  });

  it("matches a lucky number with or without the hash", () => {
    expect(matchesSearch(byId("p-alem"), "#21")).toBe(true);
    expect(matchesSearch(byId("p-alem"), "21")).toBe(true);
    expect(matchesSearch(byId("p-tizita"), "21")).toBe(false);
  });

  it("an empty query matches everyone", () => {
    expect(ROWS.every((r) => matchesSearch(r, "   "))).toBe(true);
  });
});

describe("sortWorstFirst — the most behind at the top, stably", () => {
  it("orders by amount owed, then weeks credited, then name", () => {
    expect(sortWorstFirst(ROWS).map((r) => r.participationId)).toEqual([
      "p-alem",
      "p-late",
      "p-tizita",
    ]);
  });

  it("does not mutate the input", () => {
    const before = ROWS.map((r) => r.participationId);
    sortWorstFirst(ROWS);
    expect(ROWS.map((r) => r.participationId)).toEqual(before);
  });
});

describe("visibleMembers — filter, search and sort together", () => {
  it("applies all three", () => {
    expect(
      visibleMembers({ rows: ROWS, filter: "behind", search: "", currentWeek: 3 }).map(
        (r) => r.participationId,
      ),
    ).toEqual(["p-alem", "p-late"]);
    expect(
      visibleMembers({ rows: ROWS, filter: "behind", search: "#9", currentWeek: 3 }).map(
        (r) => r.participationId,
      ),
    ).toEqual(["p-late"]);
  });
});

// ————————————————————————————————————————————————————————————————
// PARTIAL RECORDING AGAINST A SPECIFIC WEEK — the capability the members
// view exists to provide ("Getahun paid $400 toward week 14"). It uses the
// ONE engine (2.19); nothing new records money. These pin the two outcomes
// the panel must be honest about.
// ————————————————————————————————————————————————————————————————

describe("partial payment toward a specific week", () => {
  const weeks = (over: Partial<Record<number, number>> = {}) =>
    [12, 13, 14, 15].map((weekNumber) => ({
      weekNumber,
      amountDue: 50_000,
      amountAlreadyPaid: over[weekNumber] ?? 0,
      isSkipped: false,
    }));

  it("with no older debt, $400 toward week 14 lands as a PARTIAL on week 14", () => {
    // Weeks 12 and 13 already covered — 14 is the oldest uncovered week.
    const result = allocatePayment(
      40_000,
      weeks({ 12: 50_000, 13: 50_000 }),
    );
    expect(result.allocations).toEqual([
      { weekNumber: 14, applied: 40_000, fillsWeek: false, runningRemainder: 0 },
    ]);
    expect(result.unallocated).toBe(0);
  });

  it("a second partial on the same week tops it up and completes it", () => {
    const result = allocatePayment(10_000, weeks({ 12: 50_000, 13: 50_000, 14: 40_000 }));
    expect(result.allocations).toEqual([
      { weekNumber: 14, applied: 10_000, fillsWeek: true, runningRemainder: 0 },
    ]);
  });

  it("with older debt, the SAME $400 lands on the older week — the panel must say so", () => {
    // Week 12 is uncovered, so oldest-debt-first (2.15) sends the money there
    // even though the organizer clicked week 14. Nothing reaches week 14.
    const result = allocatePayment(40_000, weeks());
    expect(result.allocations).toEqual([
      { weekNumber: 12, applied: 40_000, fillsWeek: false, runningRemainder: 0 },
    ]);
    expect(result.allocations.some((a) => a.weekNumber === 14)).toBe(false);
    const landsEarlier = result.allocations.filter((a) => a.weekNumber < 14).map((a) => a.weekNumber);
    expect(landsEarlier).toEqual([12]);
  });

  it("a partial never overfills its week — the surplus flows forward", () => {
    const result = allocatePayment(60_000, weeks({ 12: 50_000, 13: 50_000 }));
    expect(result.allocations).toEqual([
      { weekNumber: 14, applied: 50_000, fillsWeek: true, runningRemainder: 10_000 },
      { weekNumber: 15, applied: 10_000, fillsWeek: false, runningRemainder: 0 },
    ]);
  });

  it("a SKIPPED target week takes nothing — the money moves past it", () => {
    const w = weeks({ 12: 50_000, 13: 50_000 });
    w[2] = { ...w[2], isSkipped: true }; // week 14 never happened
    const result = allocatePayment(40_000, w);
    expect(result.allocations).toEqual([
      { weekNumber: 15, applied: 40_000, fillsWeek: false, runningRemainder: 0 },
    ]);
  });

  // A DEFERRED week is NOT skipped — the money lands on it normally, which is
  // exactly why the panel can still say "$400 recorded on week 14".
  it("a DEFERRED target week takes the money like any other week", () => {
    const result = allocatePayment(40_000, weeks({ 12: 50_000, 13: 50_000 }));
    expect(result.allocations).toEqual([
      { weekNumber: 14, applied: 40_000, fillsWeek: false, runningRemainder: 0 },
    ]);
  });
});
