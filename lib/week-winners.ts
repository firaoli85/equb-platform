import { calculateFee, calculateGross, calculateNet } from "./money";

// EDITING A WEEK'S WINNERS (2.23) — the consequences, computed before anything
// runs.
//
// THE REAL CASE THIS EXISTS FOR. Week 6 records Hana (#19) alone at $4,900.
// She contributes $250 a week; nobody wins $4,900 alone when the weekly pot is
// ~$20,000. She was paired with someone and the record has her solo. Weeks 8
// and 9 correctly hold two payouts each — the structure supports it, only
// editing was missing.
//
// THE MODEL, stated because it is not obvious. A week's winners ARE the
// members of that week's draw slot:
//
//   drawnNumberIds  is built from slot.members       (app/actions/wheel.ts)
//   settleWinnerWeeks skips a payout whose lucky number
//                   is not in slot.members            (lib/draw-settlement.ts)
//
// So a Payout added without a SlotMember would be invisible to BOTH the wheel
// pool and the settlement — money on the books that nobody owes and a number
// that never leaves the wheel. Every edit here moves the pair together.
//
// THE THREE OPERATIONS, and the distinction that caused real confusion:
//
//   addWinner     a member joins this week. Their number LEAVES the pool and
//                 their contribution for this week settles from the payout.
//   removeWinner  a member leaves this week. Their number RETURNS to the pool
//                 and their contribution is owed again. The week's OTHER
//                 winners are untouched — this is what "delete payout" does
//                 not do, and the difference has already misled the organizer
//                 once.
//   movePayout    a winner moves from week A to week B. The settlement FOLLOWS
//                 them: the winner does not pay the week they win, so week A
//                 becomes owed again and week B settles.

export type WinnerPayout = {
  payoutId: string;
  luckyNumberId: string;
  /** The lucky number itself, for the organizer-facing sentences. */
  number: number;
  participationId: string;
  memberName: string;
  gross: number;
  fee: number;
  /** What crosses the table, already reduced by any week settlement. */
  net: number;
  /** The winner's own-week contribution settled from this payout, if any. */
  settlement: number;
  status: "PENDING" | "COLLECTED";
};

export type WeekWinners = {
  weekId: string;
  weekNumber: number;
  /** True when this week has no draw record at all. */
  undrawn: boolean;
  isSkipped: boolean;
  /**
   * A winner plan is COMMITTED to this week (2.3). Moving someone else into it
   * would overwrite the organizer's locked intent, so it is refused by name
   * rather than silently honoured.
   */
  planned?: boolean;
  payouts: readonly WinnerPayout[];
};

/** A member's number offered as a candidate winner. */
export type WinnerCandidate = {
  luckyNumberId: string;
  number: number;
  /** Cents per week for THIS number (the unit, not the member's total). */
  amount: number;
  participationId: string;
  memberName: string;
  weeksCommitted: number;
  startWeek: number;
  /** Their weekly contribution — what the settlement would take. */
  weeklyAmount: number;
};

/** Every figure a confirmation must state, for any of the three operations. */
export type WinnerEditPreview = {
  /** The week's combined net before and after. */
  weekTotalBefore: number;
  weekTotalAfter: number;
  /** Numbers leaving the wheel pool (drawn by this edit). */
  numbersLeavingPool: number[];
  /** Numbers returning to the wheel pool. */
  numbersReturningToPool: number[];
  /**
   * Weeks whose contribution becomes OWED AGAIN because a settlement was
   * reversed — stated per member, since a week reopening for one person and
   * not another is exactly the sort of thing that must not be summarised.
   */
  weeksReopening: { weekNumber: number; memberName: string; amount: number }[];
  /** Weeks whose contribution is now settled from a payout. */
  weeksSettling: { weekNumber: number; memberName: string; amount: number }[];
  /**
   * The change to money committed to pay out. Positive = the group owes more.
   * Cash RECEIVED is unaffected by these edits; only obligations move.
   */
  cashPositionDelta: number;
  /**
   * The week this edit leaves holding NOTHING, whose draw is therefore removed
   * (lib/draw-cascade). Null when the week keeps at least one winner. Stated
   * separately because "the week becomes undrawn and selectable again" is a
   * consequence the organizer must see before confirming, not after.
   */
  freedWeek: { weekNumber: number; numbersReturning: number[] } | null;
};

/**
 * The week being edited becomes undrawn when the payout leaving was its LAST
 * one. Its remaining slot numbers come back to the pool with the draw.
 */
