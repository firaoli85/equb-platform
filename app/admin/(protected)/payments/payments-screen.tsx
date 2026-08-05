"use client";

import { useState } from "react";
import { ViewToggle, useViewMode } from "@/components/ui/view-toggle";
import type { MemberFilter } from "@/lib/members-view";
import type { PaymentGrid } from "@/lib/payments-view";
import { PaymentsGrid } from "./payments-grid";
import { PaymentsMembers } from "./payments-members";

// ONE payments screen with two representations of the same truth:
//   MEMBERS (default) — the workspace: one row per member, click a week to act.
//   GRID              — the map: everyone at once, spot patterns; clicking a
//                       cell opens the SAME per-week panel.
// The filter is shared between them, and the chosen view is remembered.

export function PaymentsScreen({
  data,
}: {
  data: {
    presentation?: boolean;
    cycleName: string;
    currentCycleWeek: number;
    grid: PaymentGrid;
    memberWeekly: Record<string, number>;
  };
}) {
  const [view, setView] = useViewMode("admin-payments-view", "list");
  const [filter, setFilter] = useState<MemberFilter>("all");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 animate-fade-in-up">
        <div>
          <h1 className="text-xl font-black text-gray-900 dark:text-white">
            Payments — {data.cycleName}
          </h1>
          <p className="text-xs text-gray-600 dark:text-gray-400">
            Week {data.currentCycleWeek}. Members is where you record; the grid is the map.
          </p>
        </div>
        <ViewToggle mode={view} onChange={setView} labels={{ list: "Members", grid: "Grid" }} />
      </div>

      <div className="animate-fade-in-up-1">
        {view === "list" ? (
          <PaymentsMembers data={data} filter={filter} onFilterChange={setFilter} />
        ) : (
          <PaymentsGrid data={data} filter={filter} onFilterChange={setFilter} />
        )}
      </div>
    </div>
  );
}
