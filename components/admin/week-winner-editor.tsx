"use client";

import { useEffect, useState, useTransition } from "react";
import { addWinnerToWeek, movePayoutToWeek, poolCandidates } from "@/app/actions/week-winners";
import type { ConfirmSpec } from "@/components/ui/confirm-dialog";
import { Select } from "@/components/ui/controls";
import { buttonCls } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/format";
import {
  addWinnerPreview,
  addWinnerRefusal,
  movePayoutPreview,
  movePayoutRefusal,
  previewSentences,
  type WeekWinners,
  type WinnerCandidate,
} from "@/lib/week-winners";

// RESHAPING A WEEK'S WINNERS (2.23) — from the Collections page, without
// undoing the whole draw.
//
// Week 6 recorded Hana (#19) alone at $4,900. She contributes $250 a week;
// nobody wins that alone when the pot is ~$20,000. She was paired with
// someone, the record had her solo, and the only "fix" available was to undo
// the draw and redraw it — losing the rest of the week with it.
//
// EVERY ACTION STATES ITS CONSEQUENCES IN REAL MONEY FIRST. The sentences come
// from lib/week-winners.ts, so the confirmation and the arithmetic can never
// drift apart.

/** A destination week, carrying the live state its label states. */
export type MoveTargetWeek = {
  weekId: string;
  weekNumber: number;
  hasDraw: boolean;
  isSkipped: boolean;
  planned: boolean;
  payoutCount: number;
  totalNet: number;
};

/**
 * The label IS the state. A week that is free says so; a drawn week quotes its
 * real total; a week holding a committed plan says that instead of silently
 * being missing. Nothing is hidden or disabled — the organizer sees why.
 */
function targetLabel(w: MoveTargetWeek): string {
  if (w.planned && !w.hasDraw) return `Week ${w.weekNumber} — winner plan committed`;
  if (!w.hasDraw) return `Week ${w.weekNumber} — free${w.isSkipped ? " (skipped week)" : ""}`;
  if (w.payoutCount === 0) return `Week ${w.weekNumber} — drawn, holding no payout`;
  return (
    `Week ${w.weekNumber} — ${w.payoutCount} winner${w.payoutCount === 1 ? "" : "s"}, ` +
    `${formatMoney(w.totalNet)}`
  );
}

type Props = {
  week: WeekWinners;
  cycleName: string;
  /** EVERY other week of the cycle, drawn or not — built from live state. */
  otherWeeks: MoveTargetWeek[];
  busy: boolean;
  ask: (
    spec: ConfirmSpec,
    action: () => Promise<{ ok: boolean; error?: string } | { ok: boolean }>,
    okText: string,
  ) => void;
};

/** The consequence list, rendered the same way for all three actions. */
function Consequences({ lines }: { lines: string[] }) {
  return (
    <ul className="space-y-1">
      {lines.map((line) => (
        <li key={line} className="flex gap-2">
          <span aria-hidden="true" className="text-gray-400 dark:text-gray-500">
            •
          </span>
          <span>{line}</span>
        </li>
      ))}
    </ul>
  );
}