function freesTheWeek(input: {
  week: WeekWinners;
  leavingPayoutId: string;
  /** Numbers staying in the drawn slot after this edit. */
  slotNumbersAfter: readonly number[];
}): { weekNumber: number; numbersReturning: number[] } | null {
  const remaining = input.week.payouts.filter((p) => p.payoutId !== input.leavingPayoutId);
  if (remaining.length > 0) return null;
  return {
    weekNumber: input.week.weekNumber,
    numbersReturning: [...input.slotNumbersAfter].sort((a, b) => a - b),
  };
}

const totalNet = (payouts: readonly WinnerPayout[]) => payouts.reduce((s, p) => s + p.net, 0);

/**
 * What a candidate's payout would be worth. The SAME arithmetic a drawn payout
 * uses (gross = the number's amount × their committed weeks, fee on gross), so
 * an added winner and a spun winner can never be worth different money.
 */
export function candidatePayout(
  candidate: Pick<WinnerCandidate, "amount" | "weeksCommitted">,
  feePercent: number,
): { gross: number; fee: number; net: number } {
  const gross = calculateGross(candidate.amount, candidate.weeksCommitted);
  const fee = calculateFee(gross, feePercent);
  return { gross, fee, net: calculateNet(gross, fee) };
}

/**
 * What this week would take from the candidate's payout as their own-week
 * contribution. Zero when the week is skipped (nobody owes it) or falls
 * outside their participation window.
 *
 * Mirrors lib/draw-settlement.ts: a DEFERRED week is still owed and settles
 * like any other; only SKIPPED is excused.
 */
export function settlementFor(input: {
  candidate: Pick<WinnerCandidate, "weeklyAmount" | "startWeek" | "weeksCommitted">;
  weekNumber: number;
  weekIsSkipped: boolean;
  /** Already paid for that week — only the remainder settles. */
  alreadyPaid?: number;
}): number {
  const finishWeek = input.candidate.startWeek + input.candidate.weeksCommitted - 1;
  const inWindow =
    input.weekNumber >= input.candidate.startWeek && input.weekNumber <= finishWeek;
  if (!inWindow || input.weekIsSkipped) return 0;
  const remaining = input.candidate.weeklyAmount - (input.alreadyPaid ?? 0);
  return Math.max(0, remaining);
}

// ————————————————————————————————————————————————————————————————
// REFUSALS — stated as values, so a caller must handle them.
// ————————————————————————————————————————————————————————————————

/** Why this member cannot be added to this week, or null. */
export function addWinnerRefusal(input: {
  week: WeekWinners;
  candidate: WinnerCandidate;
  /** Every number already drawn anywhere in the cycle. */
  drawnNumberIds: ReadonlySet<string>;
}): string | null {
  if (input.drawnNumberIds.has(input.candidate.luckyNumberId)) {
    // 2.27: a number leaves the pool when drawn and never comes back while
    // its payout exists.
    return `#${input.candidate.number} has already been drawn — a number can only win once.`;
  }
  if (input.week.payouts.some((p) => p.luckyNumberId === input.candidate.luckyNumberId)) {
    return `#${input.candidate.number} is already a winner of week ${input.week.weekNumber}.`;
  }
  const finishWeek = input.candidate.startWeek + input.candidate.weeksCommitted - 1;
  if (input.week.weekNumber < input.candidate.startWeek || input.week.weekNumber > finishWeek) {
    // Not a hard impossibility, but it means paying someone for a week they
    // are not in — the organizer should see it named rather than discover it.
    return (
      `Week ${input.week.weekNumber} is outside ${input.candidate.memberName}'s window ` +
      `(weeks ${input.candidate.startWeek}–${finishWeek}).`
    );
  }
  return null;
}

/** Why this winner cannot be removed from this week, or null. */
export function removeWinnerRefusal(input: {
  week: WeekWinners;
  payout: WinnerPayout;
}): string | null {
  if (!input.week.payouts.some((p) => p.payoutId === input.payout.payoutId)) {
    return "That payout is not part of this week.";
  }
  return null;
}

/**
 * Why this payout cannot move, or null.
 *
 * AN UNDRAWN DESTINATION IS ALLOWED. This used to refuse it — "week N has no
 * draw yet" — which meant a week the organizer had just freed could not be
 * moved into, and the only route was to draw it first on the wheel and then
 * move. The organizer decides where a winner belongs (2.2); the destination
 * having no draw yet is a thing to CREATE, not a reason to refuse. The move
 * builds the draw on arrival, exactly as a manual assignment does.
 *
 * A committed winner plan still refuses, because that is the organizer's own
 * locked intent (2.3) and overwriting it silently is the failure that shipped
 * twice before.
 */
