"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { previewAllocation, recordPayment } from "@/app/actions/payments";
import { deletePaymentEvent, setWeekDeferral, setWeekNote } from "@/app/actions/edits";
import { getCellDetail } from "@/app/actions/payments-view";
import { recordLedgerPayment } from "@/app/actions/ledger";
import { AllocationEntry } from "@/components/allocation-entry";
import { ConfirmDialog, type ConfirmSpec } from "@/components/ui/confirm-dialog";
import { AmountInput, Checkbox, Select } from "@/components/ui/controls";
import { Alert, buttonCls, Pill, type PillTone } from "@/components/ui/primitives";
import {
  allocationOutsideSelection,
  bulkCatchUpAmount,
  describeAllocation,
  type CatchUpWeek,
} from "@/lib/payments-view";
import { formatDateUTC, formatMoney, parseDollarsToCents } from "@/lib/format";
import { oldestN, parseWeekRange, selectableWeekNumbers, weeksInRange } from "@/lib/week-selection";

type Method = "ZELLE" | "CASH" | "OTHER";

type WeekRow = CatchUpWeek & {
  date: string;
  /** DERIVED by computeStanding (2.14) — the strip never re-derives it. */
  status: string;
};

// Everything the organizer can do for this member's money, in ONE place
// (2.19: still the one engine — recording flows through previewAllocation /
// recordPayment only; deferral/notes/undo reuse the same actions the grid
// uses; the ledger is its own money, never the allocation engine).

const STATUS_PILL: Record<string, { text: string; tone: PillTone }> = {
  PAID: { text: "Paid", tone: "good" },
  PARTIAL: { text: "Partial", tone: "attention" },
  UNPAID: { text: "Unpaid", tone: "neutral" },
  LATE: { text: "Late", tone: "problem" },
  DEFERRED: { text: "Excused", tone: "neutral" },
};

function statusOf(w: WeekRow): { text: string; tone: PillTone } {
  return STATUS_PILL[w.status] ?? { text: w.status, tone: "neutral" };
}

