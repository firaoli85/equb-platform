"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { updatePayout } from "@/app/actions/edits";
import type { WaitingData } from "@/app/actions/waiting";
import { AssignPayout } from "@/app/admin/(protected)/people/[id]/assign-payout";
import { DatePicker } from "@/components/ui/date-picker";
import { moneyReceivedBounds } from "@/lib/date-bounds";
import { Select } from "@/components/ui/controls";
import { buttonCls, EmptyState, Pill } from "@/components/ui/primitives";
import { SaveButton, SaveFeedback, type SaveState } from "@/components/ui/save-button";
import { StatCard } from "@/components/ui/stat-card";
import { formatMoney } from "@/lib/format";
import { motionTokens, springs } from "@/lib/motion-tokens";
import {
  runwayLabel,
  sortWaiting,
  waitedLabel,
  WAITING_SORTS,
  type AwaitingPaymentRow,
  type AwaitingTurnRow,
  type WaitingSort,
} from "@/lib/waiting";

// A financial obligations screen, not a table dump: quiet rows, tabular
// figures, one prominent total per group, and the action that clears a row
// sitting on the row itself. Entrance motion is a short stagger and is
// reduced-motion gated; nothing moves once the list is on screen.

type Filter = "awaiting-payment" | "awaiting-turn" | "both";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "awaiting-payment", label: "Awaiting payment" },
  { key: "awaiting-turn", label: "Awaiting their turn" },
  { key: "both", label: "Both" },
];

const METHODS = [
  { value: "ZELLE", label: "Zelle" },
  { value: "CASH", label: "Cash" },
  { value: "OTHER", label: "Other" },
] as const;

const IDLE: SaveState = { kind: "idle" };

