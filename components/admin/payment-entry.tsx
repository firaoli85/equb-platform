"use client";

import { useMemo, useRef, useState } from "react";
import { recordPayment } from "@/app/actions/payments";
import { SaveButton, type SaveState } from "@/components/ui/save-button";
import { AmountInput, Select } from "@/components/ui/controls";
import { formatMoney, parseDollarsToCents } from "@/lib/format";
import { allocationOutsideSelection } from "@/lib/payments-view";
import {
  amountForWeeks,
  coverageForAmount,
  coverageSentence,
  isPickable,
  quickAmounts,
  remainingOn,
  stepPickable,
  weeksInDrag,
  weeksTouchedBy,
  type PickableWeek,
} from "@/lib/week-picking";
import { inputCls } from "@/components/ui/primitives";

// THE ONE PAYMENT INTERACTION (2.19: one engine, one way to do each thing).
//
// Recording money is what the organizer does most, and it was the slowest
// screen he had: one week at a time, with "$2,000 — that's weeks 8, 9, 10 and
// 11" done in his head. This is that sum, done for him, from either end.
//
// SELECTION AND AMOUNT ARE TWO VIEWS OF ONE NUMBER.
//   Tick weeks      → the amount fills.
//   Type an amount  → the squares fill.
// Neither is the master. Touching one updates the other, immediately.
//
// THE GRID IS THE PREVIEW. There is no separate "this will cover…" diagram,
// because the weeks are already on screen as squares: typing $1,750 fills
// three of them solid and one half-way. An equb IS a grid of weeks, so the
// confirmation and the data are the same object. That is the one place this
// screen spends its boldness; everything else here is deliberately plain.
//
// TICKING NEVER PINS THE MONEY (§2.15, DOMAIN_RULES rule 4). A member four
// weeks behind who sends money is paying down the OLDEST debt, never the
// current week. Ticking computes an amount; `allocatePayment` still decides
// where it lands, and when the two differ this says so — in words, before
// anything commits.
//
// Design references: QuickBooks Bill Payment (the leftover is a permanent
// line, not an error state), Fresha Split payment (quick amounts + a remainder
// always on screen), Xero and Deel (selection count and total in the toolbar
// slot, actions appearing on first tick).

type Method = "ZELLE" | "CASH" | "OTHER";

const METHODS: { value: Method; label: string }[] = [
  { value: "ZELLE", label: "Zelle" },
  { value: "CASH", label: "Cash" },
  { value: "OTHER", label: "Other" },
];

