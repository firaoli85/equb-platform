"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  closeParticipation,
  previewParticipationClose,
  reactivateParticipation,
} from "@/app/actions/participation-close";
import { CLOSE_REASONS, type CloseReason } from "@/lib/participation-close";
import { Alert, buttonCls, inputCls } from "@/components/ui/primitives";
import { SaveButton, SaveFeedback, type SaveState } from "@/components/ui/save-button";
import { formatMoney } from "@/lib/format";

// SOMEONE HAS STOPPED, AND THE BOOKS SHOULD SAY SO (2.18).
//
// The organizer had two tools and neither fitted. "Remove from cycle" deletes
// them; leaving them alone keeps counting money that will never arrive. So the
// position was inflated by exactly the amount he most needed to see.
//
// THIS IS NOT A DANGER-ZONE BUTTON. It destroys nothing: every receipt stays,
// the portal stays, and it is reversible while the cycle is open. It is styled
// as the ordinary, correct thing to do when a member stops — because it is —
// and it sits ABOVE the removal panel for the same reason.
//
// The typed name is still required. It ends what a real person is expected to
// pay and writes a balance onto their record, and 2.23 says a decision like
// that is made deliberately, with every consequence in real figures first.

type Plan = {
  memberName: string;
  cycleName: string;
  closingAtWeek: number;
  weeksLeaving: number;
  amountLeaving: number;
  balanceToRecord: number;
  numbersLeavingPool: number[];
  alreadyPaidOut: number;
  shortfallToCover: number;
};

type Preview = {
  plan: Plan;
  consequences: string[];
  currentWeek: number;
  finishWeek: number;
  confirmPhrase: string;
};