function methodLabel(value: string): string {
  return METHODS.find((m) => m.value === value)?.label ?? value;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** One row's entrance — a short lift, staggered, off under reduced motion. */
function useRowMotion(index: number) {
  const reduce = useReducedMotion();
  if (reduce) return {};
  return {
    initial: { opacity: 0, y: motionTokens.distance.sm },
    animate: { opacity: 1, y: 0 },
    transition: { ...springs.gentle, delay: Math.min(index, 8) * 0.03 },
  };
}

export function WaitingView({ data }: { data: WaitingData }) {
  const reduce = useReducedMotion();
  const [filter, setFilter] = useState<Filter>("awaiting-payment");
  const [sort, setSort] = useState<WaitingSort>("longest");

  /**
   * FEEDBACK SCOPED TO THE ROW THAT WAS PRESSED (UI_STANDARDS rule 6).
   *
   * This was ONE `msg` banner at the very top of the page. Confirming a
   * collection on the twelfth row wrote its confirmation above the three stat
   * cards, off the top of the screen — rule 6's original defect exactly, and
   * here it is money leaving the organizer's hands with nothing at the button
   * to say it left. Each row now carries its own `SaveState`, keyed by the
   * record the button acts on.
   */
  const [rowSave, setRowSave] = useState<Record<string, SaveState>>({});
  function reportFor(key: string) {
    return (state: SaveState) => setRowSave((m) => ({ ...m, [key]: state }));
  }

  const owedRows = useMemo(
    () => sortWaiting(data.awaitingPayment, sort),
    [data.awaitingPayment, sort],
  );
  const turnRows = useMemo(() => sortWaiting(data.awaitingTurn, sort), [data.awaitingTurn, sort]);
  const t = data.totals;

  const showOwed = filter !== "awaiting-turn";
  const showTurn = filter !== "awaiting-payment";

  // THE ONE MESSAGE THAT HAS NOWHERE LEFT TO GO.
  //
  // Success DELETES the control here: a collected payout leaves
  // `awaitingPayment` and a fully assigned member leaves `awaitingTurn`, so
  // the refresh that proves the action worked also unmounts the row the
  // button sat on. When the row is gone there is no "at the control" left,
  // so that one confirmation surfaces here. This is NOT the banner it
  // replaces: only a message whose own row has disappeared can reach it, and
  // every other message — every refusal, in particular — stays on its row.
  const liveRows = new Set<string>([
    ...data.awaitingPayment.map((r) => r.payoutId),
    ...data.awaitingTurn.map((r) => r.participationId),
  ]);
  const stranded = Object.entries(rowSave).filter(
    ([key, state]) => !liveRows.has(key) && (state.kind === "ok" || state.kind === "err"),
  );
  const strandedState = stranded.length > 0 ? stranded[stranded.length - 1][1] : null;

  return (
    <div className="space-y-6">
      {strandedState && <SaveFeedback state={strandedState} />}

      {/* ————— The two totals. Never added together. ————— */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Owed now"
          cents={t.owedNow}
          emphasis={t.owedNow > 0}
          sub={
            t.owedNowCount === 0
              ? "nobody is waiting to be paid"
              : `${t.owedNowCount} payout${t.owedNowCount === 1 ? "" : "s"} drawn and pending` +
                (t.longestWaitDays !== null ? ` · longest ${waitedLabel(t.longestWaitDays)}` : "")
          }
        />
        <StatCard
          label="Awaiting their turn"
          figure={String(t.eventualCount)}
          sub={
            t.eventualCount === 0
              ? "everyone has been drawn"
              : `will eventually receive ${formatMoney(t.eventualTotal)}`
          }
          delayClass="animate-fade-in-up-1"
        />
        <StatCard
          label="At risk"
          figure={String(t.atRiskCount)}
          emphasis={t.atRiskCount > 0}
          sub={
            t.atRiskCount === 0
              ? "no undrawn window is closing"
              : "undrawn with their window nearly over"
          }
          delayClass="animate-fade-in-up-2"
        />
      </div>

      {/* ————— Controls ————— */}
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label="Which group to show"
          className="flex flex-wrap items-center gap-1.5"
        >
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              className={`min-h-11 md:min-h-8 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-[background-color,border-color,transform] duration-150 ease-out active:scale-[0.97] ${
                filter === f.key
                  ? "border-indigo-400 dark:border-indigo-600 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-800 dark:text-indigo-300"
                  : "border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="ml-auto flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">Sort</span>
          <Select
            value={sort}
            onChange={(v) => setSort(v as WaitingSort)}
            ariaLabel="Sort the list"
            className="w-52"
            options={WAITING_SORTS.map((s) => ({ value: s.key, label: s.label }))}
          />
        </span>
      </div>

      {/* ————— Group 1: owed NOW ————— */}
      {showOwed && (
        <section aria-labelledby="owed-heading" className="space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2
              id="owed-heading"
              className="text-sm font-bold uppercase tracking-wider text-gray-900 dark:text-white"
            >
              Awaiting payment
            </h2>
            <p className="text-xs text-gray-600 dark:text-gray-400 text-pretty">
              Drawn and pending — the organizer owes this now.
            </p>
            <span className="ml-auto text-sm font-black tabular-nums text-gray-900 dark:text-white">
              {formatMoney(t.owedNow)}
            </span>
          </div>

          {owedRows.length === 0 ? (
            <EmptyState
              title="Nobody is waiting to be paid."
              hint="Every drawn payout has been handed over and marked collected."
            />
          ) : (
            <ul className="overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141414] shadow-sm">
              {owedRows.map((row, i) => (
                <OwedRow
                  key={row.payoutId}
                  row={row}
                  index={i}
                  reduce={reduce ?? false}
                  save={rowSave[row.payoutId] ?? IDLE}
                  report={reportFor(row.payoutId)}
                />
              ))}
            </ul>
          )}
        </section>
      )}

      {/* ————— Group 2: awaiting their turn ————— */}
      {showTurn && (
        <section aria-labelledby="turn-heading" className="space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2
              id="turn-heading"
              className="text-sm font-bold uppercase tracking-wider text-gray-900 dark:text-white"
            >
              Awaiting their turn
            </h2>
            <p className="text-xs text-gray-600 dark:text-gray-400 text-pretty">
              Never drawn — not owed yet, but the group will owe it.
            </p>
            <span className="ml-auto text-sm font-black tabular-nums text-gray-900 dark:text-white">
              {formatMoney(t.eventualTotal)}
            </span>
          </div>

          {turnRows.length === 0 ? (
            <EmptyState
              title="Everyone has been drawn."
              hint="No number is still in the wheel for this cycle."
            />
          ) : (
            <ul className="overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141414] shadow-sm">
              {turnRows.map((row, i) => (
                <TurnRow
                  key={row.participationId}
                  row={row}
                  index={i}
                  reduce={reduce ?? false}
                  save={rowSave[row.participationId] ?? IDLE}
                  report={reportFor(row.participationId)}
                />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

// ————————————————— Awaiting payment —————————————————

function OwedRow({
  row,
  index,
  reduce,
  save,
  report,
}: {
  row: AwaitingPaymentRow;
  index: number;
  reduce: boolean;
  save: SaveState;
  report: (state: SaveState) => void;
}) {
  const router = useRouter();
  const motionProps = useRowMotion(index);
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<"ZELLE" | "CASH" | "OTHER">(row.method ?? "ZELLE");
  const [paidAt, setPaidAt] = useState(todayIso());

  // Waiting a fortnight is the point where a pending payout stops being
  // normal and starts being a problem the organizer should see at a glance.
  const stale = (row.daysWaiting ?? 0) >= 14;

  async function collect() {
    report({ kind: "saving" });
    try {
      const result = await updatePayout({
        payoutId: row.payoutId,
        grossAmount: row.grossAmount,
        feeAmount: row.feeAmount,
        netAmount: row.netAmount,
        status: "COLLECTED",
        method,
        paidAt,
      });
      if (!result.ok) {
        // THE PANEL STAYS OPEN, holding the reason beside the button that was
        // pressed, with the method and the date still chosen for the retry.
        // There is no `finally` clearing anything: a refusal thrown away is
        // UI_STANDARDS 6b's exact failure.
        report({ kind: "err", message: `Not recorded: ${result.error}` });
        return;
      }
      // CLOSE ONLY ON SUCCESS — and the confirmation carries the figures,
      // because this is money the organizer has just said left his hands.
      setOpen(false);
      report({
        kind: "ok",
        message:
          `${row.name} collected ${formatMoney(row.netAmount)} (#${row.number}) — ` +
          `recorded as ${methodLabel(method)} on ${paidAt}.`,
      });
      router.refresh();
    } catch {
      report({ kind: "err", message: "Could not reach the server — nothing was recorded." });
    }
  }

  return (
    <motion.li
      {...motionProps}
      className="border-b border-gray-100 dark:border-gray-800/60 last:border-b-0"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/admin/people/${row.personId}`}
              className="truncate text-sm font-bold text-gray-900 dark:text-white hover:text-indigo-700 dark:hover:text-indigo-300 hover:underline"
            >
              {row.name}
            </Link>
            <span className="rounded-md bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-gray-700 dark:text-gray-300">
              #{row.number}
            </span>
            {stale && <Pill tone="problem">waiting {waitedLabel(row.daysWaiting)}</Pill>}
          </div>
          <p className="mt-0.5 text-xs tabular-nums text-gray-600 dark:text-gray-400">
            {row.weekNumber !== null ? `Drawn week ${row.weekNumber}` : "No draw recorded"} ·{" "}
            {stale ? "pending" : `pending ${waitedLabel(row.daysWaiting)}`}
            {row.method ? ` · ${methodLabel(row.method)}` : ""}
          </p>
        </div>

        <div className="text-right">
          <p className="text-base font-black tabular-nums leading-none text-gray-900 dark:text-white">
            {formatMoney(row.netAmount)}
          </p>
          <p className="mt-1 text-[11px] tabular-nums text-gray-500 dark:text-gray-400">
            {formatMoney(row.grossAmount)} gross · {formatMoney(row.feeAmount)} fee
            {row.settlementAmount > 0
              ? ` · ${formatMoney(row.settlementAmount)} settled their week`
              : ""}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={buttonCls.secondary + " !px-3 !py-1.5 !text-xs"}
        >
          {open ? "Close" : "Mark collected"}
        </button>

        {/* The panel below closes on success, taking its SaveButton — and the
            confirmation with it — so the row keeps saying it here, on the line
            under the control, until the refresh removes the row itself. While
            the panel is open the message belongs to the button inside it. */}
        {!open && <SaveFeedback state={save} className="basis-full" />}
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="collect"
            initial={reduce ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{
              duration: motionTokens.duration.fast,
              ease: motionTokens.easing.smooth,
            }}
            className="overflow-hidden"
          >
            <div className="flex flex-wrap items-end gap-3 border-t border-gray-100 dark:border-gray-800/60 bg-gray-50/60 dark:bg-white/[0.02] px-4 py-3">
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400">
                  How
                </span>
                <Select
                  value={method}
                  onChange={(v) => setMethod(v as "ZELLE" | "CASH" | "OTHER")}
                  ariaLabel={`Method for ${row.name}'s payout`}
                  className="w-36"
                  options={METHODS.map((m) => ({ value: m.value, label: m.label }))}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400">
                  When
                </span>
                <DatePicker
                  value={paidAt}
                  onChange={setPaidAt}
                  ariaLabel={`Date ${row.name} collected the payout`}
                  className="w-48"
                  bounds={moneyReceivedBounds()}
                />
              </label>
              {/* The confirmation and the refusal render HERE, beside the
                  button that moves the money — never at the top of a list this
                  row may be twelve deep in (rule 6). */}
              <SaveButton
                state={save}
                onSave={() => void collect()}
                onStateSettled={() => report(IDLE)}
                label={`Record ${formatMoney(row.netAmount)} collected`}
                savingLabel="Recording…"
              />
              <p className="basis-full text-[11px] text-gray-500 dark:text-gray-400">
                This is the same record Collections writes — it moves the payout from pending to
                collected and leaves an audit entry.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

// ————————————————— Awaiting their turn —————————————————

function TurnRow({
  row,
  index,
  reduce,
  save,
  report,
}: {
  row: AwaitingTurnRow;
  index: number;
  reduce: boolean;
  save: SaveState;
  report: (state: SaveState) => void;
}) {
  const router = useRouter();
  const motionProps = useRowMotion(index);
  const [open, setOpen] = useState(false);
  const progress =
    row.weeksCommitted > 0 ? Math.min(1, row.weeksPaid / row.weeksCommitted) : 0;

  return (
    <motion.li
      {...motionProps}
      className={`border-b border-gray-100 dark:border-gray-800/60 last:border-b-0 ${
        row.atRisk ? "bg-amber-50/50 dark:bg-amber-950/10" : ""
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/admin/people/${row.personId}`}
              className="truncate text-sm font-bold text-gray-900 dark:text-white hover:text-indigo-700 dark:hover:text-indigo-300 hover:underline"
            >
              {row.name}
            </Link>
            {row.numbers.map((n) => (
              <span
                key={n}
                className="rounded-md bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-gray-700 dark:text-gray-300"
              >
                #{n}
              </span>
            ))}
            {row.atRisk && (
              <Pill tone="attention">
                {row.weeksLeft < 0 ? "window closed, never drawn" : "window closing, never drawn"}
              </Pill>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-xs tabular-nums text-gray-600 dark:text-gray-400">
              Paid {row.weeksPaid} of {row.weeksCommitted} weeks · weeks {row.startWeek}–
              {row.finishWeek} · {runwayLabel(row.weeksLeft)}
            </span>
            <span
              aria-hidden
              className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-200 dark:bg-white/10"
            >
              <span
                className={`block h-full rounded-full ${row.atRisk ? "bg-amber-500" : "bg-indigo-500"}`}
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </span>
          </div>
        </div>

        <div className="text-right">
          <p className="text-base font-black tabular-nums leading-none text-gray-900 dark:text-white">
            {formatMoney(row.netAmount)}
          </p>
          <p className="mt-1 text-[11px] tabular-nums text-gray-500 dark:text-gray-400">
            when drawn · {formatMoney(row.grossAmount)} gross
          </p>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={buttonCls.secondary + " !px-3 !py-1.5 !text-xs"}
        >
          {open ? "Close" : "Assign payout"}
        </button>

        {/* A successful assignment closes the panel, so `AssignPayout`'s own
            confirmation is unmounted with it. The row is the smallest thing
            that survives, so it repeats the message here beside its control.
            A REFUSAL never reaches this: `AssignPayout` keeps the panel open
            holding the reason at the button that caused it (6b). */}
        {!open && <SaveFeedback state={save} className="basis-full" />}
      </div>

      {/* The manual-payout flow already built (2.19: no second money route),
          opened in place on this member with the numbers this row quoted. */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="assign"
            initial={reduce ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{
              duration: motionTokens.duration.fast,
              ease: motionTokens.easing.smooth,
            }}
            className="overflow-hidden"
          >
            <div className="border-t border-gray-100 dark:border-gray-800/60 bg-gray-50/60 dark:bg-white/[0.02] px-4 py-3">
              <AssignPayout
                participationId={row.participationId}
                defaultOpen
                preselectNumbers={row.numbers}
                onAssigned={(text) => {
                  setOpen(false);
                  report({ kind: "ok", message: text });
                  router.refresh();
                }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
}
