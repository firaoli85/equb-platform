"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  participationRemovalPreview,
  removeFromCycle,
} from "@/app/actions/participation-removal";
import type { RemovalChoice, RemovalConsequences } from "@/lib/participation-removal";
import { Alert, buttonCls, inputCls } from "@/components/ui/primitives";
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
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [loading, startLoad] = useTransition();

  useEffect(() => {
    if (!open || preview) return;
    startLoad(async () => {
      const result = await participationRemovalPreview({ participationId });
      if (!result.ok) {
        setMsg({ kind: "err", text: result.error });
        return;
      }
      setPreview(result.data as Preview);
    });
  }, [open, preview, participationId]);

  const nameOk = typed.trim().toLowerCase() === personName.trim().toLowerCase();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={buttonCls.dangerQuiet + " !text-xs"}
      >
        Remove from this cycle
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-2xl border-2 border-gray-300 dark:border-gray-700 p-4">
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      <div>
        <h3 className="text-sm font-black text-gray-900 dark:text-white">
          Remove {personName} from {preview?.attachments.cycleName ?? "this cycle"}?
        </h3>
        <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
          Everything attached to them is listed below. Choose what happens to it — neither option
          is selected for you.
        </p>
      </div>

      {loading && !preview && (
        <p className="text-xs text-gray-600 dark:text-gray-400">
          Working out what is attached to them…
        </p>
      )}

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

      {/* THE REASON, AT THE BUTTON. The attachment summary, two tall choice
          panels and the typed-name box sit between this and the `msg` at the
          top of the panel (UI_STANDARDS 6b). */}
      {msg?.kind === "err" && (
        <p
          role="alert"
          className="rounded-xl border border-red-300 bg-red-50 px-3.5 py-2.5 text-sm font-semibold text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200"
        >
          {msg.text}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setChoice(null);
            setTyped("");
            setMsg(null);
          }}
          className={buttonCls.secondary + " !text-xs"}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={pending || !choice || !nameOk}
          onClick={() =>
            start(async () => {
              if (!choice) return;
              setMsg(null);
              const result = await removeFromCycle({ participationId, choice, typedName: typed });
              if (!result.ok) {
                setMsg({ kind: "err", text: result.error });
                return;
              }
              setMsg({
                kind: "ok",
                text:
                  `✓ ${result.data.name} removed from ${result.data.cycle}` +
                  (result.data.numbersReturning.length > 0
                    ? ` — ${result.data.numbersReturning.map((n) => `#${n}`).join(", ")} back on the wheel.`
                    : "."),
              });
              setOpen(false);
              router.refresh();
            })
          }
          className={choice === "keep-money-records" ? buttonCls.primary : buttonCls.danger}
        >
          {pending
            ? "Removing…"
            : choice === "keep-money-records"
              ? "Remove, keep the records"
              : choice === "remove-completely"
                ? "Remove completely"
                : "Choose an option above"}
        </button>
      </div>
    </div>
  );
}
