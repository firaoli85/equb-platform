"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  participationRemovalPreview,
  removeFromCycle,
} from "@/app/actions/participation-removal";
import type { RemovalChoice, RemovalConsequences } from "@/lib/participation-removal";
import { Alert, buttonCls, inputCls } from "@/components/ui/primitives";
import { SaveButton, SaveFeedback, type SaveState } from "@/components/ui/save-button";
import { formatMoney } from "@/lib/format";

// REMOVING SOMEONE FROM A CYCLE (2.23).
//
// The old flow was a single red button that deleted everything by cascade,
// with a confirmation naming only lucky numbers, week rows and receipts. It
// never mentioned payouts, draws, the wheel or winner plans — all of which it
// also destroyed. An organizer removing a member who had already WON was told
// only that receipts would go.
//
// THREE CHOICES, NONE OF THEM A DEFAULT. Neither radio is pre-selected and the
// button stays disabled until one is picked, because the two do very different
// things to real money and the safe-looking one is not always what is meant.

type Preview = {
  attachments: {
    personName: string;
    cycleName: string;
    receiptCount: number;
    receiptTotal: number;
    weeksWithMoney: number;
    numbers: { number: number; drawn: boolean }[];
    payouts: { number: number; net: number; status: string; settlement: number }[];
  };
  feeAttributable: number;
  alreadyClosed: boolean;
  removeCompletely: RemovalConsequences;
  keepMoneyRecords: RemovalConsequences;
};

