// Manual payout (2.2 organizer discretion): the organizer decides to pay a
// member out — an emergency, an agreement — with no spin. Pure guard logic
// here; the action layer reuses the DRAW path so there is no second money
// route (2.19): a Draw for the week, a Payout per lucky number, and the
// existing winner's-week settlement.
//
// EVERY week is choosable (2.2: refusing outright is wrong for the person who
// runs the Equb). A week that already has a draw is not hidden and not
// disabled — it is offered with its consequence spelled out from REAL data,
// and choosing it does the undo and the assignment in one transaction. Only a
// genuinely unsafe week is blocked, and then the reason names that week's own
// obstacle rather than a blanket rule.

import { formatMoney } from "./format";

export type ManualPayoutPayout = {
  /** The lucky number this payout belongs to. */
  number: number;
  /** Current net — what would cross the table. */
  netAmount: number;
  status: "PENDING" | "COLLECTED";
  /** Cents this payout settled onto the winner's own week (0 = none). */
  settlementAmount: number;
};

export type ManualPayoutWeek = {
  weekNumber: number;
  /** Already has a draw — a week holds at most one draw. */
  hasDraw: boolean;
  /** Drawn manually rather than spun (only affects the WHY, not the rule). */
  drawnManually: boolean;
  /** A winner plan is committed to this week (2.3) — cancel it first. */
  planned: boolean;
  /** The numbers in the drawn slot; they return to the wheel on an undo. */
  drawnNumbers: readonly number[];
  /** The payouts that undoing would remove. */
  payouts: readonly ManualPayoutPayout[];
  isSkipped: boolean;
};

export type ManualPayoutNumber = {
  id: string;
  number: number;
  /** Cents this number carries each week. */
  amount: number;
  alreadyDrawn: boolean;
};

/**
 * What choosing this week means. Three outcomes, never a silent refusal:
 *
 *   free     — nothing is in the way; assign and be done.
 *   replaces — a draw is already there. Say EXACTLY what disappears, then let
 *              the organizer proceed deliberately (typed confirmation,
 *              undo + assign in one transaction).
 *   blocked  — this specific week has an obstacle undoing cannot clear.
 */
export type WeekChoice =
  | { weekNumber: number; kind: "free" }
  | {
      weekNumber: number;
      kind: "replaces";
      /** One plain sentence naming the draw, its money and its state. */
      consequence: string;
      /** Money already handed over would be un-recorded. */
      highStakes: boolean;
      payoutCount: number;
      totalNet: number;
      numbersReturning: number[];
      reopensWeeks: number[];
    }
  | { weekNumber: number; kind: "blocked"; reason: string };

function listNumbers(numbers: readonly number[]): string {
  return [...numbers].sort((a, b) => a - b).map((n) => `#${n}`).join(", ");
}

