"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { changeDrawSlot, moveDraw } from "@/app/actions/edits";
import { undoDraw } from "@/app/actions/wheel";
import { ConfirmDialog, type ConfirmSpec } from "@/components/ui/confirm-dialog";
import { Select } from "@/components/ui/controls";
import { Alert, buttonCls } from "@/components/ui/primitives";
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
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [onConfirm, setOnConfirm] = useState<(() => void) | null>(null);

  function ask(spec: ConfirmSpec, fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) {
    setConfirm(spec);
    setOnConfirm(() => () => {
      void (async () => {
        setBusy(true);
        setMsg(null);
        try {
          const result = await fn();
          if (!result.ok) setMsg({ kind: "err", text: result.error ?? "Failed." });
          else {
            setMsg({ kind: "ok", text: okText });
            router.refresh();
          }
        } catch {
          setMsg({ kind: "err", text: "Could not reach the server — nothing confirmed." });
        } finally {
          setBusy(false);
          setConfirm(null);
          setOnConfirm(null);
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
          disabled={busy || targetSlotId === draw.slotId}
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
              () => undoDraw({ drawId: draw.id }),
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
        busy={busy}
        onConfirm={() => onConfirm?.()}
        onCancel={() => {
          setConfirm(null);
          setOnConfirm(null);
        }}
      />
    </div>
  );
}