function ChoicePanel({
  id,
  title,
  subtitle,
  consequences,
  selected,
  onSelect,
  tone,
}: {
  id: RemovalChoice;
  title: string;
  subtitle: string;
  consequences: RemovalConsequences;
  selected: boolean;
  onSelect: () => void;
  tone: "danger" | "neutral";
}) {
  const ring = selected
    ? tone === "danger"
      ? "border-red-400 dark:border-red-700 bg-red-50/60 dark:bg-red-950/20"
      : "border-indigo-400 dark:border-indigo-700 bg-indigo-50/50 dark:bg-indigo-950/20"
    : "border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700";

  return (
    <label className={`block cursor-pointer rounded-2xl border-2 p-4 transition-colors ${ring}`}>
      <span className="flex items-start gap-3">
        <input
          type="radio"
          name="removal-choice"
          value={id}
          checked={selected}
          onChange={onSelect}
          className="mt-1 h-4 w-4 shrink-0 accent-indigo-600"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-gray-900 dark:text-white">{title}</span>
          <span className="mt-0.5 block text-xs text-gray-600 dark:text-gray-400">{subtitle}</span>

          {/* THE FIGURES, before anything is applied. */}
          <ul className="mt-2.5 space-y-1 text-xs text-gray-800 dark:text-gray-200">
            {consequences.lines.map((line) => (
              <li key={line} className="flex gap-2">
                <span aria-hidden="true" className="text-gray-400 dark:text-gray-500">
                  •
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ul>

          {consequences.cleanup.length > 0 && (
            <ul className="mt-2 space-y-1 rounded-lg bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
              {consequences.cleanup.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}

          {/* The cash position moves in the direction people do not expect
              when the member had already collected — so it is stated, with
              its direction spelled out rather than left as a signed number. */}
          <span className="mt-2 block text-xs font-semibold tabular-nums text-gray-900 dark:text-white">
            {consequences.cashPositionDelta === 0
              ? "Cash position: unchanged."
              : `Cash position: ${consequences.cashPositionDelta > 0 ? "rises" : "falls"} by ${formatMoney(Math.abs(consequences.cashPositionDelta))}.`}
          </span>
        </span>
      </span>
    </label>
  );
}

export function RemoveFromCycle({
  participationId,
  personName,
}: {
  participationId: string;
  personName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [choice, setChoice] = useState<RemovalChoice | null>(null);
  const [typed, setTyped] = useState("");
  /**
   * ONE STATE FOR THE REMOVAL (UI_STANDARDS rule 6).
   *
   * It was a `msg` banner at the TOP of this panel, a second copy of the
   * refusal down by the button, and a `pending` boolean saying the same thing
   * as "saving". The panel is tall — the attachment summary, two choice
   * panels each listing their consequences, and the typed-name box sit
   * between the banner and the button — so a refusal shown up there is the
   * off-screen message rule 6b exists for, and the duplicate could disagree
   * with it. `busy` is DERIVED from this state; there is no second copy to
   * fall out of step.
   */
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  /**
   * Working out what is attached is not a save, so it does not belong in the
   * save state: its failure belongs where the ATTACHMENTS would have been,
   * never beside a button nobody has pressed yet.
   */
  const [loadError, setLoadError] = useState<string | null>(null);
  /**
   * The removal still runs inside a transition, so the `router.refresh()`
   * that follows stays non-urgent. Its pending flag is deliberately not
   * taken — `busy` below is the ONE name for "a write is in flight".
   */
  const [, startWrite] = useTransition();
  const [loading, startLoad] = useTransition();
  const busy = save.kind === "saving";

  useEffect(() => {
    if (!open || preview) return;
    startLoad(async () => {
      const result = await participationRemovalPreview({ participationId });
      if (!result.ok) {
        setLoadError(result.error);
        return;
      }
      setLoadError(null);
      setPreview(result.data as Preview);
    });
  }, [open, preview, participationId]);

  const nameOk = typed.trim().toLowerCase() === personName.trim().toLowerCase();
  // A dead button with no explanation reads as a broken app. This names the
  // one thing still missing, in the order it is asked for.
  const notReadyHint = !preview
    ? "Still working out what is attached to them."
    : !choice
      ? "Choose what happens to their money records first."
      : `Type ${personName} to confirm.`;

  function handleRemove() {
    if (!choice) return;
    startWrite(async () => {
      setSave({ kind: "saving" });
      try {
        const result = await removeFromCycle({ participationId, choice, typedName: typed });
        if (!result.ok) {
          // THE PANEL STAYS OPEN holding the reason, with the choice and the
          // typed name still in place to retry. A refusal thrown away with
          // the panel is UI_STANDARDS 6b's exact failure.
          setSave({ kind: "err", message: `Not removed: ${result.error}` });
          return;
        }
        // WHICH OF THE TWO OUTCOMES HAPPENED, AND WHAT IT DID TO THE MONEY.
        // The two choices do very different things to real figures, and the
        // cash position moves in the direction nobody expects when the member
        // had already collected — so the confirmation says which one ran and
        // which way the money went, not "Removed."
        const d = result.data;
        setSave({
          kind: "ok",
          message:
            `${d.name} removed from ${d.cycle}` +
            (d.choice === "keep-money-records"
              ? " — their money records kept."
              : " completely, as if they had never been in it.") +
            (d.cashPositionDelta === 0
              ? " The cash position is unchanged."
              : ` The cash position ${d.cashPositionDelta > 0 ? "rises" : "falls"} by ` +
                `${formatMoney(Math.abs(d.cashPositionDelta))}.`) +
            (d.numbersReturning.length > 0
              ? ` ${d.numbersReturning.map((n) => `#${n}`).join(", ")} back on the wheel.`
              : ""),
        });
        // CLOSE ONLY ON SUCCESS.
        setOpen(false);
        router.refresh();
      } catch {
        // A thrown call used to leave the button un-busy with nothing said —
        // the organizer's "it did nothing" with no reason to quote (6b).
        setSave({
          kind: "err",
          message: "Could not reach the server — nothing was removed.",
        });
      }
    });
  }

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
          className={buttonCls.dangerQuiet + " !text-xs"}
        >
          Remove from this cycle
        </button>
        {/* A successful removal COLLAPSES the panel, so a confirmation living
            inside it would go with it. This is where it is read. */}
        <SaveFeedback state={save} />
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-2xl border-2 border-gray-300 dark:border-gray-700 p-4">
      <div>
        <h3 className="text-sm font-black text-gray-900 dark:text-white">
          Remove {personName} from {preview?.attachments.cycleName ?? "this cycle"}?
        </h3>
        <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
          Everything attached to them is listed below. Choose what happens to it — neither option
          is selected for you.
        </p>
      </div>

      {/* A preview that FAILED is not "still loading", and it is not a refusal
          from the button either — the reason goes where the attachments would
          have been. */}
      {loadError !== null ? (
        <Alert kind="err">Could not work out what is attached to them: {loadError}</Alert>
      ) : loading && !preview ? (
        <p className="text-xs text-gray-600 dark:text-gray-400">
          Working out what is attached to them…
        </p>
      ) : null}

      {preview && (
        <>
          {/* WHAT IS ATTACHED — the facts, before the choice. */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-white/[0.02] p-3 text-xs tabular-nums text-gray-800 dark:text-gray-200">
            <p className="mb-1 font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
              Attached to {preview.attachments.personName}
            </p>
            <p>
              {formatMoney(preview.attachments.receiptTotal)} received over{" "}
              {preview.attachments.receiptCount} receipt
              {preview.attachments.receiptCount === 1 ? "" : "s"}, across{" "}
              {preview.attachments.weeksWithMoney} week
              {preview.attachments.weeksWithMoney === 1 ? "" : "s"}.
            </p>
            <p>
              Lucky number{preview.attachments.numbers.length === 1 ? "" : "s"}{" "}
              {preview.attachments.numbers
                .map((n) => `#${n.number}${n.drawn ? " (drawn)" : ""}`)
                .join(", ") || "none"}
              .
            </p>
            <p>
              {preview.attachments.payouts.length === 0
                ? "No payout — they have not been drawn."
                : preview.attachments.payouts
                    .map(
                      (po) =>
                        `Payout #${po.number}: ${formatMoney(po.net)} ${po.status.toLowerCase()}`,
                    )
                    .join(" · ")}
            </p>
            <p>Fee attributable to them: {formatMoney(preview.feeAttributable)}.</p>
          </div>

          <div className="space-y-2">
            <ChoicePanel
              id="remove-completely"
              title="Remove completely"
              subtitle="As if they were never in this cycle."
              consequences={preview.removeCompletely}
              selected={choice === "remove-completely"}
              onSelect={() => setChoice("remove-completely")}
              tone="danger"
            />
            <ChoicePanel
              id="keep-money-records"
              title="Remove from the cycle, but keep their money records"
              subtitle="They participated; the history stands."
              consequences={preview.keepMoneyRecords}
              selected={choice === "keep-money-records"}
              onSelect={() => setChoice("keep-money-records")}
              tone="neutral"
            />
          </div>

          {choice && (
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400">
                Type <strong className="select-all text-gray-900 dark:text-white">{personName}</strong>{" "}
                to confirm
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
        </>
      )}

      {/* THE FEEDBACK IS PART OF THE BUTTON. It used to be a banner at the top
          of this panel with a second copy down here — and the attachment
          summary, two tall choice panels and the typed-name box sit between
          them. `SaveButton` renders both the refusal and the confirmation
          beside the control that was pressed, so there is nowhere else for
          them to land (UI_STANDARDS 6, 6b). */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setChoice(null);
            setTyped("");
            setSave({ kind: "idle" });
          }}
          className={buttonCls.secondary + " !text-xs"}
        >
          Cancel
        </button>
        {/* The label and the colour still follow the CHOICE — the two outcomes
            are not the same act, and the button must not read as one. */}
        <SaveButton
          state={save}
          onSave={handleRemove}
          onStateSettled={() => setSave({ kind: "idle" })}
          label={
            choice === "keep-money-records"
              ? "Remove, keep the records"
              : choice === "remove-completely"
                ? "Remove completely"
                : "Choose an option above"
          }
          savingLabel="Removing…"
          tone={choice === "keep-money-records" ? "primary" : "danger"}
          dirty={Boolean(choice) && nameOk}
          notDirtyHint={notReadyHint}
        />
      </div>
    </div>
  );
}
