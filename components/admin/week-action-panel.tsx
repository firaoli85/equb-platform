"use client";

import { useEffect, useState } from "react";
import { deletePaymentEvent, setWeekDeferral, setWeekLate, setWeekNote } from "@/app/actions/edits";
import type { ManualLateAdvice } from "@/lib/derived";
import { getCatchUpWeeks, getCellDetail } from "@/app/actions/payments-view";
import { PaymentEntry } from "@/components/admin/payment-entry";
import { ConfirmDialog, type ConfirmSpec } from "@/components/ui/confirm-dialog";
import { Alert, Pill, buttonCls, inputCls } from "@/components/ui/primitives";
import { SaveButton, SaveFeedback, type SaveState } from "@/components/ui/save-button";
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

const IDLE: SaveState = { kind: "idle" };

/**
 * WHICH CLUSTER OF CONTROLS A MESSAGE BELONGS TO.
 *
 * The panel's week actions are in two places with a tall `PaymentEntry`
 * between them: defer / mark-late in the header, and an Undo on every receipt
 * below the payment grid. One message rendered once would put the confirmation
 * for an Undo pressed at the bottom up in the header — the reported defect in
 * miniature (rule 6 beat 3). The slot says which cluster it is for; the other
 * renders nothing. It is still ONE state, so the two can never disagree.
 */
