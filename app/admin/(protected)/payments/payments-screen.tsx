"use client";

import { useState } from "react";
import type { MemberStrip } from "@/components/charts/consistency-strip";
import { SegmentedToggle, usePersistedChoice } from "@/components/ui/view-toggle";
import { consistencyFromStatus } from "@/lib/chart";
import type { MemberFilter } from "@/lib/members-view";
import type { PaymentGrid } from "@/lib/payments-view";
import { focusNotice } from "@/lib/week-focus";
import { PaymentsGrid } from "./payments-grid";
import { PaymentsMembers } from "./payments-members";
import { PatternsView } from "./patterns-view";

// ONE payments screen with three representations of the same truth:
//   MEMBERS  (default) — the workspace: one row per member, click a week to act.
//   GRID               — the map: everyone at once, money in every cell.
//   PATTERNS           — ADMIN_IA §5.4: the same statuses as dots, one row per
//                        member, sorted worst-run-first. The grid answers "what
//                        does this cell say"; this answers "who is slipping",
//                        which is a different question and was unanswerable.
//
// All three read the SAME derived statuses from computeStanding, so they can
// never disagree about who is late. The filter is shared; the chosen view is
// remembered.

const VIEWS = ["list", "grid", "patterns"] as const;
type View = (typeof VIEWS)[number];

const ICON = {
  list: (
    <svg
      className="h-3.5 w-3.5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  ),
  grid: (
    <svg
      className="h-3.5 w-3.5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"
      />
    </svg>
  ),
  patterns: (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <rect x="17" y="10" width="4" height="4" rx="1" />
    </svg>
  ),
};

export function PaymentsScreen({
  data,
  focusWeek = null,
}: {
  data: {
    presentation?: boolean;
    cycleName: string;
    currentCycleWeek: number;
    grid: PaymentGrid;
    memberWeekly: Record<string, number>;
  };
  /** A week arrived at from `?week=N` — a chart, the cash page, a strip. */
  focusWeek?: number | null;
}) {
  const [view, setView] = usePersistedChoice<View>("admin-payments-view", VIEWS, "list");
  const [filter, setFilter] = useState<MemberFilter>("all");

  // ARRIVING AT A WEEK LANDS ON THE GRID, whatever view he last chose. The
  // members list has one row per PERSON; a week is a column there and cannot
  // be pointed at. The grid has one row per WEEK, which is what he clicked.
  // DERIVED, so it does not fight the toggle: the moment he presses Members or
  // Patterns the choice is his again, and the notice below goes with it.
  const [leftFocus, setLeftFocus] = useState(false);
  const focused = focusWeek !== null && !leftFocus;
  const shownView: View = focused ? "grid" : view;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 animate-fade-in-up">
        <div>
          <h1 className="text-xl font-black text-gray-900 dark:text-white">
            Payments — {data.cycleName}
          </h1>
          <p className="text-xs text-gray-600 dark:text-gray-400">
            Week {data.currentCycleWeek}. Members is where you record; the grid is the map;
            patterns is who is slipping.
          </p>
        </div>
        <SegmentedToggle
          label="View"
          value={shownView}
          onChange={(v) => {
            // Choosing a view is choosing to leave the week he arrived at.
            setLeftFocus(true);
            setView(v);
          }}
          options={[
            { value: "list", label: "Members", icon: ICON.list },
            { value: "grid", label: "Grid", icon: ICON.grid },
            { value: "patterns", label: "Patterns", icon: ICON.patterns },
          ]}
        />
      </div>

      {/* A SCREEN POINTED AT ONE WEEK SAYS SO. Without this the grid looks
          ordinary with one row mysteriously ringed, and the ring reads as a
          status rather than as "this is what you clicked". */}
      {focused && (
        <div
          data-testid="week-focus-notice"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-indigo-50 px-3 py-2 text-sm dark:bg-indigo-950/40"
        >
          <span className="font-bold text-indigo-900 dark:text-indigo-200">
            {focusNotice(focusWeek)}
          </span>
          <button
            type="button"
            onClick={() => setLeftFocus(true)}
            className="ml-auto text-xs font-semibold text-indigo-700 hover:underline dark:text-indigo-300"
          >
            Show every week
          </button>
        </div>
      )}

      <div className="animate-fade-in-up-1">
        {shownView === "list" && (
          <PaymentsMembers data={data} filter={filter} onFilterChange={setFilter} />
        )}
        {shownView === "grid" && (
          <PaymentsGrid
            data={data}
            filter={filter}
            onFilterChange={setFilter}
            focusWeek={focused ? focusWeek : null}
          />
        )}
        {/* PATTERNS NOW DOES SOMETHING. It answered "who is slipping" and
            then offered nothing to act on: every dot linked to the week board,
            which is the wrong destination — he has found a PERSON. A dot now
            opens the SAME payment entry the other two views use, with that
            week ticked; dragging across a run ticks the whole run. */}
        {shownView === "patterns" && (
          <PatternsView grid={data.grid} strips={stripsFrom(data.grid)} />
        )}
      </div>
    </div>
  );
}

/**
 * The grid, transposed into one strip per member.
 *
 * Reads the grid's OWN cells rather than re-deriving anything. A cell outside
 * a member's window is dropped rather than drawn as a missing week — a late
 * joiner's strip is short, not full of holes, which is the difference between
 * "joined in week 9" and "missed eight weeks".
 */
function stripsFrom(grid: PaymentGrid): MemberStrip[] {
  return grid.columns.map((column, i) => ({
    participationId: column.participationId,
    name: column.name,
    weeks: grid.rows
      .map((row) => ({ weekNumber: row.weekNumber, cell: row.cells[i] }))
      .filter((r) => r.cell?.kind === "week")
      .map((r) => ({
        weekNumber: r.weekNumber,
        state: consistencyFromStatus(
          (r.cell as Extract<PaymentGrid["rows"][number]["cells"][number], { kind: "week" }>).status,
        ),
      })),
  }));
}