export function weekChoice(week: ManualPayoutWeek): WeekChoice {
  // A committed plan is a LOCKED intent (2.3), not a draw — there is nothing
  // to undo here, so the honest answer names the plan and how to clear it.
  if (week.planned && !week.hasDraw) {
    return {
      weekNumber: week.weekNumber,
      kind: "blocked",
      reason:
        `Week ${week.weekNumber} has a committed winner plan. Cancel the plan on the wheel ` +
        `first (2.3 — a locked plan is never overwritten silently), then assign here.`,
    };
  }

  if (!week.hasDraw) return { weekNumber: week.weekNumber, kind: "free" };

  const totalNet = week.payouts.reduce((s, p) => s + p.netAmount, 0);
  const collected = week.payouts.filter((p) => p.status === "COLLECTED");
  const settled = week.payouts.filter((p) => p.settlementAmount > 0);

  // A DRAW HOLDING NO PAYOUT is not a real win — it is the half-state that
  // stranded weeks 1 and 6. It should no longer be creatable (the draw is now
  // deleted with its last payout, lib/draw-cascade), but data from before that
  // must read honestly rather than as a drawn week with a blank amount.
  if (week.payouts.length === 0) {
    const stuck = listNumbers(week.drawnNumbers);
    return {
      weekNumber: week.weekNumber,
      kind: "replaces",
      consequence:
        `Week ${week.weekNumber} is marked drawn but holds NO payout — nothing was ever paid ` +
        `out for it. Assigning here clears that empty draw first` +
        (week.drawnNumbers.length > 0
          ? `, and ${stuck} ${week.drawnNumbers.length === 1 ? "returns" : "return"} to the wheel.`
          : "; no number is affected, because its slot is empty too."),
      // Nothing of value is destroyed: there is no money record to lose.
      highStakes: false,
      payoutCount: 0,
      totalNet: 0,
      numbersReturning: [...week.drawnNumbers].sort((a, b) => a - b),
      reopensWeeks: [],
    };
  }

  const state =
    collected.length === week.payouts.length
      ? "collected"
      : collected.length > 0
        ? `${collected.length} of ${week.payouts.length} collected`
        : "pending";

  const who = listNumbers(week.payouts.map((p) => p.number));
  const head =
    `Week ${week.weekNumber} already has a ${week.drawnManually ? "manually assigned payout" : "draw"} ` +
    `(${who}, ${formatMoney(totalNet)}, ${state}).`;
  const tail =
    `Assigning here means undoing that ${week.drawnManually ? "assignment" : "draw"} first: ` +
    `${week.payouts.length === 1 ? "its payout is" : `its ${week.payouts.length} payouts are`} removed, ` +
    `${listNumbers(week.drawnNumbers)} return${week.drawnNumbers.length === 1 ? "s" : ""} to the wheel` +
    (settled.length > 0
      ? `, and week ${week.weekNumber} becomes owed again for ${listNumbers(settled.map((p) => p.number))} ` +
        `(${formatMoney(settled.reduce((s, p) => s + p.settlementAmount, 0))} settled from the payout).`
      : ".");

  return {
    weekNumber: week.weekNumber,
    kind: "replaces",
    consequence: `${head} ${tail}`,
    highStakes: collected.length > 0,
    payoutCount: week.payouts.length,
    totalNet,
    numbersReturning: [...week.drawnNumbers].sort((a, b) => a - b),
    reopensWeeks: settled.length > 0 ? [week.weekNumber] : [],
  };
}

/** Every week, in order, each carrying what choosing it would mean. */
export function weekChoices(weeks: readonly ManualPayoutWeek[]): WeekChoice[] {
  return weeks.map(weekChoice);
}

/** The first week nothing is in the way of — the sensible default selection. */
export function firstFreeWeek(choices: readonly WeekChoice[]): WeekChoice | null {
  return choices.find((c) => c.kind === "free") ?? null;
}

/** Why these numbers cannot be assigned, or null. */
export function numbersRefusal(chosen: readonly ManualPayoutNumber[]): string | null {
  if (chosen.length === 0) return "Choose at least one lucky number to pay out.";
  const drawn = chosen.filter((n) => n.alreadyDrawn);
  if (drawn.length > 0) {
    return (
      `${drawn.map((n) => `#${n.number}`).join(", ")} ` +
      `${drawn.length === 1 ? "has" : "have"} already been drawn — a number leaves the pool for good (2.27).`
    );
  }
  return null;
}

export type ManualPayoutLine = {
  luckyNumberId: string;
  number: number;
  gross: number;
  fee: number;
  net: number;
};

/**
 * What the organizer sees before confirming — identical arithmetic to a drawn
 * payout, one line per lucky number because each carries its own fee.
 */
export function manualPayoutPreview(input: {
  numbers: readonly ManualPayoutNumber[];
  weeksCommitted: number;
  feePercent: number;
  calculate: (n: { id: string; amount: number }) => { gross: number; fee: number; net: number };
}): { lines: ManualPayoutLine[]; totalGross: number; totalFee: number; totalNet: number } {
  const lines = input.numbers.map((n) => {
    const p = input.calculate({ id: n.id, amount: n.amount });
    return { luckyNumberId: n.id, number: n.number, gross: p.gross, fee: p.fee, net: p.net };
  });
  return {
    lines,
    totalGross: lines.reduce((s, l) => s + l.gross, 0),
    totalFee: lines.reduce((s, l) => s + l.fee, 0),
    totalNet: lines.reduce((s, l) => s + l.net, 0),
  };
}