type ActionSlot = "week" | "receipt";

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
  /**
   * The panel's own week actions — defer, the late mark, undoing a receipt.
   * ONE state: "is it saving", "did it work" and "why not" are three readings
   * of the same fact, and as three variables they drifted (the old `busy` even
   * carried a "save" case nothing set any more).
   */
  const [save, setSave] = useState<{ slot: ActionSlot; state: SaveState }>({
    slot: "week",
    state: IDLE,
  });
  /** The note is the one control here with a Save button of its own. */
  const [noteSave, setNoteSave] = useState<SaveState>(IDLE);
  /**
   * NOT A SAVE. Failing to READ the week is a different sentence from failing
   * to write it, and it used to be printed as "Not recorded: …" — a save
   * refusal for something the organizer never asked to save.
   */
  const [loadError, setLoadError] = useState<string | null>(null);
  const busy = save.state.kind === "saving" || noteSave.kind === "saving";
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
      } else setLoadError(`This week could not be loaded: ${result.error}`);
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
        setLoadError(`Their weeks could not be loaded, so nothing can be recorded: ${result.error}`);
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

  /**
   * CONFIRM, RUN, AND REPORT — in one place, for all three week actions.
   *
   * `run` hands back the action's own result and decides nothing about where
   * the outcome is shown. It used to: two of the three callers wrote their
   * refusal into the panel's banner and returned nothing, which told this
   * helper the action had SUCCEEDED — so the dialog closed on a refusal, and
   * the reason surfaced in a banner above a payment grid rather than beside
   * the button that had just been pressed (UI_STANDARDS 6b). Reporting here is
   * the only shape in which the three cannot drift apart.
   */
  function ask(
    spec: ConfirmSpec,
    run: () => Promise<{ ok: boolean; error?: string }>,
    report: { slot: ActionSlot; okText: string; refusalLabel: string },
  ) {
    const set = (state: SaveState) => setSave({ slot: report.slot, state });
    setConfirm(spec);
    setDialogError(null);
    setOnConfirm(() => () => {
      void (async () => {
        set({ kind: "saving" });
        // THE DIALOG STAYS OPEN WITH THE REASON IN IT, and the panel keeps its
        // own copy so cancelling out of a refusal does not throw it away
        // either. Closing happens only on the success path below — never in a
        // `finally`, which runs on both.
        const refuse = (reason: string) => {
          setDialogError(reason);
          set({ kind: "err", message: `${report.refusalLabel}: ${reason}` });
        };
        try {
          const result = await run();
          if (!result.ok) {
            refuse(result.error ?? "Refused — nothing changed.");
            return;
          }
        } catch {
          // A THROW IS A REFUSAL WITH A REASON TOO. It used to escape this
          // helper entirely — the `finally` closed the dialog, the exception
          // went to the console, and the organizer saw the panel blink.
          refuse("Could not reach the server — nothing changed.");
          return;
        }
        set({ kind: "ok", message: report.okText });
        setConfirm(null);
        setOnConfirm(null);
        onSaved(`✓ ${report.okText}`);
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
      () =>
        setWeekLate({
          participationId: target.participationId,
          weekNumber: target.weekNumber,
          late: next,
        }),
      {
        slot: "week",
        okText: next
          ? `Week ${target.weekNumber} marked late for ${target.memberName} — a late notice can be sent now.`
          : `The late mark on week ${target.weekNumber} was removed — the calendar decides again.`,
        refusalLabel: next
          ? `Week ${target.weekNumber} was NOT marked late`
          : `The late mark on week ${target.weekNumber} was NOT removed`,
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
      () =>
        setWeekDeferral({
          participationId: target.participationId,
          weekNumber: target.weekNumber,
          deferred: next,
        }),
      {
        slot: "week",
        okText: next
          ? `Week ${target.weekNumber} deferred for ${target.memberName} — still owed, no longer chased.`
          : `Deferral removed — week ${target.weekNumber} is chased again for ${target.memberName}.`,
        refusalLabel: next
          ? `Week ${target.weekNumber} was NOT deferred`
          : `The deferral on week ${target.weekNumber} was NOT removed`,
      },
    );
  }

  // THE NOTE IS THE ONE CONTROL HERE THAT IS NOT A CONFIRMATION. It has its
  // own button, so it gets its own `SaveButton` and its own state — the same
  // message, rendered at the only control it describes.
  async function saveNote() {
    if (detail === null || note === detail.note) return;
    setNoteSave({ kind: "saving" });
    try {
      const result = await setWeekNote({
        participationId: target.participationId,
        weekNumber: target.weekNumber,
        note,
      });
      if (!result.ok) {
        setNoteSave({ kind: "err", message: `Not saved: ${result.error}` });
        return;
      }
      const trimmed = note.trim();
      const message = trimmed
        ? `Saved — the note on week ${target.weekNumber} now reads “${trimmed}”.`
        : `Saved — the note on week ${target.weekNumber} is now empty.`;
      setNoteSave({ kind: "ok", message });
      // WHAT WAS SAVED IS NOW THE BASELINE, so the button goes dead until the
      // text changes again (beat 1). Without this it stays live over text the
      // server already holds, and pressing it saves nothing twice.
      setDetail((d) => (d && d.key === detailKey ? { ...d, note } : d));
      onSaved(`✓ ${message}`);
    } catch {
      setNoteSave({
        kind: "err",
        message: "Could not reach the server — the note was not saved.",
      });
    }
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
                disabled={busy || (!detail.markedLate && detail.lateAdvice.kind === "deferred")}
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
            disabled={busy || !detail || detail.weekIsSkipped}
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

      {/* A READ THAT FAILED, SAID AS A READ. This banner used to print every
          message as "Not recorded: …", so a week that could not be LOADED
          read as a save the organizer had never asked for. */}
      {loadError && <Alert kind="err">{loadError}</Alert>}

      {/* THE HEADER ACTIONS' OWN FEEDBACK, DIRECTLY UNDER THEM (rule 6 beat 3
          and 4). Deferring and marking late used to say nothing here at all:
          the message went to the host, which drew it at the top of a 27×20
          grid or of a long member page, nowhere near the cell he clicked. */}
      <SaveFeedback state={save.slot === "week" ? save.state : IDLE} />

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
          // NO ECHO HERE. `PaymentEntry` carries its own `SaveButton`, which
          // renders the receipt line beside the Record button inside this
          // panel — the panel used to copy that same message into a second
          // green paragraph at the top of itself, giving one save two
          // confirmations and two `save-ok` nodes.
          onRecorded={(message) => {
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
                  disabled={busy}
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
                      () => deletePaymentEvent({ eventId: r.eventId }),
                      {
                        slot: "receipt",
                        okText: `Undone — the ${formatMoney(r.eventAmount)} receipt from ${target.memberName} was deleted and their weeks recalculated.`,
                        refusalLabel: `The ${formatMoney(r.eventAmount)} receipt was NOT undone`,
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
        {/* UNDER THE UNDO BUTTONS, not up in the header. The payment grid sits
            between the two, so a receipt undone from down here would otherwise
            confirm itself off the top of the panel. */}
        <SaveFeedback state={save.slot === "receipt" ? save.state : IDLE} className="mt-2" />
      </div>

      {/* ————— Note on the week —————
          A FORM, because this is a text field: Enter is how anyone finishes
          typing, and the SaveButton press is the same submit. */}
      <form
        // WRAPPING, because the confirmation renders beside the button. A
        // one-line row would squeeze the note field to nothing the moment a
        // sentence appears next to "Save note"; here the button and its
        // message drop to their own line instead.
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void saveNote();
        }}
      >
        <label className="grow basis-64">
          <span className="mb-1 block text-xs font-semibold text-gray-600 dark:text-gray-400">
            Note on week {target.weekNumber}
          </span>
          <input
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              // A confirmation for the previous text must not sit beside text
              // that no longer matches it.
              setNoteSave(IDLE);
            }}
            className={`${inputCls} text-xs`}
          />
        </label>
        {/* The note's own button, so the note's own confirmation renders here
            rather than in a banner the whole panel shares. */}
        <SaveButton
          state={noteSave}
          onSave={() => void saveNote()}
          onStateSettled={() => setNoteSave(IDLE)}
          label="Save note"
          savingLabel="Saving…"
          tone="secondary"
          disabled={detail === null || busy}
          dirty={note !== (detail?.note ?? "")}
          notDirtyHint="The note has not changed."
          className="pb-0.5"
        />
      </form>

      <ConfirmDialog
        spec={confirm}
        error={dialogError}
        // The dialog is working when ITS action is — derived from the one save
        // state rather than from a second boolean that could disagree with it.
        busy={save.state.kind === "saving"}
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
