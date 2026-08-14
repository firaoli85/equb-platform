"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConsistencyStrip, type MemberStrip } from "@/components/charts/consistency-strip";
import { PaymentEntry } from "@/components/admin/payment-entry";
import { Alert, buttonCls } from "@/components/ui/primitives";
import type { PaymentGrid } from "@/lib/payments-view";
import type { PickableWeek } from "@/lib/week-picking";

// PATTERNS, MADE ACTIONABLE.
//
// The chart answered the right question — "who is slipping" — and then left
// the organizer with nowhere to go: every dot was a link to the week board,
// which is a different screen about a different thing. He has just found a
// PERSON with four reds in a row; the next thing he wants is to record their
// money, not to navigate to week 9.
//
// So a dot opens the SAME `PaymentEntry` the Members and Grid views use, for
// that member, with that week ticked. Dragging across the run ticks the whole
// run. One payment interaction, three ways in (2.19).

export function PatternsView({
  grid,
  strips,
}: {
  grid: PaymentGrid;
  strips: MemberStrip[];
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<{
    participationId: string;
    name: string;
    weeks: number[];
  } | null>(null);

  /**
   * That member's own window, from the grid's OWN cells (2.19: nothing is
   * re-derived here). A cell outside their window is dropped rather than
   * drawn as a missing week.
   */
  function weeksFor(participationId: string): PickableWeek[] {
    const index = grid.columns.findIndex((c) => c.participationId === participationId);
    if (index === -1) return [];
    return grid.rows
      .map((row) => ({ weekNumber: row.weekNumber, cell: row.cells[index] }))
      .filter((r) => r.cell?.kind === "week")
      .map((r) => {
        const cell = r.cell as Extract<PaymentGrid["rows"][number]["cells"][number], { kind: "week" }>;
        return {
          weekNumber: r.weekNumber,
          amountDue: cell.amountDue,
          amountPaid: cell.storedPaid,
          isSkipped: cell.status === "SKIPPED",
          isDeferred: cell.status === "DEFERRED",
        };
      });
  }

  return (
    <div className="space-y-3">

      {picked && (
        <div
          className="rounded-2xl border-2 border-indigo-300 bg-white p-4 shadow-sm dark:border-indigo-800 dark:bg-[#141414]"
          data-testid="patterns-entry"
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-black text-gray-900 dark:text-white">
              Record a payment — {picked.name}
            </h3>
            <button
              type="button"
              onClick={() => setPicked(null)}
              className={buttonCls.ghost + " !px-2.5 !py-1 !text-xs"}
            >
              Close
            </button>
          </div>
          <PaymentEntry
            key={`${picked.participationId}:${picked.weeks.join(",")}`}
            participationId={picked.participationId}
            memberName={picked.name}
            weeks={weeksFor(picked.participationId)}
            preselect={picked.weeks}
            onRecorded={(message) => {
              // PaymentEntry stays mounted and confirms in place — echoing it
              // into a persistent Alert here said the same thing twice and
              // left the copy behind after the inline one faded.
              void message;
              router.refresh();
            }}
          />
        </div>
      )}

      <ConsistencyStrip
        members={strips}
        onPick={(participationId, weeks) => {
          const member = strips.find((s) => s.participationId === participationId);
          if (!member) return;
          setPicked({ participationId, name: member.name, weeks });
        }}
      />
    </div>
  );
}