export function movePayoutRefusal(input: {
  from: WeekWinners;
  to: WeekWinners;
  payout: WinnerPayout;
}): string | null {
  if (input.from.weekId === input.to.weekId) {
    return "That payout is already on this week.";
  }
  if (input.to.planned && input.to.undrawn) {
    return (
      `Week ${input.to.weekNumber} has a committed winner plan. Cancel the plan on the wheel ` +
      `first (2.3 — a locked plan is never overwritten silently), then move this winner into it.`
    );
  }
  if (input.to.payouts.some((p) => p.luckyNumberId === input.payout.luckyNumberId)) {
    return `#${input.payout.number} is already a winner of week ${input.to.weekNumber}.`;
  }
  return null;
}

// ————————————————————————————————————————————————————————————————
// PREVIEWS — the numbers the confirmation states.
// ————————————————————————————————————————————————————————————————

export function addWinnerPreview(input: {
  week: WeekWinners;
  candidate: WinnerCandidate;
  feePercent: number;
  /** What they have already paid toward this week, if anything. */
  alreadyPaid?: number;
}): WinnerEditPreview {
  const payout = candidatePayout(input.candidate, input.feePercent);
  const settlement = settlementFor({
    candidate: input.candidate,
    weekNumber: input.week.weekNumber,
    weekIsSkipped: input.week.isSkipped,
    alreadyPaid: input.alreadyPaid,
  });
  // The settlement comes OUT of the payout — it is not extra cash.
  const netAfterSettlement = Math.max(0, payout.net - settlement);
  const before = totalNet(input.week.payouts);

  return {
    weekTotalBefore: before,
    weekTotalAfter: before + netAfterSettlement,
    numbersLeavingPool: [input.candidate.number],
    numbersReturningToPool: [],
    weeksReopening: [],
    weeksSettling:
      settlement > 0
        ? [
            {
              weekNumber: input.week.weekNumber,
              memberName: input.candidate.memberName,
              amount: settlement,
            },
          ]
        : [],
    // The group now owes this member their payout.
    cashPositionDelta: netAfterSettlement,
    // Adding a winner can never leave a week empty.
    freedWeek: null,
  };
}

export function removeWinnerPreview(input: {
  week: WeekWinners;
  payout: WinnerPayout;
  /**
   * Numbers left in the drawn slot after this one leaves. Defaults to the
   * week's other payouts, which is the ordinary case (payout and slot member
   * always move together).
   */
  slotNumbersAfter?: readonly number[];
}): WinnerEditPreview {
  const before = totalNet(input.week.payouts);
  const slotNumbersAfter =
    input.slotNumbersAfter ??
    input.week.payouts.filter((p) => p.payoutId !== input.payout.payoutId).map((p) => p.number);
  return {
    weekTotalBefore: before,
    weekTotalAfter: before - input.payout.net,
    numbersLeavingPool: [],
    // THE distinction from "delete payout": the number comes back.
    numbersReturningToPool: [input.payout.number],
    weeksReopening:
      input.payout.settlement > 0
        ? [
            {
              weekNumber: input.week.weekNumber,
              memberName: input.payout.memberName,
              amount: input.payout.settlement,
            },
          ]
        : [],
    weeksSettling: [],
    cashPositionDelta: -input.payout.net,
    freedWeek: freesTheWeek({
      week: input.week,
      leavingPayoutId: input.payout.payoutId,
      slotNumbersAfter,
    }),
  };
}

/**
 * Moving a winner from one week to another — drawn or not.
 *
 * The settlement FOLLOWS the payout, because the rule is "the winner does not
 * pay the week they win" — so week A's contribution becomes owed again and
 * week B's settles. Both halves are stated; a move that silently left the old
 * week settled would hand the member a free week.
 *
 * If A had no other winner, A becomes UNDRAWN and selectable again — reported
 * in `freedWeek`, because a week quietly changing state is exactly what left
 * week 6 stranded.
 */
