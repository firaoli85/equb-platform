"use client";

import { useEffect, useState } from "react";
import { deletePaymentEvent, setWeekDeferral, setWeekLate, setWeekNote } from "@/app/actions/edits";
import type { ManualLateAdvice } from "@/lib/derived";
import { getCatchUpWeeks, getCellDetail } from "@/app/actions/payments-view";
import { PaymentEntry } from "@/components/admin/payment-entry";
import { ConfirmDialog, type ConfirmSpec } from "@/components/ui/confirm-dialog";
import { Alert, buttonCls, Pill } from "@/components/ui/primitives";
import { formatDateUTC, formatMoney } from "@/lib/format";
import type { PickableWeek } from "@/lib/week-picking";
import { DEFERRED_PHRASE, SKIPPED_PHRASE } from "@/lib/status-labels";

// THE one per-week action panel (2.19: one way to do each thing). Used by the
// payments Members view, the payments Grid, and the member profile — so
// "record", "partial", "defer", "undo" behave identically everywhere.
//
// RECORDING MONEY IS NOT DONE HERE ANY MORE. This panel used to carry its own
// amount field, its own preview and its own commit — a second payment route
// beside the one the Patterns view uses, and two routes to one action is
// exactly what 2.19 forbids. It is how the two drift: a partial-payment rule
// fixed in one would never reach the other.
//
// The payment part is now `PaymentEntry`, embedded with the clicked week
// ticked, so all three views share it. This panel keeps what is genuinely
// PER-WEEK: deferral, the week note, and undoing a receipt.

export type WeekTarget = {
  participationId: string;
  memberName: string;
  weekNumber: number;
  amountDue: number;
  amountAlreadyPaid: number;
  isDeferred: boolean;
};

