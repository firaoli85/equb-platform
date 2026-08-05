"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { deletePaymentEvent, setWeekDeferral, setWeekNote } from "@/app/actions/edits";
import { getCellDetail } from "@/app/actions/payments-view";
import { AllocationEntry } from "@/components/allocation-entry";
import { ConfirmDialog, type ConfirmSpec } from "@/components/ui/confirm-dialog";
import { Alert, buttonCls, Pill } from "@/components/ui/primitives";
import { useViewMode, ViewToggle } from "@/components/ui/view-toggle";
import { formatDateUTC, formatMoney } from "@/lib/format";
import { type PaymentGrid } from "@/lib/payments-view";

// The grid is for SEEING (2.15: the map). Money changes ONLY by recording or
// undoing receipts — paid/unpaid/partial/late are derived (2.14) and have no
// direct setter here or anywhere. The one stored decision a cell offers is
// deferral: a real organizer choice to excuse a week.

const MARKERS: Record<string, { label: string; className: string; meaning: string }> = {
  PAID: {
    label: "✓",
    className: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-300",
    meaning: "paid in full",
  },
  PARTIAL: {
    label: "◐",
    className: "bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-300",
    meaning: "partially paid",
  },
  UNPAID: {
    label: "·",
    className: "text-gray-600 dark:text-gray-400",
    meaning: "unpaid, window open",
  },
  LATE: {
    label: "✗",
    className: "bg-red-100 text-red-900 dark:bg-red-900/50 dark:text-red-300",
    meaning: "unpaid, window closed",
  },
  DEFERRED: {
    label: "—",
    className: "text-gray-500 dark:text-gray-500",
    meaning: "deferred (excused)",
  },
};

type SelectedCell = {
  participationId: string;
  name: string;
  weekNumber: number;
  remaining: number;
};

type CellDetail = {
  memberName: string;
  weekNumber: number;
  isDeferred: boolean;
  weekIsSkipped: boolean;
  note: string;
  receipts: {
    eventId: string;
    appliedHere: number;
    eventAmount: number;
    method: string | null;
    receivedAt: string;
  }[];
};