export function movePayoutPreview(input: {
  from: WeekWinners;
  to: WeekWinners;
  payout: WinnerPayout;
  /** The member's terms, to compute the NEW week's settlement. */
  candidate: Pick<WinnerCandidate, "weeklyAmount" | "startWeek" | "weeksCommitted" | "memberName">;
  /** What they have already paid toward the destination week. */
  alreadyPaidOnTarget?: number;
  /** Numbers left in the SOURCE slot after this one leaves. */
  slotNumbersAfter?: readonly number[];
}): WinnerEditPreview & {
  fromTotalAfter: number;
  toTotalAfter: number;
} {
  const fromBefore = totalNet(input.from.payouts);
  const toBefore = totalNet(input.to.payouts);

  // Give back what the old week took, then take what the new week is owed.
  const grossNet = input.payout.net + input.payout.settlement;
  const newSettlement = settlementFor({
    candidate: input.candidate,
    weekNumber: input.to.weekNumber,
    weekIsSkipped: input.to.isSkipped,
    alreadyPaid: input.alreadyPaidOnTarget,
  });
  const movedNet = Math.max(0, grossNet - newSettlement);

  return {
    // The "week total" figures describe the DESTINATION, which is where the
    // organizer's attention is; both weeks are reported separately below.
    weekTotalBefore: toBefore,
    weekTotalAfter: toBefore + movedNet,
    fromTotalAfter: fromBefore - input.payout.net,
    toTotalAfter: toBefore + movedNet,
    numbersLeavingPool: [],
    numbersReturningToPool: [],
    weeksReopening:
      input.payout.settlement > 0
        ? [
            {
              weekNumber: input.from.weekNumber,
              memberName: input.payout.memberName,
              amount: input.payout.settlement,
            },
          ]
        : [],
    weeksSettling:
      newSettlement > 0
        ? [
            {
              weekNumber: input.to.weekNumber,
              memberName: input.candidate.memberName,
              amount: newSettlement,
            },
          ]
        : [],
    // The payout still exists; only its size changes with the settlement swap.
    cashPositionDelta: movedNet - input.payout.net,
    freedWeek: freesTheWeek({
      week: input.from,
      leavingPayoutId: input.payout.payoutId,
      slotNumbersAfter:
        input.slotNumbersAfter ??
        input.from.payouts
          .filter((p) => p.payoutId !== input.payout.payoutId)
          .map((p) => p.number),
    }),
  };
}

/** One sentence per consequence, for the confirmation dialog. */
export function previewSentences(preview: WinnerEditPreview, formatMoney: (c: number) => string): string[] {
  const lines: string[] = [];
  lines.push(
    `This week's total goes from ${formatMoney(preview.weekTotalBefore)} to ${formatMoney(preview.weekTotalAfter)}.`,
  );
  if (preview.numbersLeavingPool.length > 0) {
    const list = preview.numbersLeavingPool.map((n) => `#${n}`).join(", ");
    lines.push(
      `${list} ${preview.numbersLeavingPool.length === 1 ? "leaves" : "leave"} the wheel pool.`,
    );
  }
  if (preview.numbersReturningToPool.length > 0) {
    const list = preview.numbersReturningToPool.map((n) => `#${n}`).join(", ");
    lines.push(
      `${list} ${preview.numbersReturningToPool.length === 1 ? "returns" : "return"} to the wheel pool.`,
    );
  }
  for (const s of preview.weeksSettling) {
    lines.push(
      `${s.memberName}'s week-${s.weekNumber} contribution of ${formatMoney(s.amount)} settles from the payout.`,
    );
  }
  for (const r of preview.weeksReopening) {
    lines.push(
      `${r.memberName}'s week-${r.weekNumber} contribution of ${formatMoney(r.amount)} becomes owed again.`,
    );
  }
  if (preview.cashPositionDelta !== 0) {
    const up = preview.cashPositionDelta > 0;
    lines.push(
      `Money committed to payouts ${up ? "rises" : "falls"} by ${formatMoney(Math.abs(preview.cashPositionDelta))}.`,
    );
  }
  // Last, because it is the biggest change of state: a week changes from
  // drawn to undrawn and re-enters every picker.
  if (preview.freedWeek) {
    const { weekNumber, numbersReturning } = preview.freedWeek;
    lines.push(
      `Week ${weekNumber} is left with no winner, so its draw is removed and the week becomes ` +
        `UNDRAWN — selectable again everywhere` +
        (numbersReturning.length > 0
          ? `, and ${numbersReturning.map((n) => `#${n}`).join(", ")} ${numbersReturning.length === 1 ? "returns" : "return"} to the wheel pool.`
          : "."),
    );
  }
  return lines;
}
