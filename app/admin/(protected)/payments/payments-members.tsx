"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { WeekActionPanel, type WeekTarget } from "@/components/admin/week-action-panel";
import { Select } from "@/components/ui/controls";
import { Alert, buttonCls, Pill } from "@/components/ui/primitives";
import { usePersistedChoice } from "@/components/ui/view-toggle";
import { formatMoney } from "@/lib/format";
import {
  buildMemberRows,
  visibleMembers,
  type MemberFilter,
  type MemberRow,
  type MemberSort,
} from "@/lib/members-view";
import type { GridCell, PaymentGrid } from "@/lib/payments-view";
import { STATUS_LABELS, STATUS_LEGEND, statusLabel } from "@/lib/status-labels";

// THE MEMBERS VIEW — where marking happens (the grid is the map, this is the
// workspace). One row per member, a week strip whose segments are big enough
// to read and hit, and one click into the shared per-week panel where
// recording, PARTIAL recording, deferral, receipts and notes all live.

// One vocabulary for every screen (lib/status-labels): same words, same
// colours here, in the grid and on the member profile. Contrast is MEASURED,
// not assumed — the week number is 11px bold, which WCAG does not treat as
// large text, so every pair clears 4.5:1 in both themes.
const STATUS_STYLE = STATUS_LABELS;

function cellTitle(memberName: string, weekNumber: number, cell: GridCell): string {
  if (cell.kind === "before-start") return `${memberName} had not joined in week ${weekNumber}`;
  if (cell.kind === "after-finish") return `${memberName} had finished by week ${weekNumber}`;
  const remaining = Math.max(0, cell.amountDue - cell.storedPaid);
  const label = statusLabel(cell.status);
  // A SKIPPED week owes nothing, so quoting an amount would be a lie. A
  // DEFERRED week is still owed, so it keeps its figures.
  return (
    `${memberName} — week ${weekNumber}: ${label.meaning}` +
    (cell.status === "SKIPPED"
      ? ""
      : `, ${formatMoney(cell.storedPaid)} of ${formatMoney(cell.amountDue)}` +
        (remaining > 0 ? ` (${formatMoney(remaining)} left)` : ""))
  );
}

