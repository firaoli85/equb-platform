"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { changeDrawSlot, moveDraw } from "@/app/actions/edits";
import { undoDraw } from "@/app/actions/wheel";
import { ConfirmDialog, type ConfirmSpec } from "@/components/ui/confirm-dialog";
import { Select } from "@/components/ui/controls";
import { buttonCls } from "@/components/ui/primitives";
import { SaveFeedback, type SaveState } from "@/components/ui/save-button";
import { formatMoney } from "@/lib/format";
import type { UndoDrawConsequences } from "@/lib/undo-draw";

export function DrawEditor({
  draw,
  undo,
  cycleName,
  weekOptions,
  slotOptions,
}: {
  draw: { id: string; weekId: string; weekNumber: number; slotId: string; winners: string };
  undo: UndoDrawConsequences;
  cycleName: string;
  weekOptions: { id: string; label: string; hasDraw: boolean }[];
  slotOptions: { id: string; label: string; hasWon: boolean }[];
}) {
  const router = useRouter();
  const [targetWeekId, setTargetWeekId] = useState(draw.weekId);
  const [targetSlotId, setTargetSlotId] = useState(draw.slotId);
  /**
   * ONE STATE FOR THE OUTCOME of whichever of the three buttons was pressed
   * (rule 6). It renders under the row they sit in, not in a page banner.
   */
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  // DERIVED: the dialog's busy state and every button's are the same fact.
  const busy = save.kind === "saving";
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  /**
   * A refusal from the action the dialog just ran. Set it and the dialog stays
   * open with the reason inside, beside the button that caused it — never only
   * in a banner elsewhere on the page (UI_STANDARDS 6b).
   */
  const [dialogError, setDialogError] = useState<string | null>(null);
  // The confirm handler carries what the organizer TYPED, so an action with
  // a server-side typed-name check gets the real value rather than a copy of
  // the expected one.
  const [onConfirm, setOnConfirm] = useState<((typed: string) => void) | null>(null);

  function ask(
    spec: ConfirmSpec,
    fn: (typedPhrase: string) => Promise<{ ok: boolean; error?: string }>,
    okText: string,
  ) {
    setConfirm(spec);
    setOnConfirm(() => (typedPhrase: string) => {
      void (async () => {
        setBusy(true);
        setMsg(null);
        /** The refusal, if any — the dialog closes only while this stays null. */
        let refused: string | null = null;
        try {
          const result = await fn(typedPhrase);
          if (!result.ok) {
            refused = result.error ?? "Failed.";
            setMsg({ kind: "err", text: refused });
          }
          else {
            setMsg({ kind: "ok", text: okText });
            router.refresh();
          }
        } catch {
          setMsg({ kind: "err", text: "Could not reach the server — nothing confirmed." });
        } finally {
          setBusy(false);
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

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141414] px-4 py-3 text-sm shadow-sm">
      <p className="mb-2 text-gray-900 dark:text-white">
        <strong>Week {draw.weekNumber}</strong>{" "}
        <span className="text-gray-600 dark:text-gray-400">— winners: {draw.winners}</span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={targetWeekId}
          onChange={setTargetWeekId}
          ariaLabel="Target week"
          className="w-64"
          options={weekOptions.map((w) => ({ value: w.id, label: w.label }))}
        />
        <button
          type="button"
          disabled={busy || targetWeekId === draw.weekId}
          onClick={() => {
            const target = weekOptions.find((w) => w.id === targetWeekId);
            ask(
              {
                title: `Move this draw from week ${draw.weekNumber}?`,
                destructive: false,
                body: (
                  <>
                    <p>
                      The winners ({draw.winners}) are recorded as having won {target?.label}{" "}
                      instead. Their winner&apos;s-week settlement moves with the draw: week{" "}
                      {draw.weekNumber}&apos;s settled contribution is owed again and the new week
                      is settled from the payout.
                    </p>
                    <p>
                      An audit entry records the move. If the target week already has a draw you
                      get a clear error and nothing changes.
                    </p>
                  </>
                ),
                confirmLabel: "Move the draw",
              },
              () => moveDraw({ drawId: draw.id, weekId: targetWeekId }),
              "✓ Draw moved — settlements were re-applied to the new week.",
            );
          }}
          className={buttonCls.secondary + " !px-3 !py-1.5 !text-xs"}
        >
          Move to week
        </button>

        <Select
          value={targetSlotId}
          onChange={setTargetSlotId}
          ariaLabel="Winning slot"
          className="w-64"
          options={slotOptions.map((s) => ({ value: s.id, label: s.label }))}
        />
        <button
          type="button"
          disabled={busy || targetSlotId === draw.slotId || undo.payoutCount > 0}
          title={
            undo.payoutCount > 0
              ? `Week ${draw.weekNumber} already has payouts — undo the draw instead, then draw again`
              : undefined
          }
          onClick={() => {
            const target = slotOptions.find((s) => s.id === targetSlotId);
            ask(
              {
                title: `Change week ${draw.weekNumber}'s winner?`,
                destructive: false,
                body: (
                  <p>
                    {target?.label} becomes the winner. An audit entry records old and new
                    winners. If that slot already won a week you get a clear error and nothing
                    changes (one win per slot).
                  </p>
                ),
                confirmLabel: "Change winner",
              },
              () => changeDrawSlot({ drawId: draw.id, slotId: targetSlotId }),
              "✓ Winner changed.",
            );
          }}
          className={buttonCls.secondary + " !px-3 !py-1.5 !text-xs"}
        >
          Change winner
        </button>
        {undo.payoutCount > 0 && (
          <span className="text-xs text-gray-600 dark:text-gray-400">
            Winner is locked once money is recorded — undo the draw to change it.
          </span>
        )}

        <button
          type="button"
          disabled={busy}
          onClick={() =>
            ask(
              {
                title: `Undo the draw for week ${undo.weekNumber}?`,
                body: (
                  <>
                    <p>
                      This says week {undo.weekNumber} was NOT drawn. The draw and its{" "}
                      {undo.payoutCount} payout record{undo.payoutCount === 1 ? "" : "s"} totalling{" "}
                      <strong className="tabular-nums">{formatMoney(undo.totalNet)}</strong> are
                      removed
                      {undo.collectedCount > 0 &&
                        ` — including ${formatMoney(undo.collectedNet)} already handed over`}
                      .
                    </p>
                    <p>
                      Number{undo.numbersReturning.length === 1 ? "" : "s"}{" "}
                      <strong>{undo.numbersReturning.map((n) => `#${n}`).join(", ")}</strong> RETURN
                      TO THE WHEEL POOL.
                    </p>
                    {undo.unsettled.length > 0 && (
                      <p>
                        {undo.unsettled
                          .map((s) => `#${s.number}'s settled ${formatMoney(s.amount)}`)
                          .join(" and ")}{" "}
                        for week {undo.weekNumber} becomes owed again.
                      </p>
                    )}
                  </>
                ),
                confirmLabel: `Undo the draw for week ${undo.weekNumber}`,
                requirePhrase: undo.highStakes ? cycleName : undefined,
              },
              (typedPhrase) => undoDraw({ drawId: draw.id, typedName: typedPhrase }),
              `✓ Week ${undo.weekNumber}'s draw undone — the numbers are back on the wheel.`,
            )
          }
          className={buttonCls.danger + " !px-3 !py-1.5 !text-xs"}
        >
          Undo the draw
        </button>
      </div>
      {msg && (
        <div className="mt-2">
          <Alert kind={msg.kind}>{msg.text}</Alert>
        </div>
      )}
      <ConfirmDialog
        spec={confirm}
        error={dialogError}
        busy={busy}
        onConfirm={(typedPhrase) => onConfirm?.(typedPhrase)}
        onCancel={() => {
          setDialogError(null);
          setConfirm(null);
          setOnConfirm(null);
        }}
      />
    </div>
  );
}