export function CloseParticipation({
  participationId,
  personName,
  cycleName,
  /** Already stopped — this panel offers the way back instead. */
  closed,
}: {
  participationId: string;
  personName: string;
  cycleName: string;
  closed: { atWeek: number | null; reason: string | null; note: string | null } | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [week, setWeek] = useState<string>("");
  const [reason, setReason] = useState<CloseReason | "">("");
  const [note, setNote] = useState("");
  const [typed, setTyped] = useState("");
  /**
   * ONE STATE FOR BOTH WRITES — the close and the way back (UI_STANDARDS
   * rule 6).
   *
   * It was a `msg` banner at the TOP of this panel plus a second copy of the
   * refusal near the button, and a `pending` boolean for the same fact as
   * "saving". The panel is tall — the week field, the consequence list, four
   * reason radios and the typed-name box sit between the top and the button —
   * so the banner was the off-screen message rule 6 exists for, and the
   * duplicate could disagree with it. `busy` is DERIVED from this state, so
   * there is no second copy to fall out of step.
   */
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  /**
   * Working out the consequences is not a save, so it does not belong in the
   * save state: its failure belongs where the FIGURES would have been, and it
   * must never look like a refusal from a button nobody has pressed.
   */
  const [loadError, setLoadError] = useState<string | null>(null);
  /**
   * The writes still run inside a transition, so the `router.refresh()` that
   * follows stays non-urgent. Its pending flag is deliberately not taken —
   * `busy` below is the ONE name for "a write is in flight".
   */
  const [, startWrite] = useTransition();
  const [loading, startLoad] = useTransition();
  const busy = save.kind === "saving";

  const weekNum = Number.parseInt(week, 10);
  const weekValid = Number.isSafeInteger(weekNum) && weekNum >= 1;

  // The preview is re-fetched whenever the closing week changes, because every
  // figure in it depends on that week. A confirmation showing last week's
  // numbers under this week's choice is worse than showing none.
  useEffect(() => {
    if (!open || closed) return;
    startLoad(async () => {
      const result = await previewParticipationClose({
        participationId,
        ...(weekValid ? { closingAtWeek: weekNum } : {}),
      });
      if (!result.ok) {
        setLoadError(result.error);
        setPreview(null);
        return;
      }
      setLoadError(null);
      setPreview(result.data as Preview);
      setWeek((w) => (w === "" ? String((result.data as Preview).plan.closingAtWeek) : w));
    });
  }, [open, closed, participationId, weekValid, weekNum]);

  const nameOk = typed.trim().toLowerCase() === personName.trim().toLowerCase();
  const noteNeeded = reason === "OTHER" && note.trim() === "";
  const canClose = Boolean(preview) && reason !== "" && !noteNeeded && nameOk && weekValid;
  // A dead button with no explanation reads as a broken app. This says which
  // of the four things is still missing, on hover, in that order.
  const notReadyHint = !weekValid
    ? "Enter the last week they were part of."
    : !preview
      ? "Still working out what this changes."
      : reason === ""
        ? "Choose why they stopped — it goes on the record."
        : noteNeeded
          ? "Add the short factual note."
          : `Type ${personName} to confirm.`;

  // ————————————————— The two writes —————————————————

  function handleReactivate() {
    startWrite(async () => {
      setSave({ kind: "saving" });
      try {
        const result = await reactivateParticipation({ participationId });
        if (!result.ok) {
          setSave({ kind: "err", message: `Not reopened: ${result.error}` });
          return;
        }
        // WHAT CAME BACK, IN FIGURES. Reactivating is forward-only (2.18) and
        // the organizer reads this to check the restart week is the one he
        // meant — not to be told that something unspecified worked.
        const p = result.data.plan;
        setSave({
          kind: "ok",
          message:
            (p.weeksReturning > 0
              ? `${p.memberName} is expected again from week ${p.fromWeek} — ` +
                `${p.weeksReturning} week${p.weeksReturning === 1 ? "" : "s"}, ` +
                `${formatMoney(p.amountReturning)}.`
              : `${p.memberName} is contributing again, but their commitment had already run ` +
                `out — no weeks come back.`) +
            (p.weeksStayingClosed > 0
              ? ` The ${p.weeksStayingClosed} week${p.weeksStayingClosed === 1 ? "" : "s"} they ` +
                `were away stay closed.`
              : "") +
            (p.numbersReturningToPool.length > 0
              ? ` ${p.numbersReturningToPool.map((n) => `#${n}`).join(", ")} back on the wheel.`
              : ""),
        });
        router.refresh();
      } catch {
        // A thrown call used to leave the button un-busy with nothing said —
        // the organizer's "it did nothing" with no reason to quote (6b).
        setSave({
          kind: "err",
          message: "Could not reach the server — nothing was changed.",
        });
      }
    });
  }

  function handleClose() {
    if (reason === "") return;
    startWrite(async () => {
      setSave({ kind: "saving" });
      try {
        const result = await closeParticipation({
          participationId,
          closingAtWeek: weekNum,
          reason,
          note: note.trim() || undefined,
          typedName: typed,
        });
        if (!result.ok) {
          // THE PANEL STAYS OPEN holding the reason, with the week, the
          // reason and the typed name all still in place to retry. A refusal
          // thrown away with the panel is UI_STANDARDS 6b's exact failure.
          setSave({ kind: "err", message: `Not recorded: ${result.error}` });
          return;
        }
        // THE FIGURES HE JUST COMMITTED TO, read back. This ends what a real
        // person is expected to pay and writes a balance onto their record —
        // "Saved." would leave him checking all of it himself.
        const p = result.data.plan;
        setSave({
          kind: "ok",
          message:
            `${p.memberName} stopped at week ${p.closingAtWeek} in ${p.cycleName} — ` +
            (p.weeksLeaving > 0
              ? `${p.weeksLeaving} week${p.weeksLeaving === 1 ? "" : "s"}, ` +
                `${formatMoney(p.amountLeaving)}, no longer expected.`
              : `week ${p.closingAtWeek} was already their last, so nothing stops being expected.`) +
            (p.balanceToRecord > 0
              ? ` ${formatMoney(p.balanceToRecord)} unpaid up to then is now on their own record.`
              : ` They were paid up, so nothing went onto their record.`) +
            (p.numbersLeavingPool.length > 0
              ? ` ${p.numbersLeavingPool.map((n) => `#${n}`).join(", ")} left the wheel.`
              : "") +
            (p.shortfallToCover > 0
              ? ` ${formatMoney(p.shortfallToCover)} of it is yours to cover.`
              : ""),
        });
        // CLOSE ONLY ON SUCCESS.
        setOpen(false);
        router.refresh();
      } catch {
        setSave({
          kind: "err",
          message: "Could not reach the server — nothing was recorded.",
        });
      }
    });
  }

  // ————————————————— Already stopped: the way back —————————————————

  if (closed) {
    const reasonLabel = CLOSE_REASONS.find((r) => r.key === closed.reason)?.label ?? closed.reason;
    return (
      <div className="space-y-3 rounded-2xl border-2 border-amber-300 bg-amber-50/60 p-4 dark:border-amber-800 dark:bg-amber-950/20">
        <div>
          <h3 className="text-sm font-black text-gray-900 dark:text-white">
            {personName} stopped
            {closed.atWeek !== null ? ` at week ${closed.atWeek}` : ""} in {cycleName}
          </h3>
          <p className="mt-1 text-xs text-gray-700 dark:text-gray-300">
            {reasonLabel ? <>Recorded as: {reasonLabel}. </> : null}
            {closed.note ? <>{closed.note} </> : null}
            Nothing further is expected from them, and everything they paid stays exactly as
            recorded. They keep their portal, read-only, showing where they stopped.
          </p>
        </div>
        {/* The confirmation for the close that led here lands on this panel
            too: the same `save` state survives the switch from the close flow
            to this branch, so the message is never dropped by the re-render.
            Beat 3 and beat 4 both render AT this button (rule 6). */}
        <SaveButton
          state={save}
          onSave={handleReactivate}
          onStateSettled={() => setSave({ kind: "idle" })}
          label="They are contributing again"
          savingLabel="Bringing them back…"
          tone="secondary"
        />
        <p className="text-xs text-gray-600 dark:text-gray-400">
          Restores their weeks from this week forward, never backwards — the weeks they were away
          stay closed, because nothing was expected from them then. Possible only while {cycleName}{" "}
          is open.
        </p>
      </div>
    );
  }

  // ————————————————— Still contributing: the close flow —————————————————

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            // A freshly opened panel carries no refusal from a previous
            // attempt — it would sit beside a button nobody has pressed yet.
            setSave({ kind: "idle" });
            setOpen(true);
          }}
          className={buttonCls.secondary + " !text-xs"}
        >
          {personName} has stopped contributing
        </button>
        {/* A successful close COLLAPSES the panel, so a confirmation living
            inside it would go with it — for the moment before the refresh
            lands and this becomes the "stopped" panel, it is read here. */}
        <SaveFeedback state={save} />
      </div>
    );
  }

  const plan = preview?.plan ?? null;

  return (
    <div className="space-y-3 rounded-2xl border-2 border-gray-300 p-4 dark:border-gray-700">
      <div>
        <h3 className="text-sm font-black text-gray-900 dark:text-white">
          Record that {personName} has stopped
        </h3>
        <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
          Nothing is deleted. Their remaining weeks stop being counted as money that is coming, so
          the cycle position tells the truth.
        </p>
      </div>

      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400">
          Last week they were part of
        </span>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          value={week}
          onChange={(e) => setWeek(e.target.value)}
          className={inputCls + " max-w-32 tabular-nums"}
        />
        <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
          Weeks up to and including this one still count. Everything after it stops being expected.
        </span>
      </label>

      {/* A preview that FAILED is not "still loading", and it is not a refusal
          from the button either — the reason goes where the figures would have
          been. */}
      {loadError !== null ? (
        <Alert kind="err">Could not work out what this changes: {loadError}</Alert>
      ) : loading && !plan ? (
        <p className="text-xs text-gray-600 dark:text-gray-400">Working out what this changes…</p>
      ) : null}

      {/* WHAT HAPPENS, IN REAL FIGURES — before the reason, before the name. */}
      {plan && (
        <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-3 dark:border-gray-800 dark:bg-white/[0.02]">
          <p className="mb-1.5 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
            What this changes
          </p>
          <ul className="space-y-1.5 text-xs text-gray-800 dark:text-gray-200">
            {(preview?.consequences ?? []).map((line) => (
              <li key={line} className="flex gap-2">
                <span aria-hidden="true" className="text-gray-400 dark:text-gray-500">
                  •
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
          {/* The case that decides the arithmetic gets its own treatment: it
              is the only line here that costs the organizer money. */}
          {plan.shortfallToCover > 0 && (
            <p className="mt-2.5 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              {formatMoney(plan.shortfallToCover)} of this is yours to cover — they were already
              paid {formatMoney(plan.alreadyPaidOut)} and that money is gone.
            </p>
          )}
        </div>
      )}

      {/* THE REASON — a fixed neutral list. Never a free-text field about a
          person, because it outlives the cycle in the archive. */}
      <fieldset>
        <legend className="mb-1.5 text-xs font-semibold text-gray-600 dark:text-gray-400">
          Why (goes on the record)
        </legend>
        <div className="space-y-1.5">
          {CLOSE_REASONS.map((r) => (
            <label
              key={r.key}
              className={`flex cursor-pointer items-start gap-2.5 rounded-xl border-2 px-3 py-2 transition-colors ${
                reason === r.key
                  ? "border-indigo-400 bg-indigo-50/50 dark:border-indigo-700 dark:bg-indigo-950/20"
                  : "border-gray-200 hover:border-gray-300 dark:border-gray-800 dark:hover:border-gray-700"
              }`}
            >
              <input
                type="radio"
                name="close-reason"
                value={r.key}
                checked={reason === r.key}
                onChange={() => setReason(r.key)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-indigo-600"
              />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-gray-900 dark:text-white">
                  {r.label}
                </span>
                <span className="block text-xs text-gray-600 dark:text-gray-400">{r.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {reason === "OTHER" && (
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400">
            A short factual note
          </span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="About the arrangement, not the person."
            className={inputCls}
          />
        </label>
      )}

      {reason !== "" && !noteNeeded && (
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400">
            Type{" "}
            <strong className="select-all text-gray-900 dark:text-white">{personName}</strong> to
            confirm
          </span>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className={inputCls}
          />
        </label>
      )}

      {/* THE FEEDBACK IS PART OF THE BUTTON. It used to be a banner at the top
          of this panel with a second copy down here — and the panel is tall:
          the week field, the consequence list, four reason radios and the
          typed-name box all sit between them. `SaveButton` renders both the
          refusal and the confirmation beside the control that was pressed, so
          there is nowhere else to put them (UI_STANDARDS 6, 6b). */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setReason("");
            setNote("");
            setTyped("");
            setSave({ kind: "idle" });
          }}
          className={buttonCls.secondary + " !text-xs"}
        >
          Cancel
        </button>
        <SaveButton
          state={save}
          onSave={handleClose}
          onStateSettled={() => setSave({ kind: "idle" })}
          label="Record that they stopped"
          savingLabel="Recording…"
          dirty={canClose}
          notDirtyHint={notReadyHint}
        />
      </div>
    </div>
  );
}