export function PaymentsMembers({
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
  const router = useRouter();
  const presentation = data.presentation === true;
  // TYPED vs APPLIED (14 Aug 2026 ruling: filters do not fire on change
  // alone) — the search narrows the list on Enter or the button, never
  // mid-keystroke.
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<{ participationId: string; weekNumber: number } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const rows = useMemo(() => buildMemberRows(data.grid), [data.grid]);
  // Persisted (14 Aug 2026): the choice survives reloads and view switches,
  // same localStorage pattern as the view toggle.
  const [sort, setSort] = usePersistedChoice<MemberSort>(
    "admin-payments-sort",
    ["worst-first", "most-saved", "name"],
    "worst-first",
  );
  const shown = useMemo(
    () => visibleMembers({ rows, filter, search, currentWeek: data.currentCycleWeek, sort }),
    [rows, filter, search, data.currentCycleWeek, sort],
  );

  function targetFor(row: MemberRow, weekNumber: number): WeekTarget | null {
    const entry = row.cells.find((c) => c.weekNumber === weekNumber);
    if (!entry || entry.cell.kind !== "week") return null;
    return {
      participationId: row.participationId,
      memberName: row.name,
      weekNumber,
      amountDue: entry.cell.amountDue,
      amountAlreadyPaid: entry.cell.storedPaid,
      isDeferred: entry.cell.status === "DEFERRED",
    };
  }

  const FILTERS: { key: MemberFilter; label: string }[] = [
    { key: "all", label: `Everyone (${rows.length})` },
    { key: "behind", label: "Behind" },
    { key: "unpaid-week", label: `Unpaid week ${data.currentCycleWeek}` },
    { key: "partial", label: "Partial" },
  ];

  return (
    <div className="space-y-3">
      {saved && <Alert kind="ok">{saved}</Alert>}

      <div className="flex flex-wrap items-center gap-2">
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(typed);
          }}
        >
          <input
            type="search"
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value);
              // Clearing the box applies immediately — an empty search is
              // "show everyone", not a filter waiting to fire.
              if (e.target.value === "") setSearch("");
            }}
            placeholder="Search name or #number"
            aria-label="Search members by name or lucky number"
            className="w-56 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1a1a1a] px-3.5 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
          />
          <button
            type="submit"
            disabled={typed === search}
            className="rounded-xl border border-gray-300 px-3 text-xs font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/5"
          >
            Search
          </button>
        </form>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => onFilterChange(f.key)}
            aria-pressed={filter === f.key}
            className={`min-h-11 md:min-h-8 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] ${
              filter === f.key
                ? "border-indigo-400 dark:border-indigo-600 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-800 dark:text-indigo-300"
                : "border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5"
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">Sort</span>
          <Select
            value={sort}
            onChange={(v) => setSort(v as MemberSort)}
            ariaLabel="Sort the member list"
            className="w-44"
            options={[
              { value: "worst-first", label: "Most owed first" },
              { value: "most-saved", label: "Most saved first" },
              { value: "name", label: "Name" },
            ]}
          />
        </span>
        <span className="basis-full text-xs text-gray-600 dark:text-gray-400">
          {shown.length} of {rows.length} shown
        </span>
      </div>

      {/* Legend — the strip is only readable if the colours are named. */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-700 dark:text-gray-300">
        {STATUS_LEGEND.map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={`inline-block h-3.5 w-3.5 rounded ${STATUS_STYLE[s].cls}`} />
            {STATUS_STYLE[s].short}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3.5 w-3.5 rounded ring-2 ring-indigo-500" />
          this week
        </span>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141414] px-6 py-10 text-center">
          {/* TWO DIFFERENT ZEROES. "Nobody matches — clear the search" is
              wrong advice when the cycle simply has no members: there is no
              search to clear, and the sentence sends the reader looking for
              a filter that is not on. */}
          {rows.length === 0 ? (
            <>
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                Nobody is in this cycle yet.
              </p>
              <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                Add a member and their weeks appear here.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-gray-900 dark:text-white">Nobody matches.</p>
              <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                Clear the search or choose “Everyone”.
              </p>
            </>
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {shown.map((row) => {
            const thisWeek = row.cells.find((c) => c.weekNumber === data.currentCycleWeek);
            const thisWeekCell = thisWeek?.cell.kind === "week" ? thisWeek.cell : null;
            const dueNow = thisWeekCell
              ? Math.max(0, thisWeekCell.amountDue - thisWeekCell.storedPaid)
              : 0;
            const isOpenHere = open?.participationId === row.participationId;
            const shortName = row.name;

            return (
              <li
                key={row.participationId}
                className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141414] p-3 shadow-sm"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  {presentation ? (
                    <span className="font-bold text-gray-900 dark:text-white">
                      {row.numbersLabel}
                    </span>
                  ) : (
                    <Link
                      href={`/admin/participations/${row.participationId}`}
                      className="font-bold text-gray-900 dark:text-white hover:text-indigo-700 dark:hover:text-indigo-300 hover:underline"
                    >
                      {shortName}
                    </Link>
                  )}
                  {!presentation && (
                    <span className="text-xs tabular-nums text-gray-500 dark:text-gray-400">
                      {row.numbersLabel}
                    </span>
                  )}
                  {!presentation && (
                    <span className="text-xs font-bold tabular-nums text-gray-900 dark:text-white">
                      {formatMoney(row.totalContributed)}
                      <span className="font-normal text-gray-600 dark:text-gray-400"> paid in</span>
                    </span>
                  )}
                  <span className="text-xs tabular-nums text-gray-600 dark:text-gray-400">
                    {row.weeksCredited} of {row.finishWeek - row.startWeek + 1} weeks
                    {row.startWeek > 1 ? ` · joined wk ${row.startWeek}` : ""}
                  </span>
                  {!presentation &&
                    (row.outstanding > 0 ? (
                      <Pill tone="problem">{formatMoney(row.outstanding)} overdue</Pill>
                    ) : (
                      <Pill tone="good">nothing overdue</Pill>
                    ))}

                  {!presentation && thisWeekCell && dueNow > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setOpen({
                          participationId: row.participationId,
                          weekNumber: data.currentCycleWeek,
                        })
                      }
                      className={buttonCls.primary + " ml-auto !px-3 !py-1.5 !text-xs"}
                    >
                      Record week {data.currentCycleWeek} · {formatMoney(dueNow)}
                    </button>
                  )}
                </div>

                {/* ————— The week strip: readable, labelled, clickable ————— */}
                <div className="mt-2 flex flex-wrap gap-1">
                  {row.cells.map(({ weekNumber, cell }) => {
                    const isNow = weekNumber === data.currentCycleWeek;
                    const nowRing = isNow
                      ? " ring-2 ring-indigo-500 dark:ring-indigo-400 ring-offset-1 ring-offset-white dark:ring-offset-[#141414]"
                      : "";
                    const base =
                      "flex h-8 w-9 shrink-0 items-center justify-center rounded-md text-[11px] font-bold tabular-nums transition-transform duration-100 ease-out";

                    if (cell.kind !== "week") {
                      // Outside this member's window. The digit here used to
                      // be printed in gray-300, which measures 1.47:1 — text
                      // nobody can read and a screen reader announces as a
                      // bare number. The dashed placeholder holds the column
                      // position; the meaning lives in the label.
                      return (
                        <span
                          key={weekNumber}
                          role="img"
                          aria-label={cellTitle(shortName, weekNumber, cell)}
                          title={cellTitle(shortName, weekNumber, cell)}
                          className={`${base} border border-dashed border-gray-200 dark:border-gray-800${nowRing}`}
                        />
                      );
                    }
                    const style = STATUS_STYLE[cell.status] ?? STATUS_STYLE.UNPAID;
                    const isOpenCell =
                      isOpenHere && open?.weekNumber === weekNumber ? " outline outline-2 outline-indigo-600" : "";
                    if (presentation) {
                      return (
                        <span
                          key={weekNumber}
                          title={`week ${weekNumber}: ${style.short}`}
                          className={`${base} ${style.cls}${nowRing}`}
                        >
                          {weekNumber}
                        </span>
                      );
                    }
                    return (
                      <button
                        key={weekNumber}
                        type="button"
                        aria-label={cellTitle(shortName, weekNumber, cell)}
                        title={cellTitle(shortName, weekNumber, cell)}
                        onClick={() =>
                          setOpen(
                            isOpenHere && open?.weekNumber === weekNumber
                              ? null
                              : { participationId: row.participationId, weekNumber },
                          )
                        }
                        className={`${base} ${style.cls}${nowRing}${isOpenCell} hover:brightness-110 active:scale-95`}
                      >
                        {weekNumber}
                      </button>
                    );
                  })}
                </div>

                {isOpenHere && open && (
                  <div className="mt-3">
                    {(() => {
                      const target = targetFor(row, open.weekNumber);
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
                    })()}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
