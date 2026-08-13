"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { recordLedgerPayment } from "@/app/actions/ledger";
import { WeekActionPanel } from "@/components/admin/week-action-panel";
import { PaymentEntry } from "@/components/admin/payment-entry";
import { ConfirmDialog, type ConfirmSpec } from "@/components/ui/confirm-dialog";
import { AmountInput, Checkbox, Select } from "@/components/ui/controls";
import { buttonCls, Pill, type PillTone } from "@/components/ui/primitives";
import { SaveFeedback, type SaveState } from "@/components/ui/save-button";
import { bulkCatchUpAmount, type CatchUpWeek } from "@/lib/payments-view";
import { formatDateUTC, formatMoney, parseDollarsToCents } from "@/lib/format";
import { oldestN, parseWeekRange, selectableWeekNumbers, weeksInRange } from "@/lib/week-selection";
import { statusLabel } from "@/lib/status-labels";

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

// The words and tones come from the ONE vocabulary (lib/status-labels), so
// this page cannot drift from the grid or the members view.
function statusOf(w: WeekRow): { text: string; tone: PillTone; meaning: string } {
  const label = statusLabel(w.status);
  return { text: label.text, tone: label.tone as PillTone, meaning: label.meaning };
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
  /** Weeks handed to the shared entry when the strip selection is recorded. */
  const [preselect, setPreselect] = useState<number[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [method, setMethod] = useState<Method>("ZELLE");
  const [rangeText, setRangeText] = useState("");
  const [expandedWeek, setExpandedWeek] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  /**
   * A refusal from the action the dialog just ran. Set it and the dialog stays
   * open with the reason inside, beside the button that caused it — never only
   * in a banner elsewhere on the page (UI_STANDARDS 6b).
   */
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [onConfirm, setOnConfirm] = useState<(() => void) | null>(null);

  // ONE SaveState PER PLACE A MESSAGE CAN BELONG (§2.10, UI_STANDARDS rule 6).
  //
  // There used to be a single `error` and a single `saved`, both drawn at the
  // FOOT of the week list. The carried-balance "Record" button is in the header
  // strip at the very top of this component; a week's panel can be forty rows
  // above the message it produced. Whichever control he had just pressed, the
  // answer appeared somewhere he was not looking — the exact defect rule 6
  // exists to stop.
  //
  //   ledgerSave — the carried-balance Record button, in the header strip.
  //   weekSave   — WHICH row reported, so the confirmation renders on that row
  //                and on no other.
  //   rangeSave  — "7 to 12" refused, beside the box that refused it.
  //
  // Recording a payment is not in this list, and that is deliberate:
  // `PaymentEntry` renders its own SaveButton under its own commit button, and
  // that message is the only place the WhatsApp outcome appears. Copying it
  // down here is what put the sentence most likely to matter off-screen.
  const [ledgerSave, setLedgerSave] = useState<SaveState>({ kind: "idle" });
  const [weekSave, setWeekSave] = useState<{ weekNumber: number; state: SaveState } | null>(null);
  const [rangeSave, setRangeSave] = useState<SaveState>({ kind: "idle" });

  // DERIVED, never a second flag: `busy` was its own state naming which action
  // was running, which is the same fact as `kind === "saving"` here. The ledger
  // payment is the only action this component's dialog runs.
  const ledgerBusy = ledgerSave.kind === "saving";

  const owing = selectableWeekNumbers(weeks);
  const selectedWeeks = weeks.filter((w) => selected.has(w.weekNumber));
  const amount = bulkCatchUpAmount(selectedWeeks);

  function select(next: Set<number>) {
    setSelected(next);
    // Only the range box's own refusal is stale once the selection changes.
    setRangeSave({ kind: "idle" });
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
      setRangeSave({
        kind: "err",
        message: `"${rangeText}" isn't a week range — try "7 to 12".`,
      });
      return;
    }
    const inRange = weeksInRange(weeks, range);
    if (inRange.length === 0) {
      setRangeSave({
        kind: "err",
        message: `No owed weeks between ${range.from} and ${range.to}.`,
      });
      return;
    }
    select(new Set([...selected, ...inRange]));
    setRangeText("");
  }



  /**
   * `action` reports its own refusal by returning it. It used to return void
   * and this closed the dialog regardless, so a refusal from the ledger
   * "Record" button — which sits in the header strip at the TOP of this
   * component — landed in the alert at line ~500, past the whole week table
   * (UI_STANDARDS 6b).
   */
  function askConfirm(spec: ConfirmSpec, action: () => Promise<string | null | void>) {
    setConfirm(spec);
    setDialogError(null);
    setOnConfirm(() => () => {
      void (async () => {
        // The action owns its own "saving" — that is what the dialog's busy
        // state is read from, so there is no second flag saying the same thing.
        const refusal = await action();
        if (typeof refusal === "string" && refusal.length > 0) {
          setDialogError(refusal);
          return;
        }
        setConfirm(null);
        setOnConfirm(null);
      })();
    });
  }

  // Per-week deferral now lives in the shared WeekActionPanel (2.19:
  // one way to do each thing) — it is opened from the strip below.

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
              overdue
            </>
          ) : (
            <span className="font-semibold text-emerald-700 dark:text-emerald-400">
              Nothing overdue
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
          // A DIV, not a span: the confirmation below is a paragraph, and a
          // paragraph inside a span is not markup any of this can rely on.
          <div className="ml-auto flex flex-wrap items-center gap-2 text-xs text-amber-800 dark:text-amber-400">
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
              disabled={ledgerBusy || parseDollarsToCents(ledgerDollars) === null}
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
                    setLedgerSave({ kind: "saving" });
                    try {
                      const result = await recordLedgerPayment({ personId, amount: cents });
                      // BOTH, and each does something the other cannot: the
                      // RETURNED refusal keeps the dialog open with the reason
                      // inside it, and `ledgerSave` keeps that reason beside
                      // this button after he cancels out of the dialog.
                      if (!result.ok) {
                        setLedgerSave({ kind: "err", message: `Not recorded: ${result.error}` });
                        return result.error;
                      }
                      setLedgerSave({
                        kind: "ok",
                        message: `Recorded ${formatMoney(cents)} against ${memberName}'s carried balance — ${formatMoney(result.data.remaining)} still carried. This cycle's weeks are untouched.`,
                      });
                      setLedgerDollars("");
                      router.refresh();
                      return null;
                    } catch {
                      // WITHOUT THIS the rejection escapes the dialog's
                      // handler: nothing clears "saving", so the dialog sits
                      // on "Working…" for good and no reason is ever shown.
                      const reason =
                        "Could not reach the server — the ledger payment was NOT recorded.";
                      setLedgerSave({ kind: "err", message: reason });
                      return reason;
                    }
                  },
                );
              }}
              className={buttonCls.secondary + " !px-2.5 !py-1.5 !text-xs"}
            >
              Record
            </button>
            {/* AT THE BUTTON THAT WAS PRESSED. This message used to render at
                the foot of the week list, past the whole table. */}
            <SaveFeedback state={ledgerSave} />
          </div>
        )}
      </div>

      {openEntry && (
        <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/40 dark:bg-indigo-950/20 p-4">
          {/* THE SHARED ENTRY (2.19). This was `AllocationEntry` — a THIRD
              payment route, alongside WeekActionPanel's own and the Patterns
              view's. The one-payment-route guard found it; nothing else could,
              because all three called `recordPayment` correctly. */}
          <PaymentEntry
            participationId={participationId}
            memberName={memberName}
            preselect={preselect}
            weeks={weeks.map((w) => ({
              weekNumber: w.weekNumber,
              amountDue: w.amountDue,
              amountPaid: w.amountAlreadyPaid,
              isSkipped: w.isSkipped,
              isDeferred: w.isDeferred,
            }))}
            onRecorded={() => {
              // THE PANEL STAYS OPEN, and that IS the fix.
              //
              // It used to close here. PaymentEntry already renders its own
              // confirmation under its own commit button — exactly where rule 6
              // wants it — and closing destroyed that element in the same
              // batched render, so it never painted. The replacement copy was
              // hoisted to a `saved` banner ~190 lines and a whole week table
              // away. The loss was noticed; the replacement was put somewhere
              // he was not looking.
              //
              // That message is the ONLY place the WhatsApp outcome appears
              // ("accepted by Twilio — delivery not yet confirmed"), so the
              // sentence most likely to matter was guaranteed to be off-screen.
              //
              // The far copy is now gone too: the message is not repeated
              // here, because the one that counts is already at the button.
              // Leaving the panel open also suits the job — recording several
              // weeks for one member is the common case, and he closes it
              // himself.
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
          {/* A DIV, not a span: the refusal beside it is a paragraph. */}
          <div className="flex flex-wrap items-center gap-1.5">
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
            {/* "That isn't a week range" belongs beside the box he typed it
                into, not at the bottom of the table (UI_STANDARDS 6b). */}
            <SaveFeedback state={rangeSave} />
          </div>
        </div>

        <ul className="divide-y divide-gray-100 dark:divide-gray-800/60 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
          {weeks.map((w) => {
            const s = statusOf(w);
            // A DEFERRED week is still owed, so it stays selectable — only a
            // SKIPPED week is off the books entirely (Aug 2026 ruling).
            const selectable = !w.isSkipped && w.amountAlreadyPaid < w.amountDue;
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
                  {/* THE AMOUNT for this week — the column that lets the
                      organizer add down the list and trust the total (2.1). */}
                  <span className="ml-auto tabular-nums font-semibold text-gray-900 dark:text-white">
                    {w.isSkipped ? (
                      <span className="font-normal text-gray-600 dark:text-gray-400">—</span>
                    ) : w.amountAlreadyPaid > 0 && remaining > 0 ? (
                      <>
                        {formatMoney(w.amountAlreadyPaid)}
                        <span className="font-normal text-gray-600 dark:text-gray-400">
                          {" "}
                          of {formatMoney(w.amountDue)}
                        </span>
                      </>
                    ) : w.amountAlreadyPaid > 0 ? (
                      formatMoney(w.amountAlreadyPaid)
                    ) : (
                      <span className="font-normal text-gray-600 dark:text-gray-400">
                        {formatMoney(w.amountDue)} due
                      </span>
                    )}
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
                {/* THE CONFIRMATION FOR THIS ROW, ON THIS ROW. A week panel's
                    result went to one banner at the foot of the list: for week
                    3 of 40 that is thirty-seven rows below the panel he was
                    working in, and the panel closes on save, so the screen he
                    was looking at simply went blank. */}
                {weekSave !== null && weekSave.weekNumber === w.weekNumber && (
                  <div className="px-3 pb-2">
                    <SaveFeedback state={weekSave.state} />
                  </div>
                )}
                {expanded && (
                  <div className="px-3 pb-3">
                    {/* The SAME per-week panel the payments Members list and
                        the Grid open — one way to do each thing (2.19). */}
                    <WeekActionPanel
                      key={`${participationId}-${w.weekNumber}`}
                      target={{
                        participationId,
                        memberName,
                        weekNumber: w.weekNumber,
                        amountDue: w.amountDue,
                        amountAlreadyPaid: w.amountAlreadyPaid,
                        isDeferred: w.isDeferred,
                      }}
                      onSaved={(msg) => {
                        setWeekSave({
                          weekNumber: w.weekNumber,
                          // SaveFeedback draws its own tick, so the panel's
                          // leading "✓ " would double up.
                          state: { kind: "ok", message: msg.replace(/^✓\s*/, "") },
                        });
                        setExpandedWeek(null); // the panel's snapshot is stale now
                        router.refresh();
                      }}
                      onClose={() => setExpandedWeek(null)}
                    />
                  </div>
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
          {/* ONE PAYMENT ROUTE (2.19). This was a second preview and a
              second commit — its own `handlePreview`/`handleCommit` calling
              `recordPayment` directly, beside PaymentEntry above and
              WeekActionPanel below. Three components building a payment is
              three places a partial-payment rule has to be fixed.
              The selection still does its job: it hands the ticked weeks to
              the shared entry, preselected.
              NOT A SaveButton, and not an exemption either: pressing this
              saves nothing. It opens the entry above with the ticked weeks
              filled in, and the confirmation for the money belongs to the
              commit button in there — which is where PaymentEntry draws it. */}
          <button
            type="button"
            onClick={() => {
              setPreselect([...selected].sort((a, b) => a - b));
              setOpenEntry(true);
              setSelected(new Set());
            }}
            disabled={amount < 1}
            title={amount < 1 ? "Tick the weeks to record first." : undefined}
            className={buttonCls.primary}
          >
            Record {formatMoney(amount)} for these weeks
          </button>
        </div>

        {/* THE TWO BANNERS THAT USED TO SIT HERE ARE GONE. Every message they
            carried now renders at the control that produced it: the ledger
            confirmation in the header strip, a week's confirmation on its own
            row, the range refusal beside the range box, and a recorded payment
            under PaymentEntry's own commit button. */}
      </div>

      <ConfirmDialog
        spec={confirm}
        error={dialogError}
        busy={ledgerBusy}
        onConfirm={() => onConfirm?.()}
        onCancel={() => {
          setDialogError(null);
          setConfirm(null);
          setOnConfirm(null);
        }}
      />
    </div>
  );
}
