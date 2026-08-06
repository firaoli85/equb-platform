"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { WeekActionPanel, type WeekTarget } from "@/components/admin/week-action-panel";
import { Alert } from "@/components/ui/primitives";
import { formatDateUTC, formatMoney } from "@/lib/format";
import { matchesFilter, buildMemberRows, type MemberFilter } from "@/lib/members-view";
import { type PaymentGrid } from "@/lib/payments-view";
import { STATUS_LABELS, STATUS_LEGEND, statusLabel } from "@/lib/status-labels";

// THE GRID — the map (2.15): everyone at once, to spot patterns. It does not
// record money by itself; clicking a cell opens the SAME per-week panel the
// Members view uses, so there is one way to do each thing. Paid/unpaid/
// partial/late are DERIVED (2.14) and have no direct setter anywhere.

// The status vocabulary lives in ONE place (lib/status-labels) so a week can
// never be called one thing here and another on the Members view or the
// member profile. Every pair is MEASURED over 4.5:1 in both themes.
const MARKERS = STATUS_LABELS;
export function PaymentsGrid({
  data,
  filter,
  onFilterChange,
}: {
  data: {
    presentation?: boolean;
    cycleName: string;
    currentCycleWeek: number;
    grid: PaymentGrid;
    memberWeekly: Record<string, number>;
  };
  filter: MemberFilter;
  onFilterChange: (f: MemberFilter) => void;
}) {
  const { grid } = data;
  const router = useRouter();
  // Presentation mode (2.4): the server sent numbers instead of names and no
  // amounts — the grid is a pure map: statuses visible, nothing clickable.
  const presentation = data.presentation === true;
  const [open, setOpen] = useState<{ participationId: string; weekNumber: number } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  // The same filter predicate the Members view uses, so switching views keeps
  // the same people on screen.
  const rows = buildMemberRows(grid);
  const visibleIdx = grid.columns
    .map((_, i) => i)
    .filter((i) =>
      presentation ? true : matchesFilter(rows[i], filter, data.currentCycleWeek),
    );
  const hiddenCount = grid.columns.length - visibleIdx.length;

  const FILTERS: { key: MemberFilter; label: string }[] = [
    { key: "all", label: `Everyone (${grid.columns.length})` },
    { key: "behind", label: "Behind" },
    { key: "unpaid-week", label: `Unpaid week ${data.currentCycleWeek}` },
    { key: "partial", label: "Partial" },
  ];

  function targetFor(colIdx: number, weekNumber: number): WeekTarget | null {
    const row = grid.rows.find((r) => r.weekNumber === weekNumber);
    const cell = row?.cells[colIdx];
    if (!cell || cell.kind !== "week") return null;
    const column = grid.columns[colIdx];
    return {
      participationId: column.participationId,
      memberName: column.name.split("—")[1]?.trim() || column.name,
      weekNumber,
      amountDue: cell.amountDue,
      amountAlreadyPaid: cell.storedPaid,
      isDeferred: cell.status === "DEFERRED",
    };
  }

  return (
    <div className="space-y-3">
      {saved && <Alert kind="ok">{saved}</Alert>}

      {!presentation && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => onFilterChange(f.key)}
              aria-pressed={filter === f.key}
              className={`rounded-lg border px-2.5 py-1.5 font-semibold transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] ${
                filter === f.key
                  ? "border-indigo-400 dark:border-indigo-600 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-800 dark:text-indigo-300"
                  : "border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5"
              }`}
            >
              {f.label}
            </button>
          ))}
          {hiddenCount > 0 && (
            <span className="text-gray-600 dark:text-gray-400">
              showing {visibleIdx.length} of {grid.columns.length} members
            </span>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-gray-700 dark:text-gray-300">
        {STATUS_LEGEND.map((key) => {
          const m = MARKERS[key];
          return (
          <span key={key} className="flex items-center gap-1.5">
            <span
              className={`inline-flex h-5 w-5 items-center justify-center rounded font-bold ${m.cls}`}
            >
              {m.glyph}
            </span>
            {m.meaning}
          </span>
          );
        })}
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-5 w-5 rounded text-center text-gray-400 dark:text-gray-600">
            ○
          </span>
          not yet joined
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-5 w-5 rounded border border-dashed border-gray-300 dark:border-gray-700" />
          finished
        </span>
      </div>

      {/* The matrix. Both the week column and the header row are frozen, so
          scrolling in either direction stays oriented at 27 x 20. */}
      <div className="max-h-[70vh] overflow-auto rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141414] shadow-sm">
        <table className="border-collapse text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 border-b border-r-2 border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-[#1a1a1a] px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
                Week
              </th>
              {visibleIdx.map((idx) => {
                const c = grid.columns[idx];
                return (
                  <th
                    key={c.participationId}
                    className="sticky top-0 z-20 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-[#1a1a1a] px-1.5 py-2 text-center align-bottom"
                    title={`${c.name} — ${c.numbersLabel}${c.startWeek > 1 ? ` — joined week ${c.startWeek}` : ""}`}
                  >
                    {presentation ? (
                      <span className="block w-20 truncate text-[11px] font-bold text-gray-800 dark:text-gray-200">
                        {c.numbersLabel}
                      </span>
                    ) : (
                      <Link
                        href={`/admin/participations/${c.participationId}`}
                        className="block w-20 truncate text-[11px] font-bold text-gray-800 dark:text-gray-200 hover:text-indigo-700 dark:hover:text-indigo-300 hover:underline"
                      >
                        {c.name.split("—")[1]?.trim() ?? c.name}
                      </Link>
                    )}
                    <span className="block text-[10px] font-medium text-gray-500 dark:text-gray-400">
                      {c.numbersLabel}
                    </span>
                    {c.startWeek > 1 && (
                      <span className="block text-[10px] font-medium text-gray-500 dark:text-gray-400">
                        joined wk {c.startWeek}
                      </span>
                    )}
                  </th>
                );
              })}
              {!presentation && (
                <th className="sticky top-0 z-20 whitespace-nowrap border-b border-l border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-[#1a1a1a] px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
                  Received / expected
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row) => {
              const isNow = row.weekNumber === data.currentCycleWeek;
              return (
                <tr key={row.weekNumber}>
                  <th
                    className={`sticky left-0 z-10 whitespace-nowrap border-r-2 border-gray-200 dark:border-gray-800 px-3 py-1.5 text-left font-semibold text-gray-800 dark:text-gray-200 ${
                      isNow
                        ? "border-l-4 border-l-indigo-500 dark:border-l-indigo-400 bg-indigo-50 dark:bg-indigo-950/50"
                        : "bg-white dark:bg-[#141414]"
                    }`}
                  >
                    <span className="tabular-nums">{row.weekNumber}</span>
                    <span className="ml-1.5 font-normal tabular-nums text-gray-500 dark:text-gray-400">
                      {formatDateUTC(row.date)}
                    </span>
                    {isNow && (
                      <span className="ml-1.5 rounded-full bg-indigo-600 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-white">
                        now
                      </span>
                    )}
                    {row.isSkipped && (
                      <span className="ml-1 text-gray-400 dark:text-gray-600">(skipped)</span>
                    )}
                  </th>

                  {visibleIdx.map((i) => {
                    const cell = row.cells[i];
                    const column = grid.columns[i];
                    const nowBg = isNow ? "bg-indigo-50/60 dark:bg-indigo-950/30" : "";

                    if (cell.kind === "before-start") {
                      return (
                        <td
                          key={column.participationId}
                          className={`border border-gray-100 dark:border-gray-800/60 text-center text-gray-300 dark:text-gray-700 ${nowBg}`}
                          title={`${column.name} had not joined yet — they joined in week ${column.startWeek}`}
                        >
                          ○
                        </td>
                      );
                    }
                    if (cell.kind === "after-finish") {
                      return (
                        <td
                          key={column.participationId}
                          className={`border border-dashed border-gray-200 dark:border-gray-800 ${nowBg}`}
                          title={`${column.name} finished in week ${column.finishWeek}`}
                        />
                      );
                    }

                    const marker = statusLabel(cell.status);
                    const isOpen =
                      open?.participationId === column.participationId &&
                      open?.weekNumber === row.weekNumber;
                    const label = `${column.name} — week ${row.weekNumber}: ${marker.meaning}, ${formatMoney(cell.storedPaid)} of ${formatMoney(cell.amountDue)}`;

                    if (presentation) {
                      return (
                        <td
                          key={column.participationId}
                          className={`border border-gray-100 dark:border-gray-800/60 p-0.5 text-center ${nowBg}`}
                        >
                          <span
                            title={`${column.numbersLabel} — week ${row.weekNumber}: ${marker.meaning}`}
                            className={`flex h-8 w-full min-w-9 items-center justify-center rounded font-bold ${marker.cls}`}
                          >
                            {marker.glyph}
                          </span>
                        </td>
                      );
                    }
                    return (
                      <td
                        key={column.participationId}
                        className={`border border-gray-100 dark:border-gray-800/60 p-0.5 text-center ${nowBg}`}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setOpen(
                              isOpen
                                ? null
                                : {
                                    participationId: column.participationId,
                                    weekNumber: row.weekNumber,
                                  },
                            )
                          }
                          aria-label={label}
                          title={label}
                          className={`flex h-8 w-full min-w-9 items-center justify-center rounded font-bold transition-transform duration-100 ease-out hover:brightness-110 active:scale-95 ${marker.cls} ${
                            isOpen ? "outline outline-2 outline-indigo-600" : ""
                          }`}
                        >
                          {marker.glyph}
                        </button>
                      </td>
                    );
                  })}

                  {!presentation && (
                    <td className="whitespace-nowrap border-l border-gray-200 dark:border-gray-800 px-3 py-1.5 text-right tabular-nums text-gray-700 dark:text-gray-300">
                      {formatMoney(row.received)} / {formatMoney(row.expected)}
                    </td>
                  )}
                </tr>
              );
            })}

            {/* Column totals — each member's OWN window only */}
            <tr>
              <th className="sticky left-0 z-10 border-r-2 border-t-2 border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#1a1a1a] px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
                Weeks paid · owed
              </th>
              {visibleIdx.map((idx) => {
                const c = grid.columns[idx];
                return (
                  <td
                    key={c.participationId}
                    className="border-t-2 border-gray-300 dark:border-gray-700 px-1.5 py-2 text-center tabular-nums text-gray-700 dark:text-gray-300"
                    title={
                      presentation
                        ? `${c.numbersLabel}: ${c.weeksCredited} of ${c.finishWeek - c.startWeek + 1} weeks paid`
                        : `${c.name}: ${c.weeksCredited} of ${c.finishWeek - c.startWeek + 1} weeks paid, ${formatMoney(c.outstanding)} outstanding`
                    }
                  >
                    <span className="font-semibold">
                      {c.weeksCredited}/{c.finishWeek - c.startWeek + 1}
                    </span>
                    {!presentation && (
                      <span className="block font-semibold text-red-700 dark:text-red-400">
                        {c.outstanding > 0 ? formatMoney(c.outstanding) : "—"}
                      </span>
                    )}
                  </td>
                );
              })}
              {!presentation && (
                <td className="border-l border-t-2 border-gray-300 dark:border-gray-700" />
              )}
            </tr>
          </tbody>
        </table>
      </div>

      {/* The SAME panel the Members view opens — one way to do each thing. */}
      {open && !presentation && (
        (() => {
          const colIdx = grid.columns.findIndex((c) => c.participationId === open.participationId);
          const target = colIdx >= 0 ? targetFor(colIdx, open.weekNumber) : null;
          if (!target) return null;
          return (
            <WeekActionPanel
              key={`${open.participationId}-${open.weekNumber}`}
              target={target}
              onSaved={(message) => {
                setSaved(message);
                setOpen(null);
                router.refresh();
              }}
              onClose={() => setOpen(null)}
            />
          );
        })()
      )}
    </div>
  );
}