type Detail = {
  isDeferred: boolean;
  /** The organizer marked this week late himself (2.2). */
  markedLate: boolean;
  markedLateNote: string;
  /** Whether marking is possible now, and what to say about it first. */
  lateAdvice: ManualLateAdvice;
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

export function WeekActionPanel({
  target,
  onSaved,
  onClose,
}: {
  target: WeekTarget;
  /** Fires after any successful change — the host refreshes and shows this. */
  onSaved: (message: string) => void;
  onClose: () => void;
}) {
  /** What this week still needs — the header pill only. */
  const remaining = Math.max(0, target.amountDue - target.amountAlreadyPaid);

  const [loadedDetail, setDetail] = useState<(Detail & { key: string }) | null>(null);
  const [note, setNote] = useState("");
  /** Their whole window — PaymentEntry works across weeks, not just this one. */
  const [loadedWeeks, setLoadedWeeks] = useState<{ key: string; weeks: PickableWeek[] } | null>(
    null,
  );
  const [busy, setBusy] = useState<"save" | "week" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  /**
   * A refusal from the action the dialog just ran. Set it and the dialog stays
   * open with the reason inside, beside the button that caused it — never only
   * in a banner elsewhere on the page (UI_STANDARDS 6b).
   */
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [onConfirm, setOnConfirm] = useState<(() => void) | null>(null);

  // Re-fetched after a save so the squares show the money that just landed.
  const [keyNonce, setKeyNonce] = useState(0);

  // What each fetch is FOR. Data whose key does not match is another cell's,
  // and reads as not-loaded rather than being shown.
  const detailKey = `${target.participationId}:${target.weekNumber}:${keyNonce}`;
  const weeksKey = `${target.participationId}:${keyNonce}`;
  const detail = loadedDetail?.key === detailKey ? loadedDetail : null;
  const memberWeeks = loadedWeeks?.key === weeksKey ? loadedWeeks.weeks : null;

  // LOADED DATA CARRIES THE KEY IT WAS LOADED FOR.
  //
  // Both of these effects used to begin `setX(null)` to clear the previous
  // member's data — a synchronous setState inside an effect, which
  // `react-hooks/set-state-in-effect` flags as a cascading render. Stamping
  // the key onto the value instead means staleness is DERIVED: nothing is
  // reset, and another member's weeks can never show for even one frame,
  // which on a money screen matters more than the lint rule that found it.
  useEffect(() => {
    let cancelled = false;
    getCellDetail({
      participationId: target.participationId,
      weekNumber: target.weekNumber,
    }).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setDetail({ ...result.data, key: detailKey });
        setNote(result.data.note);
      } else setError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [target.participationId, target.weekNumber, keyNonce, detailKey]);

  // THEIR WHOLE WINDOW, for the shared entry. The panel is opened from ONE
  // cell, but recording is not a per-cell act — "$2,000, that's four weeks"
  // is the common case, and it was impossible from here.
  useEffect(() => {
    let cancelled = false;
    getCatchUpWeeks(target.participationId).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setLoadedWeeks({
        key: weeksKey,
        weeks: result.data.weeks.map((w) => ({
          weekNumber: w.weekNumber,
          amountDue: w.amountDue,
          amountPaid: w.amountAlreadyPaid,
          isSkipped: w.isSkipped,
          isDeferred: w.isDeferred,
        })),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [target.participationId, keyNonce, weeksKey]);

  /** `fn` returns its refusal, or nothing on success (UI_STANDARDS 6b). */
  function ask(spec: ConfirmSpec, fn: () => Promise<string | null | void>) {
    setConfirm(spec);
    setOnConfirm(() => () => {
      void (async () => {
        setBusy("week");
        let refused: string | null = null;
        try {
          const reported = await fn();
          if (typeof reported === "string" && reported.length > 0) refused = reported;
        } finally {
          setBusy(null);
          // CLOSE ONLY ON SUCCESS. This used to close whatever happened, so a
          // refusal was thrown away with the dialog that could have shown it
          // (UI_STANDARDS 6b).
          if (refused === null) {
            setConfirm(null);
            setOnConfirm(null);
          } else {
            setDialogError(refused);
          }
        }
      })();
    });
  }

  // MARK THIS WEEK LATE — the organizer's own call (2.2).
  //
  // LATE is otherwise pure calendar, which made him wait until Thursday to
  // record what a member told him on Monday. The three shapes of this control
  // are decided by `manualLateAdvice` on the SERVER's clock:
  //
  //   already-late — the button is not offered at all. The week reads LATE by
  //                  itself; a control that changes nothing is worse than none.
  //   current      — the ordinary case. Confirmed like any money-adjacent
  //                  change, with no warning, because there is nothing unusual
  //                  to warn about.
  //   future       — the week has not started. It WARNS and proceeds. Never
  //                  blocked: he has reasons the system does not know.
  function toggleMarkedLate() {
    if (!detail) return;
    const next = !detail.markedLate;
    const advice = detail.lateAdvice;
    ask(
      {
        title: next
          ? `Mark week ${target.weekNumber} late for ${target.memberName}?`
          : `Remove the late mark on week ${target.weekNumber}?`,
        destructive: false,
        // A week that has not started is the one case worth stopping on. The
        // dialog's own `consequence` slot is where an unusual choice is stated
        // plainly, and it still confirms rather than refusing.
        consequence: next && advice.kind === "future" ? advice.message : undefined,
        body: next ? (
          <>
            <p>
              Week {target.weekNumber} will read <strong>LATE</strong> from now, without waiting
              for its payment window to close. {target.memberName} joins the chasing list and a
              late notice becomes sendable to them immediately.
            </p>
            <p>
              The {formatMoney(target.amountDue)} was always owed — this changes WHEN the system
              agrees it is late, nothing about the money. Recording a payment for this week
              clears the mark by itself, and you can remove it here at any time.
            </p>
          </>
        ) : (
          <>
            <p>
              Week {target.weekNumber} goes back to the calendar&apos;s rule: late only once its
              payment window has closed. {target.memberName} leaves the chasing list unless they
              are behind on some other week.
            </p>
            <p>An audit entry records the decision.</p>
          </>
        ),
        confirmLabel: next ? `Mark week ${target.weekNumber} late` : "Remove the mark",
      },
      async () => {
        const result = await setWeekLate({
          participationId: target.participationId,
          weekNumber: target.weekNumber,
          late: next,
        });
        if (!result.ok) return result.error;
        onSaved(
          next
            ? `✓ Week ${target.weekNumber} marked late for ${target.memberName} — a late notice can be sent now.`
            : `✓ The late mark on week ${target.weekNumber} was removed.`,
        );
      },
    );
  }

  function toggleDeferral() {
    if (!detail) return;
    const next = !detail.isDeferred;
    ask(
      {
        title: next
          ? `Defer week ${target.weekNumber} for ${target.memberName}?`
          : `Remove the deferral on week ${target.weekNumber}?`,
        destructive: false,
        body: next ? (
          <>
            <p>
              <strong>Deferring does not cancel the debt.</strong> {target.memberName} still owes{" "}
              {formatMoney(target.amountDue)} for week {target.weekNumber}; it still counts in
              their overdue total and their weeks behind. What changes is that the week
              stops reading LATE and they drop out of the chasing messages.
            </p>
            <p>An audit entry records the decision.</p>
          </>
        ) : (
          <>
            <p>
              Week {target.weekNumber} goes back to being chased. The {formatMoney(target.amountDue)}{" "}
              was owed all along — this only lets it read LATE again and puts{" "}
              {target.memberName} back in the reminders.
            </p>
            <p>An audit entry records the decision.</p>
          </>
        ),
        confirmLabel: next ? `Defer week ${target.weekNumber}` : "Chase it again",
      },
      async () => {
        const result = await setWeekDeferral({
          participationId: target.participationId,
          weekNumber: target.weekNumber,
          deferred: next,
        });
        if (!result.ok) setError(result.error);
        else
          onSaved(
            next
              ? `✓ Week ${target.weekNumber} deferred — not chased, still owed.`
              : `✓ Deferral removed — week ${target.weekNumber} is chased again.`,
          );
      },
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border-2 border-indigo-300 dark:border-indigo-800 bg-white dark:bg-[#141414] p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-black text-gray-900 dark:text-white">
          {target.memberName} — week {target.weekNumber}
        </h3>
        {detail?.weekIsSkipped ? (
          <Pill tone="neutral">{SKIPPED_PHRASE}</Pill>
        ) : remaining > 0 ? (
          <>
            <Pill tone="attention">{formatMoney(remaining)} still due</Pill>
            {detail?.markedLate && <Pill tone="attention">Marked late by you</Pill>}
            {detail?.isDeferred && <Pill tone="attention">{DEFERRED_PHRASE}</Pill>}
          </>
        ) : (
          <Pill tone="good">Settled</Pill>
        )}
        <span className="ml-auto flex flex-wrap gap-2">
          {/* NOT OFFERED WHEN IT WOULD DO NOTHING. A week whose window has
              closed already reads LATE; the only reason to show the control
              then is to let him UNDO a mark he made earlier. */}
          {detail && !detail.weekIsSkipped &&
            (detail.markedLate || detail.lateAdvice.kind !== "already-late") && (
              <button
                type="button"
                onClick={toggleMarkedLate}
                // DEFERRED IS DISABLED, NOT HIDDEN, and it says why.
                //
                // Hiding it would leave the organizer looking for a control he
                // used yesterday with no explanation. Deferral beats the mark
                // (ruling, Aug 2026), so the button stays where he expects it,
                // dead, carrying the sentence that names the way out — the
                // same rule as every other refusal: at the control that was
                // pressed (UI_STANDARDS 6b).
                disabled={busy !== null || (!detail.markedLate && detail.lateAdvice.kind === "deferred")}
                data-testid="mark-late"
                title={
                  detail.markedLate
                    ? "Go back to the calendar's rule for this week"
                    : (detail.lateAdvice.message ??
                      "Mark this week late now, without waiting for its window to close")
                }
                className={buttonCls.secondary + " !px-3 !py-1.5 !text-xs"}
              >
                {detail.markedLate ? "Remove late mark" : "Mark late"}
              </button>
            )}
          <button
            type="button"
            onClick={toggleDeferral}
            disabled={busy !== null || !detail || detail.weekIsSkipped}
            title={
              detail?.weekIsSkipped
                ? "The whole week is skipped for everyone — edit it on the Weeks page"
                : undefined
            }
            className={buttonCls.secondary + " !px-3 !py-1.5 !text-xs"}
          >
            {detail?.isDeferred ? "Remove deferral" : "Mark deferred"}
          </button>
          <button type="button" onClick={onClose} className={buttonCls.ghost + " !text-xs"}>
            Close
          </button>
        </span>
      </div>

      {/* THE DEAD BUTTON'S REASON, VISIBLE. A `title` is a hover, and the
          organizer reaching for "Mark late" on a deferred week needs the
          sentence whether or not he hovers — it names the one thing that makes
          the control work again. */}
      {detail?.lateAdvice.kind === "deferred" && !detail.markedLate && (
        <p
          data-testid="deferred-beats-mark"
          className="rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-700 dark:bg-white/5 dark:text-gray-300"
        >
          {detail.lateAdvice.message}
        </p>
      )}

      {error && <Alert kind="err">Not recorded: {error}</Alert>}
      {/* THE CONFIRMATION FOR THIS PANEL, INSIDE IT (§2.10, rule 6 beat 3).
          `ok` already existed and only ever carried "Note saved."; a recorded
          PAYMENT went straight to the host, which closed the panel and drew
          the message at the top of its own screen — the top of a 27×20 grid,
          or of a long member page. The cell he clicked was nowhere near it. */}
      {ok && (
        <p
          role="status"
          data-testid="save-ok"
          className="rounded-xl bg-emerald-50 px-3.5 py-2.5 text-sm font-semibold text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
        >
          ✓ {ok.replace(/^✓\s*/, "")}
        </p>
      )}

      {/* ————— RECORDING MONEY IS ONE INTERACTION, EVERYWHERE (2.19) —————
          This panel had its own amount field, its own preview and its own
          commit — a second payment route beside the one the Patterns view
          uses. Two routes to one action is exactly what 2.19 forbids, and it
          is how the two drift: a partial-payment rule fixed here would not
          reach there.
          `PaymentEntry` is now the only one. The clicked week arrives ticked,
          and everything else it offers — sweeping a run, the quick amounts,
          the live remainder — comes with it. */}
      {!detail?.weekIsSkipped && memberWeeks !== null && (
        <PaymentEntry
          participationId={target.participationId}
          memberName={target.memberName}
          weeks={memberWeeks}
          preselect={[target.weekNumber]}
          onRecorded={(message) => {
            setOk(message.replace(/^✓\s*/, ""));
            onSaved(message);
            setKeyNonce((n) => n + 1);
          }}
        />
      )}
      {!detail?.weekIsSkipped && memberWeeks === null && (
        <p className="text-xs text-gray-500 dark:text-gray-400">Loading their weeks…</p>
      )}

      {/* ————— Receipts on this week, each undoable ————— */}
      <div>
        <p className="mb-1 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
          Receipts on this week ({detail?.receipts.length ?? "…"})
        </p>
        {detail === null ? (
          <p className="text-xs text-gray-500 dark:text-gray-400">Loading…</p>
        ) : detail.receipts.length === 0 ? (
          <p className="text-xs text-gray-500 dark:text-gray-400">None yet.</p>
        ) : (
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
                  disabled={busy !== null}
                  onClick={() =>
                    ask(
                      {
                        title: `Undo this ${formatMoney(r.eventAmount)} receipt from ${target.memberName}?`,
                        body: (
                          <>
                            {r.appliedHere < r.eventAmount ? (
                              <p>
                                Only {formatMoney(r.appliedHere)} of it sits on week{" "}
                                {target.weekNumber} — the WHOLE receipt is deleted and every week
                                recalculates.
                              </p>
                            ) : (
                              <p>
                                The receipt is deleted and week {target.weekNumber} recalculates.
                              </p>
                            )}
                            <p>
                              Their standing and the cash position recalculate immediately. An
                              audit entry records what was removed.
                            </p>
                          </>
                        ),
                        confirmLabel: "Undo receipt",
                      },
                      async () => {
                        const result = await deletePaymentEvent({ eventId: r.eventId });
                        if (!result.ok) setError(result.error);
                        else
                          onSaved(
                            `✓ Undone — ${formatMoney(r.eventAmount)} receipt deleted and weeks recalculated.`,
                          );
                      },
                    )
                  }
                  className={buttonCls.danger + " !px-2 !py-0.5 !text-xs"}
                >
                  Undo
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ————— Note on the week ————— */}
      <div className="flex items-end gap-2">
        <label className="grow">
          <span className="mb-1 block text-xs font-semibold text-gray-600 dark:text-gray-400">
            Note on week {target.weekNumber}
          </span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1a1a1a] px-2.5 py-1.5 text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
          />
        </label>
        <button
          type="button"
          disabled={busy !== null || detail === null || note === (detail?.note ?? "")}
          onClick={() => {
            void (async () => {
              setBusy("week");
              const result = await setWeekNote({
                participationId: target.participationId,
                weekNumber: target.weekNumber,
                note,
              });
              setBusy(null);
              if (!result.ok) setError(result.error);
              else {
                setOk("✓ Note saved.");
                onSaved("✓ Note saved.");
              }
            })();
          }}
          className={buttonCls.secondary + " !px-3 !py-1.5 !text-xs"}
        >
          Save note
        </button>
      </div>

      <ConfirmDialog
        spec={confirm}
        error={dialogError}
        busy={busy === "week"}
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