export function PaymentsGrid({
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
  const { grid } = data;
  // Presentation mode (2.4): the server sent numbers instead of names and no
  // amounts — the grid is a pure map: statuses visible, nothing clickable.
  const presentation = data.presentation === true;
  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null);
  // The MEMBERS LIST is the default: one row per member, readable at 27
  // members. The grid is the map you open deliberately (2.15).
  const [view, setView] = useViewMode("admin-payments-view", "list");
  const [filter, setFilter] = useState<"all" | "behind" | "unpaid-week">("all");

  // Grid filter: which member columns matter right now.
  const currentRow = grid.rows.find((r) => r.weekNumber === data.currentCycleWeek) ?? null;
  const visibleIdx = grid.columns
    .map((c, i) => i)
    .filter((i) => {
      if (presentation || filter === "all") return true;
      const c = grid.columns[i];
      if (filter === "behind") return c.outstanding > 0;
      const cell = currentRow?.cells[i];
      return (
        cell !== undefined &&
        cell.kind === "week" &&
        cell.status !== "PAID" &&
        cell.status !== "DEFERRED"
      );
    });
  const hiddenCount = grid.columns.length - visibleIdx.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 animate-fade-in-up">
        <h1 className="text-xl font-black text-gray-900 dark:text-white">
          Payments — {data.cycleName}
        </h1>
        <ViewToggle mode={view} onChange={setView} labels={{ list: "Members", grid: "Grid" }} />
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-gray-700 dark:text-gray-300 animate-fade-in-up-1">
        {Object.entries(MARKERS).map(([key, m]) => (
          <span key={key} className="flex items-center gap-1.5">
            <span className={`inline-block w-5 rounded text-center font-bold ${m.className}`}>
              {m.label}
            </span>
            {m.meaning}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-5 rounded text-center text-gray-400 dark:text-gray-600">○</span>
          not yet joined
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-5 rounded border border-dashed border-gray-300 dark:border-gray-700 text-center">
            &nbsp;
          </span>
          finished
        </span>
      </div>

      {view === "grid" ? (
        <>
        {!presentation && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs animate-fade-in-up-1">
            {(
              [
                { key: "all", label: `Everyone (${grid.columns.length})` },
                { key: "behind", label: "Behind" },
                { key: "unpaid-week", label: "Unpaid this week" },
              ] as const
            ).map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
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
            {filter !== "all" && (
              <span className="text-gray-600 dark:text-gray-400">
                showing {visibleIdx.length} of {grid.columns.length} members ({hiddenCount} hidden by
                this filter)
              </span>
            )}
          </div>
        )}
        <div className="max-h-[70vh] overflow-auto rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141414] shadow-sm animate-fade-in-up-2">
          <table className="border-collapse text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-20 border-b border-r border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-[#1a1a1a] px-2.5 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
                  Week
                </th>
                {visibleIdx.map((idx) => grid.columns[idx]).map((c) => (
                  <th
                    key={c.participationId}
                    className="sticky top-0 z-10 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-[#1a1a1a] px-1 py-2 text-center align-bottom"
                    title={`${c.name} — ${c.numbersLabel}${c.startWeek > 1 ? ` — joined week ${c.startWeek}` : ""}`}
                  >
                    {presentation ? (
                      <span className="block max-w-16 truncate font-bold text-gray-800 dark:text-gray-200">
                        {c.numbersLabel}
                      </span>
                    ) : (
                      <>
                        <Link
                          href={`/admin/participations/${c.participationId}`}
                          className="block max-w-16 truncate font-bold text-gray-800 dark:text-gray-200 hover:text-indigo-700 dark:hover:text-indigo-300 hover:underline"
                        >
                          {c.name.split("—")[1]?.trim() ?? c.name}
                        </Link>
                        <span className="block font-medium text-gray-500 dark:text-gray-500">
                          {c.numbersLabel}
                        </span>
                      </>
                    )}
                    {c.startWeek > 1 && (
                      <span className="block font-medium text-gray-500 dark:text-gray-500">
                        joined wk {c.startWeek}
                      </span>
                    )}
                  </th>
                ))}
                {!presentation && (
                  <th className="sticky top-0 z-10 border-b border-l border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-[#1a1a1a] px-2.5 py-2 text-right text-[11px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
                    Received / expected
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {grid.rows.map((row) => (
                <tr key={row.weekNumber}>
                  <th
                    className={`sticky left-0 z-10 border-r border-gray-200 dark:border-gray-800 px-2.5 py-1 text-left font-semibold text-gray-800 dark:text-gray-200 ${
                      row.weekNumber === data.currentCycleWeek
                        ? "border-l-4 border-l-indigo-500 dark:border-l-indigo-400 bg-indigo-50 dark:bg-indigo-950/50"
                        : "bg-white dark:bg-[#141414]"
                    }`}
                  >
                    <span className="tabular-nums">{row.weekNumber}</span>
                    <span className="ml-1.5 whitespace-nowrap font-normal text-gray-500 dark:text-gray-500 tabular-nums">
                      {formatDateUTC(row.date)}
                    </span>
                    {row.weekNumber === data.currentCycleWeek && (
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
                    if (cell.kind === "before-start") {
                      // Explicit and calm — never blank, never an accusation.
                      return (
                        <td
                          key={column.participationId}
                          className="border border-gray-100 dark:border-gray-800/60 text-center text-gray-300 dark:text-gray-700"
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
                          className="border border-dashed border-gray-200 dark:border-gray-800"
                          title={`${column.name} finished in week ${column.finishWeek}`}
                        />
                      );
                    }
                    const marker = MARKERS[cell.status];
                    const remaining = Math.max(0, cell.amountDue - cell.storedPaid);
                    if (presentation) {
                      return (
                        <td
                          key={column.participationId}
                          className={`border border-gray-100 dark:border-gray-800/60 p-0 text-center ${
                            row.weekNumber === data.currentCycleWeek
                              ? "bg-indigo-50/60 dark:bg-indigo-950/30"
                              : ""
                          }`}
                        >
                          <span
                            title={`${column.numbersLabel} — week ${row.weekNumber}: ${cell.status.toLowerCase()}`}
                            className={`block h-6 w-full min-w-8 font-bold leading-6 ${marker.className}`}
                          >
                            {marker.label}
                          </span>
                        </td>
                      );
                    }
                    return (
                      <td
                        key={column.participationId}
                        className={`border border-gray-100 dark:border-gray-800/60 p-0 text-center ${
                          row.weekNumber === data.currentCycleWeek
                            ? "bg-indigo-50/60 dark:bg-indigo-950/30"
                            : ""
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedCell({
                              participationId: column.participationId,
                              name: column.name,
                              weekNumber: row.weekNumber,
                              remaining,
                            })
                          }
                          title={`${column.name} — week ${row.weekNumber}: ${cell.status.toLowerCase()}, ${formatMoney(cell.storedPaid)} of ${formatMoney(cell.amountDue)}`}
                          className={`h-6 w-full min-w-8 font-bold transition-transform duration-100 ease-out hover:outline hover:outline-1 hover:outline-indigo-500 active:scale-95 ${marker.className}`}
                        >
                          {marker.label}
                        </button>
                      </td>
                    );
                  })}
                  {!presentation && (
                    <td className="whitespace-nowrap border-l border-gray-200 dark:border-gray-800 px-2.5 py-1 text-right tabular-nums text-gray-700 dark:text-gray-300">
                      {formatMoney(row.received)} / {formatMoney(row.expected)}
                    </td>
                  )}
                </tr>
              ))}
              {/* Column totals — each member's OWN window only */}
              <tr>
                <th className="sticky left-0 z-10 border-r border-t-2 border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#1a1a1a] px-2.5 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
                  Weeks paid · owed
                </th>
                {visibleIdx.map((idx) => grid.columns[idx]).map((c) => (
                  <td
                    key={c.participationId}
                    className="border-t-2 border-gray-300 dark:border-gray-700 px-1 py-1.5 text-center tabular-nums text-gray-700 dark:text-gray-300"
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
                ))}
                {!presentation && <td className="border-l border-t-2 border-gray-300 dark:border-gray-700" />}
              </tr>
            </tbody>
          </table>
        </div>
        </>
      ) : (
        /* ————— LIST VIEW: one row per member + compact week strip ————— */
        <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141414] shadow-sm animate-fade-in-up-2">
          <ul className="divide-y divide-gray-100 dark:divide-gray-800/60">
            {grid.columns.map((c, i) => {
              const strip = grid.rows.map((row) => ({
                weekNumber: row.weekNumber,
                cell: row.cells[i],
              }));
              const windowWeeks = c.finishWeek - c.startWeek + 1;
              const behindish = !presentation && c.outstanding > 0;
              const inner = (
                <>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">
                      {presentation ? c.numbersLabel : c.name}
                    </p>
                    <p className="mt-0.5 text-[11px] tabular-nums text-gray-600 dark:text-gray-400">
                      {presentation ? "" : `${c.numbersLabel} · `}
                      {c.weeksCredited} of {windowWeeks} weeks paid
                      {c.startWeek > 1 ? ` · joined wk ${c.startWeek}` : ""}
                    </p>
                    {/* Compact week strip */}
                    <div className="mt-1.5 flex gap-[3px]" aria-hidden="true">
                      {strip.map(({ weekNumber, cell }) => {
                        const base = "h-2.5 w-2.5 rounded-[3px]";
                        if (cell.kind === "before-start")
                          return <span key={weekNumber} className={`${base} bg-gray-100 dark:bg-white/5`} />;
                        if (cell.kind === "after-finish")
                          return (
                            <span
                              key={weekNumber}
                              className={`${base} border border-dashed border-gray-200 dark:border-gray-800`}
                            />
                          );
                        const statusCls =
                          cell.status === "PAID"
                            ? "bg-emerald-500 dark:bg-emerald-600"
                            : cell.status === "PARTIAL"
                              ? "bg-amber-400 dark:bg-amber-500"
                              : cell.status === "LATE"
                                ? "bg-red-500 dark:bg-red-600"
                                : cell.status === "DEFERRED"
                                  ? "bg-gray-300 dark:bg-gray-600"
                                  : "bg-gray-200 dark:bg-white/10";
                        // The current week is ALWAYS marked, whatever its status.
                        const nowCls =
                          weekNumber === data.currentCycleWeek
                            ? " ring-2 ring-indigo-500 dark:ring-indigo-400 ring-offset-1 ring-offset-white dark:ring-offset-[#141414]"
                            : "";
                        return (
                          <span
                            key={weekNumber}
                            className={`${base} ${statusCls}${nowCls}`}
                            title={`week ${weekNumber}${weekNumber === data.currentCycleWeek ? " (now)" : ""}${cell.kind === "week" ? ` — ${cell.status.toLowerCase()}` : ""}`}
                          />
                        );
                      })}
                    </div>
                  </div>
                  {behindish ? (
                    <Pill tone="attention">{formatMoney(c.outstanding)} owed</Pill>
                  ) : (
                    <Pill tone="good">
                      <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2 6l3 3 5-5" />
                      </svg>
                      Current
                    </Pill>
                  )}
                </>
              );
              return (
                <li key={c.participationId}>
                  {presentation ? (
                    <div className="flex items-center gap-3 px-4 py-3">{inner}</div>
                  ) : (
                    <Link
                      href={`/admin/participations/${c.participationId}`}
                      className="flex items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20"
                    >
                      {inner}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {selectedCell && (
        <CellMenu
          key={`${selectedCell.participationId}-${selectedCell.weekNumber}`}
          cell={selectedCell}
          onClose={() => setSelectedCell(null)}
        />
      )}
    </div>
  );
}

function CellMenu({ cell, onClose }: { cell: SelectedCell; onClose: () => void }) {
  const router = useRouter();
  const [tab, setTab] = useState<"record" | "receipts" | "note">("record");
  const [detail, setDetail] = useState<CellDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [onConfirm, setOnConfirm] = useState<(() => void) | null>(null);

  function ask(spec: ConfirmSpec, fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) {
    setConfirm(spec);
    setOnConfirm(() => () => {
      void run(fn, okText).finally(() => {
        setConfirm(null);
        setOnConfirm(null);
      });
    });
  }

  useEffect(() => {
    let cancelled = false;
    getCellDetail({ participationId: cell.participationId, weekNumber: cell.weekNumber }).then(
      (result) => {
        if (cancelled) return;
        if (result.ok) {
          setDetail(result.data);
          setNote(result.data.note);
        } else {
          setMsg({ kind: "err", text: result.error });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [cell.participationId, cell.weekNumber]);

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) {
    setBusy(true);
    setMsg(null);
    try {
      const result = await fn();
      if (!result.ok) setMsg({ kind: "err", text: result.error ?? "Failed." });
      else {
        setMsg({ kind: "ok", text: okText });
        router.refresh();
        // Re-pull the cell detail so the menu reflects the new truth.
        const fresh = await getCellDetail({
          participationId: cell.participationId,
          weekNumber: cell.weekNumber,
        });
        if (fresh.ok) {
          setDetail(fresh.data);
          setNote(fresh.data.note);
        }
      }
    } catch {
      setMsg({ kind: "err", text: "Could not reach the server — nothing was confirmed." });
    } finally {
      setBusy(false);
    }
  }

  function toggleDeferral() {
    if (!detail) return;
    const next = !detail.isDeferred;
    ask(
      {
        title: next
          ? `Defer week ${cell.weekNumber} for ${cell.name}?`
          : `Remove the deferral on week ${cell.weekNumber}?`,
        destructive: false,
        body: next ? (
          <p>
            A deferred week is excused: it is never owed and never counts as behind. Their
            receipts re-allocate immediately and an audit entry records the decision.
          </p>
        ) : (
          <p>
            The week is owed again. Their receipts re-allocate immediately and an audit entry
            records the decision.
          </p>
        ),
        confirmLabel: next ? `Defer week ${cell.weekNumber}` : "Make it owed again",
      },
      () =>
        setWeekDeferral({
          participationId: cell.participationId,
          weekNumber: cell.weekNumber,
          deferred: next,
        }),
      next
        ? `✓ Week ${cell.weekNumber} deferred — excused, never owed.`
        : `✓ Deferral removed — week ${cell.weekNumber} is owed again.`,
    );
  }

  return (
    <section className="rounded-2xl border-2 border-indigo-300 dark:border-indigo-800 bg-white dark:bg-[#141414] p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
        <h2 className="font-bold text-gray-900 dark:text-white">
          {cell.name} — week {cell.weekNumber}
        </h2>
        <span className="text-gray-600 dark:text-gray-400 tabular-nums">
          {detail
            ? detail.isDeferred
              ? "deferred (excused)"
              : cell.remaining > 0
                ? `${formatMoney(cell.remaining)} still due that week`
                : "that week is settled"
            : "loading…"}
        </span>
        <span className="ml-auto flex flex-wrap gap-2">
          {(["record", "receipts", "note"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] ${
                tab === t
                  ? "border-indigo-400 dark:border-indigo-600 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-800 dark:text-indigo-300"
                  : "border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5"
              }`}
            >
              {t === "record"
                ? "Record payment"
                : t === "receipts"
                  ? `Receipts (${detail?.receipts.length ?? "…"})`
                  : "Note"}
            </button>
          ))}
          <button
            type="button"
            onClick={toggleDeferral}
            disabled={busy || !detail || detail.weekIsSkipped}
            title={
              detail?.weekIsSkipped
                ? "The whole week is skipped for everyone — edit it on the Weeks page"
                : undefined
            }
            className="rounded-lg border border-gray-300 dark:border-gray-700 px-2.5 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-300 transition-[background-color,transform] duration-150 ease-out hover:bg-gray-50 dark:hover:bg-white/5 active:scale-[0.97] disabled:opacity-40"
          >
            {detail?.isDeferred ? "Remove deferral" : "Mark deferred"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 dark:border-gray-700 px-2.5 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-300 transition-[background-color,transform] duration-150 ease-out hover:bg-gray-50 dark:hover:bg-white/5 active:scale-[0.97]"
          >
            Close
          </button>
        </span>
      </div>

      {msg && (
        <div className="mb-2">
          <Alert kind={msg.kind}>{msg.text}</Alert>
        </div>
      )}

      {tab === "record" && (
        <>
          <p className="mb-2 text-xs text-gray-600 dark:text-gray-400">
            Oldest debt is paid first (2.15) — the preview shows exactly where this money
            lands, which may be an earlier week than week {cell.weekNumber}. To make a week
            unpaid, undo its receipt — paid/unpaid is derived from the money, never set by hand.
          </p>
          <AllocationEntry
            participationId={cell.participationId}
            memberName={cell.name}
            defaultAmountCents={cell.remaining > 0 ? cell.remaining : undefined}
            onSaved={() => router.refresh()}
          />
        </>
      )}

      {tab === "receipts" &&
        (detail === null ? (
          <p className="text-sm text-gray-600 dark:text-gray-400">Loading…</p>
        ) : detail.receipts.length === 0 ? (
          <p className="text-sm text-gray-600 dark:text-gray-400">No receipts on this week.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {detail.receipts.map((r) => (
              <li
                key={r.eventId}
                className="flex flex-wrap items-center gap-2 border-b border-gray-100 dark:border-gray-800/60 py-1.5"
              >
                <span className="font-semibold tabular-nums text-gray-900 dark:text-white">
                  {formatMoney(r.appliedHere)}
                  {r.appliedHere < r.eventAmount && (
                    <span className="font-normal text-gray-600 dark:text-gray-400">
                      {" "}
                      (of a {formatMoney(r.eventAmount)} receipt)
                    </span>
                  )}
                </span>
                <span className="text-gray-600 dark:text-gray-400">{r.method ?? "—"}</span>
                <span className="text-gray-600 dark:text-gray-400 tabular-nums">
                  {formatDateUTC(new Date(r.receivedAt))}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    const spans = r.appliedHere < r.eventAmount;
                    ask(
                      {
                        title: `Undo this ${formatMoney(r.eventAmount)} receipt from ${cell.name}?`,
                        body: (
                          <>
                            {spans ? (
                              <p>
                                Only {formatMoney(r.appliedHere)} of it sits on week{" "}
                                {cell.weekNumber} — the WHOLE receipt is deleted and every week
                                recalculates.
                              </p>
                            ) : (
                              <p>The receipt is deleted and the week recalculates.</p>
                            )}
                            <p>
                              The member&apos;s standing and the cash position recalculate
                              immediately. An audit entry records what was removed.
                            </p>
                          </>
                        ),
                        confirmLabel: "Undo receipt",
                      },
                      () => deletePaymentEvent({ eventId: r.eventId }),
                      `✓ Undone — ${formatMoney(r.eventAmount)} receipt deleted and weeks recalculated.`,
                    );
                  }}
                  className={buttonCls.danger + " !px-2.5 !py-1 !text-xs"}
                >
                  Undo
                </button>
              </li>
            ))}
          </ul>
        ))}

      {tab === "note" && (
        <div className="flex items-end gap-2 text-sm">
          <label className="grow">
            <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400">
              Note on week {cell.weekNumber}
            </span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1a1a1a] px-3.5 py-2.5 text-sm text-gray-900 dark:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 dark:focus:border-indigo-600"
            />
          </label>
          <button
            type="button"
            disabled={busy || detail === null || note === (detail?.note ?? "")}
            onClick={() =>
              void run(
                () =>
                  setWeekNote({
                    participationId: cell.participationId,
                    weekNumber: cell.weekNumber,
                    note,
                  }),
                "✓ Note saved.",
              )
            }
            className={buttonCls.primary}
          >
            {busy ? "Saving…" : "Save note"}
          </button>
        </div>
      )}

      <ConfirmDialog
        spec={confirm}
        busy={busy}
        onConfirm={() => onConfirm?.()}
        onCancel={() => {
          setConfirm(null);
          setOnConfirm(null);
        }}
      />
    </section>
  );
}