export function MemberPayments({
  participationId,
  memberName,
  weeks,
  outstanding,
  carriedBalance = 0,
  personId,
}: {
  participationId: string;
  memberName: string;
  weeks: WeekRow[];
  /** Derived by getMemberStanding — passed through, never recomputed. */
  outstanding: number;
  carriedBalance?: number;
  personId?: string;
}) {
  const router = useRouter();
  const [openEntry, setOpenEntry] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [method, setMethod] = useState<Method>("ZELLE");
  const [rangeText, setRangeText] = useState("");
  const [expandedWeek, setExpandedWeek] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [onConfirm, setOnConfirm] = useState<(() => void) | null>(null);

  const [preview, setPreview] = useState<{
    text: string;
    outside: number[];
    amount: number;
    fingerprint: string;
  } | null>(null);
  const [busy, setBusy] = useState<"preview" | "save" | "week" | "ledger" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const [keyNonce, setKeyNonce] = useState(0);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  useEffect(() => {
    setIdempotencyKey(crypto.randomUUID());
  }, [keyNonce]);

  const owing = selectableWeekNumbers(weeks);
  const selectedWeeks = weeks.filter((w) => selected.has(w.weekNumber));
  const amount = bulkCatchUpAmount(selectedWeeks);
  const weeksFingerprint = weeks
    .map((w) => `${w.weekNumber}:${w.amountDue}:${w.amountAlreadyPaid}:${w.isDeferred ? 1 : 0}`)
    .join("|");
  useEffect(() => {
    setPreview((p) => (p && p.fingerprint !== weeksFingerprint ? null : p));
  }, [weeksFingerprint]);
  const previewValid =
    preview !== null && preview.amount === amount && preview.fingerprint === weeksFingerprint;

  function select(next: Set<number>) {
    setSelected(next);
    setPreview(null);
    setError(null);
    setSaved(null);
  }

  function toggle(weekNumber: number) {
    const next = new Set(selected);
    if (next.has(weekNumber)) next.delete(weekNumber);
    else next.add(weekNumber);
    select(next);
  }

  function applyRange() {
    const range = parseWeekRange(rangeText);
    if (!range) {
      setError(`"${rangeText}" isn't a week range — try "7 to 12".`);
      return;
    }
    const inRange = weeksInRange(weeks, range);
    if (inRange.length === 0) {
      setError(`No owed weeks between ${range.from} and ${range.to}.`);
      return;
    }
    select(new Set([...selected, ...inRange]));
    setRangeText("");
  }

  async function handlePreview() {
    if (amount < 1) return;
    setBusy("preview");
    setError(null);
    setSaved(null);
    try {
      const result = await previewAllocation({ participationId, amount });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.data.allocations.length === 0 || result.data.unallocated > 0) {
        setPreview(null);
        setError(
          result.data.allocations.length === 0
            ? "Nothing to record — those weeks are already covered by earlier receipts."
            : `Only ${formatMoney(result.data.totalApplied)} of this fits the member's weeks — the state has changed since the list was loaded. Reload and re-select.`,
        );
        return;
      }
      setPreview({
        text: describeAllocation(result.data),
        outside: allocationOutsideSelection({
          allocations: result.data.allocations,
          selectedWeeks: [...selected],
        }),
        amount,
        fingerprint: weeksFingerprint,
      });
    } catch {
      setError("Could not reach the server — nothing was previewed.");
    } finally {
      setBusy(null);
    }
  }

  async function handleCommit() {
    if (!previewValid || !idempotencyKey) return;
    setBusy("save");
    setError(null);
    try {
      const result = await recordPayment({
        participationId,
        amount: preview!.amount,
        method,
        idempotencyKey,
        notes: `Catch-up for weeks ${[...selected].sort((a, b) => a - b).join(", ")}`,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Clear the selection WITHOUT select() — that helper wipes feedback,
      // and the confirmation must survive the commit (2.10).
      setSelected(new Set());
      setPreview(null);
      setSaved(
        `✓ Recorded ${formatMoney(result.data.totalApplied)} — ${describeAllocation({ allocations: result.data.allocations, unallocated: 0 })}.`,
      );
      setKeyNonce((n) => n + 1);
      router.refresh();
    } catch {
      setError(
        "Could not reach the server — the catch-up was NOT confirmed. Check the weeks before entering it again.",
      );
    } finally {
      setBusy(null);
    }
  }

  function askConfirm(spec: ConfirmSpec, action: () => Promise<void>) {
    setConfirm(spec);
    setOnConfirm(() => () => {
      void (async () => {
        setBusy("week");
        try {
          await action();
        } finally {
          setBusy(null);
          setConfirm(null);
          setOnConfirm(null);
        }
      })();
    });
  }

  function deferWeek(w: WeekRow, defer: boolean) {
    askConfirm(
      {
        title: defer ? `Defer week ${w.weekNumber} for ${memberName}?` : `Remove the deferral on week ${w.weekNumber}?`,
        body: defer ? (
          <>
            <p>
              A deferred week is excused: it is never owed and never counts as behind. Their
              receipts re-allocate immediately and the standing above recalculates.
            </p>
            <p>An audit entry records the decision.</p>
          </>
        ) : (
          <>
            <p>
              Week {w.weekNumber} ({formatMoney(w.amountDue)}) is owed again. Their receipts
              re-allocate immediately and the standing above recalculates.
            </p>
            <p>An audit entry records the decision.</p>
          </>
        ),
        confirmLabel: defer ? `Defer week ${w.weekNumber}` : "Make it owed again",
        destructive: false,
      },
      async () => {
        const result = await setWeekDeferral({
          participationId,
          weekNumber: w.weekNumber,
          deferred: defer,
        });
        if (!result.ok) setError(result.error);
        else {
          setSaved(
            defer
              ? `✓ Week ${w.weekNumber} deferred — excused, never owed.`
              : `✓ Deferral removed — week ${w.weekNumber} is owed again.`,
          );
          setExpandedWeek(null); // the panel's snapshot is stale — close it
          router.refresh();
        }
      },
    );
  }

  const [ledgerDollars, setLedgerDollars] = useState("");

  return (
    <div className="space-y-4">
      {/* ————— THE primary action (never buried) ————— */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-gray-700 dark:text-gray-300 tabular-nums">
          {outstanding > 0 ? (
            <>
              <strong className="text-base font-black text-gray-900 dark:text-white">
                {formatMoney(outstanding)}
              </strong>{" "}
              outstanding
            </>
          ) : (
            <span className="font-semibold text-emerald-700 dark:text-emerald-400">
              Fully paid up
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={() => setOpenEntry((o) => !o)}
          className={buttonCls.primary}
          aria-expanded={openEntry}
        >
          {openEntry ? "Close" : "Record payment"}
        </button>
        {carriedBalance > 0 && personId && (
          <span className="ml-auto flex items-center gap-2 text-xs text-amber-800 dark:text-amber-400">
            <span className="tabular-nums">
              Carried balance: <strong>{formatMoney(carriedBalance)}</strong>
            </span>
            <AmountInput
              value={ledgerDollars}
              onChange={setLedgerDollars}
              ariaLabel="Ledger payment amount in dollars"
              className="w-28"
            />
            <button
              type="button"
              disabled={busy !== null || parseDollarsToCents(ledgerDollars) === null}
              onClick={() => {
                const cents = parseDollarsToCents(ledgerDollars);
                if (cents === null) return;
                askConfirm(
                  {
                    title: `Record ${formatMoney(cents)} against the carried balance?`,
                    body: (
                      <p>
                        {memberName} carries {formatMoney(carriedBalance)} from earlier. This
                        records a ledger payment — it never touches this cycle&apos;s weeks. The
                        balance becomes{" "}
                        <strong className="tabular-nums">
                          {formatMoney(Math.max(0, carriedBalance - cents))}
                        </strong>
                        .
                      </p>
                    ),
                    confirmLabel: "Record ledger payment",
                    destructive: false,
                  },
                  async () => {
                    const result = await recordLedgerPayment({ personId, amount: cents });
                    if (!result.ok) setError(result.error);
                    else {
                      setSaved(
                        `✓ Ledger payment recorded — ${formatMoney(result.data.remaining)} still carried.`,
                      );
                      setLedgerDollars("");
                      router.refresh();
                    }
                  },
                );
              }}
              className={buttonCls.secondary + " !px-2.5 !py-1.5 !text-xs"}
            >
              Record
            </button>
          </span>
        )}
      </div>

      {openEntry && (
        <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/40 dark:bg-indigo-950/20 p-4">
          <AllocationEntry
            participationId={participationId}
            memberName={memberName}
            defaultAmountCents={outstanding > 0 ? outstanding : undefined}
            onSaved={(message) => {
              // The entry unmounts on save — its confirmation must not be
              // lost with it (2.10).
              setSaved(message);
              setOpenEntry(false);
              router.refresh();
            }}
          />
        </div>
      )}

      {/* ————— The week strip: see, select, act ————— */}
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
            Their weeks
          </span>
          <button type="button" onClick={() => select(new Set(owing))} className={buttonCls.ghost + " !text-xs"}>
            All unpaid ({owing.length})
          </button>
          <button
            type="button"
            onClick={() => select(new Set(oldestN(weeks, 3)))}
            className={buttonCls.ghost + " !text-xs"}
          >
            Oldest 3
          </button>
          <button type="button" onClick={() => select(new Set())} className={buttonCls.ghost + " !text-xs"}>
            Clear
          </button>
          <span className="flex items-center gap-1.5">
            <input
              type="text"
              value={rangeText}
              onChange={(e) => setRangeText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyRange();
                }
              }}
              placeholder="7 to 12"
              aria-label="Select a week range"
              className="w-24 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1a1a1a] px-2.5 py-1.5 text-xs tabular-nums text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            />
            <button type="button" onClick={applyRange} className={buttonCls.ghost + " !text-xs"}>
              Select range
            </button>
          </span>
        </div>

        <ul className="divide-y divide-gray-100 dark:divide-gray-800/60 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
          {weeks.map((w) => {
            const s = statusOf(w);
            const selectable = !w.isDeferred && w.amountAlreadyPaid < w.amountDue;
            const remaining = Math.max(0, w.amountDue - w.amountAlreadyPaid);
            const expanded = expandedWeek === w.weekNumber;
            return (
              <li key={w.weekNumber} className="bg-white dark:bg-[#141414]">
                <div className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="w-5">
                    {selectable ? (
                      <Checkbox
                        checked={selected.has(w.weekNumber)}
                        onChange={() => toggle(w.weekNumber)}
                        label={<span className="sr-only">Select week {w.weekNumber}</span>}
                      />
                    ) : null}
                  </span>
                  <span className="w-8 font-semibold tabular-nums text-gray-900 dark:text-white">
                    {w.weekNumber}
                  </span>
                  <span className="w-28 tabular-nums text-gray-600 dark:text-gray-400">
                    {formatDateUTC(new Date(w.date))}
                  </span>
                  <Pill tone={s.tone}>{s.text}</Pill>
                  <span className="flex-1 text-right text-xs tabular-nums text-gray-600 dark:text-gray-400">
                    {remaining > 0 && !w.isDeferred ? `${formatMoney(remaining)} left` : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => setExpandedWeek(expanded ? null : w.weekNumber)}
                    aria-expanded={expanded}
                    aria-label={`Actions for week ${w.weekNumber}`}
                    className={buttonCls.ghost + " !px-2 !text-xs"}
                  >
                    {expanded ? "Close" : "Actions"}
                  </button>
                </div>
                {expanded && (
                  <WeekActions
                    participationId={participationId}
                    memberName={memberName}
                    week={w}
                    onDefer={(defer) => deferWeek(w, defer)}
                    onError={setError}
                    onSaved={(msg) => {
                      setSaved(msg);
                      setExpandedWeek(null); // panel data is stale after any action
                      router.refresh();
                    }}
                    askConfirm={askConfirm}
                  />
                )}
              </li>
            );
          })}
        </ul>

        <p className="mt-2 text-sm tabular-nums text-gray-800 dark:text-gray-200">
          {selected.size} week{selected.size === 1 ? "" : "s"} selected ={" "}
          <strong>{formatMoney(amount)}</strong>
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Select<Method>
            value={method}
            onChange={setMethod}
            ariaLabel="Payment method"
            className="w-32"
            options={[
              { value: "ZELLE", label: "Zelle" },
              { value: "CASH", label: "Cash" },
              { value: "OTHER", label: "Other" },
            ]}
          />
          <button
            type="button"
            onClick={handlePreview}
            disabled={amount < 1 || busy !== null}
            className={buttonCls.secondary}
          >
            {busy === "preview" ? "Checking…" : "Preview catch-up"}
          </button>
        </div>

        {previewValid && (
          <div
            className="mt-2 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/20 px-3.5 py-2.5 text-sm"
            data-testid="catchup-preview"
          >
            <p className="text-gray-800 dark:text-gray-200">
              <strong className="tabular-nums">{formatMoney(preview!.amount)}</strong>: {preview!.text}
            </p>
            {preview!.outside.length > 0 && (
              <p className="mt-1 text-red-800 dark:text-red-400">
                Note: oldest debt is paid first, so this also covers week
                {preview!.outside.length === 1 ? " " : "s "}
                {preview!.outside.join(", ")}, which you did not select.
              </p>
            )}
            <button
              type="button"
              onClick={handleCommit}
              disabled={busy !== null || !idempotencyKey}
              className={buttonCls.primary + " mt-2"}
            >
              {busy === "save" ? "Recording…" : "Confirm and record"}
            </button>
          </div>
        )}

        {error && (
          <div className="mt-2">
            <Alert kind="err">Not recorded: {error}</Alert>
          </div>
        )}
        {saved && (
          <div className="mt-2">
            <Alert kind="ok">{saved}</Alert>
          </div>
        )}
      </div>

      <ConfirmDialog
        spec={confirm}
        busy={busy === "week" || busy === "ledger"}
        onConfirm={() => onConfirm?.()}
        onCancel={() => {
          setConfirm(null);
          setOnConfirm(null);
        }}
      />
    </div>
  );
}

// Per-week actions: defer, receipts (undo), note — the SAME actions the
// grid's cell menu offers, from the member page.
function WeekActions({
  participationId,
  memberName,
  week,
  onDefer,
  onError,
  onSaved,
  askConfirm,
}: {
  participationId: string;
  memberName: string;
  week: WeekRow;
  onDefer: (defer: boolean) => void;
  onError: (msg: string) => void;
  onSaved: (msg: string) => void;
  askConfirm: (spec: ConfirmSpec, action: () => Promise<void>) => void;
}) {
  const [detail, setDetail] = useState<{
    isDeferred: boolean;
    weekIsSkipped: boolean;
    note: string;
    receipts: { eventId: string; appliedHere: number; eventAmount: number; method: string | null; receivedAt: string }[];
  } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getCellDetail({ participationId, weekNumber: week.weekNumber }).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setDetail(result.data);
        setNote(result.data.note);
      } else onError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [participationId, week.weekNumber, onError]);

  if (!detail)
    return <p className="px-3 pb-3 text-xs text-gray-500 dark:text-gray-500">Loading week…</p>;

  return (
    <div className="space-y-3 border-t border-gray-100 dark:border-gray-800/60 bg-gray-50/60 dark:bg-white/[0.02] px-3 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={detail.weekIsSkipped}
          title={
            detail.weekIsSkipped
              ? "The whole week is skipped for everyone — edit it on the Weeks page"
              : undefined
          }
          onClick={() => onDefer(!detail.isDeferred)}
          className={buttonCls.secondary + " !px-3 !py-1.5 !text-xs"}
        >
          {detail.isDeferred ? "Remove deferral" : "Mark deferred"}
        </button>
        <span className="text-xs text-gray-600 dark:text-gray-400">
          {detail.receipts.length} receipt{detail.receipts.length === 1 ? "" : "s"} on this week
        </span>
      </div>

      {detail.receipts.length > 0 && (
        <ul className="space-y-1">
          {detail.receipts.map((r) => (
            <li key={r.eventId} className="flex flex-wrap items-center gap-2 text-xs">
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
              <span className="tabular-nums text-gray-600 dark:text-gray-400">
                {formatDateUTC(new Date(r.receivedAt))}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  const spans = r.appliedHere < r.eventAmount;
                  askConfirm(
                    {
                      title: `Undo this ${formatMoney(r.eventAmount)} receipt from ${memberName}?`,
                      body: (
                        <>
                          {spans ? (
                            <p>
                              Only {formatMoney(r.appliedHere)} of it sits on week {week.weekNumber} —
                              the WHOLE receipt is deleted and every week recalculates.
                            </p>
                          ) : (
                            <p>The receipt is deleted and week {week.weekNumber} recalculates.</p>
                          )}
                          <p>The standing above and the cash position recalculate immediately. An audit entry records what was removed.</p>
                        </>
                      ),
                      confirmLabel: "Undo receipt",
                    },
                    async () => {
                      setBusy(true);
                      const result = await deletePaymentEvent({ eventId: r.eventId });
                      setBusy(false);
                      if (!result.ok) onError(result.error);
                      else
                        onSaved(
                          `✓ Undone — ${formatMoney(r.eventAmount)} receipt deleted and weeks recalculated.`,
                        );
                    },
                  );
                }}
                className={buttonCls.danger + " !px-2 !py-0.5 !text-xs"}
              >
                Undo
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-end gap-2">
        <label className="grow">
          <span className="mb-1 block text-xs font-semibold text-gray-600 dark:text-gray-400">
            Note on week {week.weekNumber}
          </span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1a1a1a] px-2.5 py-1.5 text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
          />
        </label>
        <button
          type="button"
          disabled={busy || note === detail.note}
          onClick={() => {
            void (async () => {
              setBusy(true);
              const result = await setWeekNote({
                participationId,
                weekNumber: week.weekNumber,
                note,
              });
              setBusy(false);
              if (!result.ok) onError(result.error);
              else onSaved("✓ Note saved.");
            })();
          }}
          className={buttonCls.secondary + " !px-3 !py-1.5 !text-xs"}
        >
          Save note
        </button>
      </div>
    </div>
  );
}
