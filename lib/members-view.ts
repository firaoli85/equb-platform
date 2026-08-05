// The MEMBERS view of /admin/payments — one row per member, worst first.
// Pure: the grid (2.15's map) is transposed into rows, then filtered, searched
// and sorted here so all of it is unit-testable. No money math lives here;
// statuses arrive pre-derived from computeStanding via buildPaymentGrid.

import type { GridCell, PaymentGrid } from "./payments-view";

export type MemberRow = {
  participationId: string;
  name: string;
  numbersLabel: string;
  startWeek: number;
  finishWeek: number;
  weeksCredited: number;
  outstanding: number;
  /** One entry per cycle week, in week order. */
  cells: { weekNumber: number; date: Date; isSkipped: boolean; cell: GridCell }[];
};

/** Turn the week-major grid into member-major rows. */
export function buildMemberRows(grid: PaymentGrid): MemberRow[] {
  return grid.columns.map((c, i) => ({
    participationId: c.participationId,
    name: c.name,
    numbersLabel: c.numbersLabel,
    startWeek: c.startWeek,
    finishWeek: c.finishWeek,
    weeksCredited: c.weeksCredited,
    outstanding: c.outstanding,
    cells: grid.rows.map((row) => ({
      weekNumber: row.weekNumber,
      date: row.date,
      isSkipped: row.isSkipped,
      cell: row.cells[i],
    })),
  }));
}

export type MemberFilter = "all" | "behind" | "unpaid-week" | "partial";

/** A cell inside the member's own window — the only kind with a status. */
export type WeekCell = Extract<GridCell, { kind: "week" }>;

/** The cell for one week, or null when that week is outside their window. */
export function cellForWeek(row: MemberRow, weekNumber: number): WeekCell | null {
  const entry = row.cells.find((c) => c.weekNumber === weekNumber);
  if (!entry || entry.cell.kind !== "week") return null;
  return entry.cell;
}

export function matchesFilter(
  row: MemberRow,
  filter: MemberFilter,
  currentWeek: number,
): boolean {
  if (filter === "all") return true;
  if (filter === "behind") return row.outstanding > 0;

  if (filter === "unpaid-week") {
    const cell = cellForWeek(row, currentWeek);
    return cell !== null && cell.status !== "PAID" && cell.status !== "DEFERRED";
  }
  // "partial": any week where SOME money landed but the week is not covered.
  return row.cells.some(
    (c) => c.cell.kind === "week" && c.cell.status === "PARTIAL",
  );
}

/** Name or lucky number, case-insensitive; empty query matches everyone. */
export function matchesSearch(row: MemberRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  const digits = q.replace(/^#/, "");
  return (
    row.name.toLowerCase().includes(q) ||
    row.numbersLabel.toLowerCase().includes(q) ||
    (digits !== "" && row.numbersLabel.replace(/#/g, "").split(/,\s*/).includes(digits))
  );
}

/**
 * Worst first: most owed, then furthest behind on weeks, then by name so the
 * order is stable and never reshuffles under the organizer's finger.
 */
export function sortWorstFirst(rows: readonly MemberRow[]): MemberRow[] {
  return [...rows].sort(
    (a, b) =>
      b.outstanding - a.outstanding ||
      a.weeksCredited - b.weeksCredited ||
      a.name.localeCompare(b.name),
  );
}

export function visibleMembers(input: {
  rows: readonly MemberRow[];
  filter: MemberFilter;
  search: string;
  currentWeek: number;
}): MemberRow[] {
  return sortWorstFirst(
    input.rows.filter(
      (r) => matchesFilter(r, input.filter, input.currentWeek) && matchesSearch(r, input.search),
    ),
  );
}