export function PaymentEntry({
  participationId,
  memberName,
  weeks,
  preselect = [],
  onRecorded,
}: {
  participationId: string;
  memberName: string;
  /** Their own window, in week order, with what each still needs. */
  weeks: readonly PickableWeek[];
  /** Weeks ticked on open — the cell they clicked, or a dragged range. */
  preselect?: readonly number[];
  /** Fires after a successful record so the host can refresh. */
  onRecorded: (message: string) => void;
}) {
  const pickable = useMemo(() => weeks.filter(isPickable), [weeks]);

  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(preselect.filter((n) => pickable.some((w) => w.weekNumber === n))),
  );
  const [dollars, setDollars] = useState(() => {
    const cents = amountForWeeks(weeks, new Set(preselect));
    return cents > 0 ? String(cents / 100) : "";
  });
  const [method, setMethod] = useState<Method>("ZELLE");
  const [notes, setNotes] = useState("");
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });

  // A fresh key per submission intent, re-armed after each save, so a
  // double-click cannot double-pay.
  const [keyNonce, setKeyNonce] = useState(0);
  const idempotencyKey = useMemo(
    () => `${participationId}:${keyNonce}:${globalThis.crypto?.randomUUID?.() ?? keyNonce}`,
    [participationId, keyNonce],
  );

  const amount = parseDollarsToCents(dollars) ?? 0;
  const coverage = useMemo(() => coverageForAmount(weeks, amount), [weeks, amount]);
  const lands = useMemo(() => weeksTouchedBy(coverage), [coverage]);
  const chips = useMemo(() => quickAmounts(weeks), [weeks]);

  // WHERE THE MONEY ACTUALLY GOES vs WHAT HE TICKED. The honest half of the
  // ruling: silent when they agree, explicit when they do not.
  const elsewhere = useMemo(
    () =>
      selected.size === 0
        ? []
        : allocationOutsideSelection({
            // `applied`/`fillsWeek` are irrelevant here — this asks only WHICH
            // weeks the money reaches, not how much lands on each.
            allocations: lands.map((weekNumber) => ({
              weekNumber,
              applied: 0,
              fillsWeek: false,
            })),
            selectedWeeks: [...selected],
          }),
    [lands, selected],
  );

  /** Ticking rewrites the amount. The amount is never edited behind his back. */
  function applySelection(next: Set<number>) {
    setSelected(next);
    const cents = amountForWeeks(weeks, next);
    setDollars(cents > 0 ? String(cents / 100) : "");
    setSaveState({ kind: "idle" });
  }

  function toggleWeek(weekNumber: number) {
    const next = new Set(selected);
    if (next.has(weekNumber)) next.delete(weekNumber);
    else next.add(weekNumber);
    applySelection(next);
  }

  // ————— One range, three inputs —————
  //
  // Sweeping a run of weeks was mouse-only, and the organizer records money on
  // his phone at the meeting more often than at a desk. A finger, an arrow key
  // and a mouse now reach the same selection.
  //
  // THE ANCHOR is what all three extend FROM: the last square he touched
  // deliberately. Shift + click, Shift + Space and Shift + Arrow all mean
  // "take the run from the anchor to here".
  const [anchor, setAnchor] = useState<number | null>(null);

  // STATE, NOT A REF. The in-progress range has to be VISIBLE while the
  // pointer is down — the squares light up as he sweeps — and anything the
  // render reads has to be state. A ref held it first, which meant reading
  // `dragFrom.current` during render: `react-hooks/refs` caught it, and it was
  // a real bug rather than a lint preference, because a ref change does not
  // re-render and the highlight would have lagged a square behind the mouse.
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const dragRange = drag ? weeksInDrag(weeks, drag.from, drag.to) : [];

  // A sweep is followed by a click on the square it STARTED from. Without
  // this the sweep would select the run and the trailing click would
  // immediately untick its first week. A ref, not state, precisely because
  // nothing renders from it and it must be readable in the same tick — and it
  // is cleared on the next press, so a sweep that ends outside the grid
  // cannot swallow an unrelated click later.
  const afterSweep = useRef(false);

  function extendTo(weekNumber: number, from: number) {
    applySelection(new Set([...selected, ...weeksInDrag(weeks, from, weekNumber)]));
  }

  function endDrag() {
    if (drag && drag.from !== drag.to) {
      afterSweep.current = true;
      extendTo(drag.to, drag.from);
      setAnchor(drag.to);
    }
    setDrag(null);
  }

  /** Which square the DOM holds a live reference to, for arrow-key movement. */
  const gridRef = useRef<HTMLDivElement>(null);
  const [focusWeek, setFocusWeek] = useState<number | null>(null);
  // DERIVED, not mirrored: after a payment the weeks change, and a remembered
  // week that is no longer pickable would leave every square at tabIndex -1 —
  // a grid Tab could not reach at all.
  const rovingWeek =
    focusWeek !== null && pickable.some((w) => w.weekNumber === focusWeek)
      ? focusWeek
      : (pickable[0]?.weekNumber ?? null);

  function moveTo(target: number, extend: boolean, from: number) {
    setFocusWeek(target);
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-week="${target}"]`)?.focus();
    if (!extend) return;
    // Extending UNIONS, exactly as the drag does — Shift + Arrow never quietly
    // drops a week he already ticked. "Clear" is one control away.
    const base = anchor ?? from;
    if (anchor === null) setAnchor(from);
    extendTo(target, base);
  }

  function onSquareKeyDown(e: React.KeyboardEvent, weekNumber: number) {
    const direction =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0;
    const target =
      direction !== 0
        ? stepPickable(weeks, weekNumber, direction)
        : e.key === "Home"
          ? (pickable[0]?.weekNumber ?? null)
          : e.key === "End"
            ? (pickable[pickable.length - 1]?.weekNumber ?? null)
            : undefined;
    if (target === undefined) return;
    // Arrows scroll the page by default, and Home/End jump it to the ends.
    e.preventDefault();
    if (target !== null) moveTo(target, e.shiftKey, weekNumber);
  }

  const selectedTotal = amountForWeeks(weeks, selected);
  const canRecord = amount > 0 && coverage.unallocated === 0;

  async function commit() {
    if (!canRecord) return;
    setSaveState({ kind: "saving" });
    try {
      const result = await recordPayment({
        participationId,
        amount,
        method,
        idempotencyKey,
        notes: notes.trim() || undefined,
      });
      if (!result.ok) {
        setSaveState({ kind: "err", message: `Not recorded: ${result.error}` });
        return;
      }
      const message = `Recorded ${formatMoney(result.data.totalApplied)} for ${memberName} — ${coverageSentence(coverage, formatMoney).replace(/^This /, "").replace(/\.$/, "")}.`;
      setSaveState({ kind: "ok", message });
      onRecorded(`✓ ${message}`);
      applySelection(new Set());
      setNotes("");
      setKeyNonce((n) => n + 1);
    } catch {
      setSaveState({
        kind: "err",
        message:
          "Could not reach the server — the payment was NOT recorded. Check their weeks before entering it again.",
      });
    }
  }

  return (
    <div
      className="space-y-3"
      data-testid="payment-entry"
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
    >
      {/* THE SELECTION BAR — appears on first tick, never before. An
          always-present bar of dead controls is noise. It sits ABOVE the
          squares, in the slot the eye already checks, rather than floating
          over the very weeks being chosen. */}
      {selected.size > 0 && (
        <div
          data-testid="selection-bar"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-indigo-50 px-3 py-2 text-sm dark:bg-indigo-950/40"
        >
          <span className="font-bold text-indigo-900 tabular-nums dark:text-indigo-200">
            {selected.size} week{selected.size === 1 ? "" : "s"} selected
          </span>
          <span className="font-black text-indigo-900 tabular-nums dark:text-indigo-100">
            {formatMoney(selectedTotal)}
          </span>
          <button
            type="button"
            onClick={() => applySelection(new Set())}
            className="ml-auto text-xs font-semibold text-indigo-700 hover:underline dark:text-indigo-300"
          >
            Clear
          </button>
        </div>
      )}

      {/* THE WEEKS, AS SQUARES — and as the preview. Filled = this amount
          covers it; half = the leftover part-pays it; ring = ticked. */}
      <div>
        <p className="mb-1.5 text-xs font-semibold text-gray-600 dark:text-gray-400">
          {/* Nothing owed is a real state, and telling him to tick a week
              when none can be ticked reads as a broken screen. */}
          {pickable.length === 0
            ? `All of ${memberName}'s weeks are settled — nothing to record.`
            : `${memberName}'s weeks — tick one, or sweep across a run`}
        </p>
        <div
          ref={gridRef}
          // `touch-pan-y` gives a sideways sweep to the squares and keeps a
          // downward swipe as page scrolling: on a phone the grid must not
          // become a place the page refuses to scroll. When the browser does
          // take the gesture it sends `pointercancel`, and nothing commits.
          className="flex touch-pan-y flex-wrap gap-1.5"
          role="group"
          aria-label="Weeks to record"
          aria-describedby="week-grid-help"
          onPointerMove={(e) => {
            if (!drag) return;
            // TOUCH GETS IMPLICIT POINTER CAPTURE: every move is delivered to
            // the square the finger STARTED on, so `onPointerEnter` on the
            // siblings never fires and a finger-sweep would select exactly one
            // week. Asking the document what is under the pointer is the only
            // way to know, and it works identically for a mouse.
            const under = document
              .elementFromPoint(e.clientX, e.clientY)
              ?.closest<HTMLElement>("[data-week]");
            const week = Number(under?.dataset.week);
            if (Number.isFinite(week) && week !== drag.to) setDrag({ ...drag, to: week });
          }}
          onPointerCancel={() => setDrag(null)}
        >
          {weeks.map((w) => {
            const canPick = isPickable(w);
            const ticked = selected.has(w.weekNumber);
            const inDrag = dragRange.includes(w.weekNumber);
            const covered = coverage.fullWeeks.includes(w.weekNumber);
            const partial = coverage.partialWeek === w.weekNumber;
            const description = canPick
              ? `Week ${w.weekNumber} — ${formatMoney(remainingOn(w))} still owed`
              : w.isSkipped
                ? `Week ${w.weekNumber} — skipped, nobody owes it`
                : `Week ${w.weekNumber} — already paid`;
            return (
              <button
                key={w.weekNumber}
                type="button"
                disabled={!canPick}
                aria-pressed={ticked}
                aria-label={description}
                // ONE TAB STOP, not twenty. Tab reaches the grid, arrows move
                // inside it — the pattern every grid of controls uses, and the
                // reason arrow keys are free to mean something here.
                tabIndex={w.weekNumber === rovingWeek ? 0 : -1}
                data-week={w.weekNumber}
                data-covered={covered ? "full" : partial ? "partial" : undefined}
                title={description}
                onFocus={() => setFocusWeek(w.weekNumber)}
                onKeyDown={(e) => onSquareKeyDown(e, w.weekNumber)}
                onPointerDown={() => {
                  if (!canPick) return;
                  afterSweep.current = false;
                  setDrag({ from: w.weekNumber, to: w.weekNumber });
                }}
                // A click is a sweep that never moved: endDrag ignores it, and
                // this toggles the one square. Shift takes the run instead —
                // and a keyboard Space carries `shiftKey` too, so Shift+Space
                // is the same gesture without a pointer.
                onClick={(e) => {
                  if (!canPick) return;
                  if (afterSweep.current) {
                    afterSweep.current = false;
                    return;
                  }
                  if (e.shiftKey && anchor !== null) {
                    extendTo(w.weekNumber, anchor);
                    setAnchor(w.weekNumber);
                    return;
                  }
                  setAnchor(w.weekNumber);
                  toggleWeek(w.weekNumber);
                }}
                className={
                  "relative h-11 w-11 rounded-lg border-2 text-xs font-bold tabular-nums transition-colors md:h-9 md:w-9 " +
                  (!canPick
                    ? "cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-600"
                    : ticked || inDrag
                      ? "border-indigo-600 bg-indigo-600 text-white dark:border-indigo-500 dark:bg-indigo-500"
                      : covered
                        ? "border-indigo-400 bg-indigo-100 text-indigo-900 dark:border-indigo-600 dark:bg-indigo-950 dark:text-indigo-200"
                        : partial
                          ? "border-indigo-400 bg-gradient-to-r from-indigo-100 from-50% to-white to-50% text-indigo-900 dark:border-indigo-600 dark:from-indigo-950 dark:to-transparent dark:text-indigo-200"
                          : "border-gray-300 text-gray-700 hover:border-indigo-400 dark:border-gray-700 dark:text-gray-300")
                }
              >
                {w.weekNumber}
              </button>
            );
          })}
        </div>
        {/* Said once, quietly, and permanently: this is a screen he uses every
            week, and a hint that only appears on hover is one a keyboard never
            finds. It is also the group's description, so it is read aloud. */}
        {pickable.length > 0 && (
          <p
            id="week-grid-help"
            className="mt-1.5 text-[11px] text-gray-500 dark:text-gray-500"
          >
            Drag across a run, or use the arrow keys and hold Shift to take the run with you.
          </p>
        )}
      </div>

      {/* THE AMOUNT — the other view of the same number. */}
      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-gray-600 dark:text-gray-400">
            Amount received
          </span>
          <AmountInput
            value={dollars}
            onChange={(v) => {
              setDollars(v);
              // Typing takes over: the ticks stop claiming to describe it.
              setSelected(new Set());
              setSaveState({ kind: "idle" });
            }}
            ariaLabel="Amount received in dollars"
            className="w-32"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-gray-600 dark:text-gray-400">
            How
          </span>
          <Select
            value={method}
            onChange={(v) => setMethod(v as Method)}
            options={METHODS}
            ariaLabel="Payment method"
            className="w-32"
          />
        </label>
      </div>

      {/* QUICK AMOUNTS, from their real weeks — never a tier list. */}
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <button
              key={c.label}
              type="button"
              data-testid="quick-amount"
              onClick={() => applySelection(new Set(c.weeks))}
              className="rounded-full border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:border-indigo-400 hover:bg-indigo-50 dark:border-gray-700 dark:text-gray-300 dark:hover:border-indigo-600 dark:hover:bg-indigo-950/40"
            >
              {c.label} · {formatMoney(c.amount)}
            </button>
          ))}
        </div>
      )}

      {/* THE REMAINDER, ALWAYS PRESENT. Partial payments are first-class, so
          this line does not appear and disappear — a field that comes and goes
          is one he stops reading. */}
      <p
        data-testid="coverage"
        aria-live="polite"
        className="rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-800 dark:bg-white/5 dark:text-gray-200"
      >
        {coverageSentence(coverage, formatMoney)}
      </p>

      {/* THE HONEST HALF OF THE RULING. Ticking computed the amount; the
          engine sends it to the oldest debt. Silent when they agree. */}
      {elsewhere.length > 0 && (
        <p
          data-testid="lands-elsewhere"
          role="status"
          className="rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
        >
          Note: {formatMoney(amount)} lands on week{elsewhere.length === 1 ? "" : "s"}{" "}
          {elsewhere.join(", ")} first — {elsewhere.length === 1 ? "it is" : "they are"} older
          and still owed. Money always pays the oldest debt first.
        </p>
      )}

      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-gray-600 dark:text-gray-400">
          Note (optional)
        </span>
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything worth remembering about this payment"
          className={inputCls}
        />
      </label>

      <SaveButton
        state={saveState}
        onSave={() => void commit()}
        onStateSettled={() => setSaveState({ kind: "idle" })}
        label={amount > 0 ? `Record ${formatMoney(amount)}` : "Record"}
        savingLabel="Recording…"
        dirty={canRecord}
        notDirtyHint={
          amount <= 0
            ? "Enter an amount, or tick the weeks it covers."
            : "That amount does not fit their remaining weeks — reduce it."
        }
      />
    </div>
  );
}