export function WeekWinnerEditor({ week, cycleName, otherWeeks, busy, ask }: Props) {
  const [open, setOpen] = useState<"none" | "add" | "move">("none");
  const [candidates, setCandidates] = useState<WinnerCandidate[] | null>(null);
  const [feePercent, setFeePercent] = useState(2);
  const [chosenNumber, setChosenNumber] = useState("");
  const [movingPayoutId, setMovingPayoutId] = useState("");
  const [targetWeekId, setTargetWeekId] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [, startLoad] = useTransition();

  // The pool is only needed once the organizer asks to add someone.
  useEffect(() => {
    if (open !== "add" || candidates !== null) return;
    startLoad(async () => {
      const result = await poolCandidates({ weekId: week.weekId });
      if (!result.ok) {
        setLoadError(result.error);
        return;
      }
      setCandidates(result.data.candidates);
      setFeePercent(result.data.feePercent);
    });
  }, [open, candidates, week.weekId]);

  const candidate = candidates?.find((c) => c.luckyNumberId === chosenNumber) ?? null;
  const moving = week.payouts.find((p) => p.payoutId === movingPayoutId) ?? null;
  const target = otherWeeks.find((w) => w.weekId === targetWeekId) ?? null;

  // ————— ADD —————
  function confirmAdd() {
    if (!candidate) return;
    const refusal = addWinnerRefusal({
      week,
      candidate,
      // The server re-checks against the real pool; this is the immediate
      // answer so an impossible choice never reaches a confirmation.
      drawnNumberIds: new Set(week.payouts.map((p) => p.luckyNumberId)),
    });
    if (refusal) {
      setLoadError(refusal);
      return;
    }
    const preview = addWinnerPreview({ week, candidate, feePercent });
    ask(
      {
        title: `Add ${candidate.memberName} (#${candidate.number}) to week ${week.weekNumber}?`,
        destructive: false,
        consequence: (
          <>
            #{candidate.number} <strong>leaves the wheel pool</strong> — it can never be drawn
            again while this payout exists.
          </>
        ),
        body: <Consequences lines={previewSentences(preview, formatMoney)} />,
        confirmLabel: "Add this winner",
      },
      () => addWinnerToWeek({ weekId: week.weekId, luckyNumberId: candidate.luckyNumberId }),
      `✓ #${candidate.number} added to week ${week.weekNumber}.`,
    );
  }

  // ————— MOVE —————
  function confirmMove() {
    if (!moving || !target) return;
    const to: WeekWinners = {
      weekId: target.weekId,
      weekNumber: target.weekNumber,
      undrawn: !target.hasDraw,
      isSkipped: target.isSkipped,
      planned: target.planned,
      // The destination's own payouts are not loaded here; the server
      // re-checks against the real rows before writing anything.
      payouts: [],
    };
    const refusal = movePayoutRefusal({ from: week, to, payout: moving });
    if (refusal) {
      setLoadError(refusal);
      return;
    }
    const preview = movePayoutPreview({
      from: week,
      to,
      payout: moving,
      candidate: {
        memberName: moving.memberName,
        // The server recomputes from the real participation; this preview
        // uses the settlement already on the payout, which is the same money.
        weeklyAmount: moving.settlement,
        startWeek: 1,
        weeksCommitted: 999,
      },
    });
    ask(
      {
        title: `Move #${moving.number} (${moving.memberName}) to week ${target.weekNumber}?`,
        destructive: false,
        consequence: (
          <>
            The settlement <strong>follows the winner</strong>: week {week.weekNumber} becomes owed
            again and week {target.weekNumber} settles from this payout. The number stays drawn
            throughout.
          </>
        ),
        body: (
          <>
            <Consequences lines={previewSentences(preview, formatMoney)} />
            {!target.hasDraw && (
              <p className="pt-1">
                Week {target.weekNumber} has no draw yet, so one is created for it and recorded as{" "}
                <strong>assigned, not spun</strong> — the same record a manual payout makes.
              </p>
            )}
            <p className="pt-1">
              Week {week.weekNumber} total becomes{" "}
              <strong className="tabular-nums">{formatMoney(preview.fromTotalAfter)}</strong>; week{" "}
              {target.weekNumber} becomes{" "}
              <strong className="tabular-nums">{formatMoney(preview.toTotalAfter)}</strong>.
            </p>
          </>
        ),
        confirmLabel: `Move to week ${target.weekNumber}`,
      },
      () => movePayoutToWeek({ payoutId: moving.payoutId, targetWeekId: target.weekId }),
      `✓ #${moving.number} moved to week ${target.weekNumber}.`,
    );
  }

  return (
    <div className="border-t border-gray-100 dark:border-gray-800/60 px-5 py-3">
      {loadError && (
        <p role="alert" className="mb-2 text-xs font-semibold text-red-700 dark:text-red-400">
          {loadError}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || week.undrawn}
          onClick={() => {
            setOpen(open === "add" ? "none" : "add");
            setLoadError(null);
          }}
          className={buttonCls.secondary + " !text-xs"}
        >
          {open === "add" ? "Close" : "Add a winner to this week"}
        </button>
        {week.payouts.length > 0 && otherWeeks.length > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setOpen(open === "move" ? "none" : "move");
              setLoadError(null);
            }}
            className={buttonCls.ghost + " !text-xs"}
          >
            {open === "move" ? "Close" : "Move a winner to another week"}
          </button>
        )}
        {week.undrawn && (
          <span className="text-xs text-gray-600 dark:text-gray-400">
            Draw this week on the wheel before adding winners to it.
          </span>
        )}
      </div>

      {/* ————— ADD ————— */}
      {open === "add" && (
        <div className="mt-3 flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-white/[0.02] p-3">
          <label className="block min-w-56">
            <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400">
              Who joins this week
            </span>
            <Select
              value={chosenNumber}
              onChange={(v) => {
                setChosenNumber(v);
                setLoadError(null);
              }}
              ariaLabel={`Member and lucky number to add to week ${week.weekNumber}`}
              className="w-full"
              options={[
                { value: "", label: candidates === null ? "Loading the pool…" : "Choose a number" },
                ...(candidates ?? []).map((c) => ({
                  value: c.luckyNumberId,
                  // Each number is its own payout, so the number is named.
                  label: `#${c.number} — ${c.memberName} (${formatMoney(c.amount)}/wk)`,
                })),
              ]}
            />
          </label>
          {candidate && (
            <p className="text-xs tabular-nums text-gray-700 dark:text-gray-300">
              Payout{" "}
              <strong>
                {formatMoney(
                  addWinnerPreview({ week, candidate, feePercent }).weekTotalAfter -
                    addWinnerPreview({ week, candidate, feePercent }).weekTotalBefore,
                )}
              </strong>{" "}
              net after their own week settles
            </p>
          )}
          <button
            type="button"
            disabled={busy || !candidate}
            onClick={confirmAdd}
            className={buttonCls.primary + " !text-xs"}
          >
            Review…
          </button>
          {candidates !== null && candidates.length === 0 && (
            <p className="basis-full text-xs text-gray-600 dark:text-gray-400">
              Every number in this cycle has already been drawn — there is nobody left to add.
            </p>
          )}
        </div>
      )}

      {/* ————— MOVE ————— */}
      {open === "move" && (
        <div className="mt-3 flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-white/[0.02] p-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400">
              Which winner
            </span>
            <Select
              value={movingPayoutId}
              onChange={setMovingPayoutId}
              ariaLabel="Winner to move"
              className="w-56"
              options={[
                { value: "", label: "Choose a winner" },
                ...week.payouts.map((p) => ({
                  value: p.payoutId,
                  label: `#${p.number} — ${p.memberName} (${formatMoney(p.net)})`,
                })),
              ]}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400">
              To which week
            </span>
            <Select
              value={targetWeekId}
              onChange={setTargetWeekId}
              ariaLabel="Destination week"
              className="w-40"
              options={[
                { value: "", label: "Choose a week" },
                ...otherWeeks.map((w) => ({
                  value: w.weekId,
                  label: targetLabel(w),
                })),
              ]}
            />
          </label>
          <button
            type="button"
            disabled={busy || !moving || !target}
            onClick={confirmMove}
            className={buttonCls.primary + " !text-xs"}
          >
            Review…
          </button>
          <p className="basis-full text-xs text-gray-600 dark:text-gray-400">
            Every week is offered with its real state — free weeks as free, drawn weeks with their
            total. Moving into a free week creates the draw there. A week holding a committed
            winner plan is named as such and refused, so the plan is never overwritten silently
            (2.3).
          </p>
        </div>
      )}
    </div>
  );
}

// "Remove this winner" lives in the Collections view beside "Delete payout" —
// the two must be read together, since one returns the number to the wheel and
// the other does not. A second copy of that dialog used to live here; it was
// unreachable and free to drift from the one the organizer actually sees.
