// Pure consequence math for the two DIFFERENT deletions (2.23: the
// organizer must never guess which one they are doing):
//
//   DELETE PAYOUT — the money record was wrong. The DRAW STANDS, the number
//   stays drawn and does NOT return to the wheel. Any week settled from that
//   payout becomes owed again.
//
//   UNDO THE DRAW — the week was not drawn. The draw AND its payouts are
//   removed, settled weeks reopen, and the numbers RETURN TO THE WHEEL POOL.

export type UndoDrawPayout = {
  payoutId: string;
  number: number;
  /** Current net (already reduced by any week settlement) — what crosses the table. */
  netAmount: number;
  status: "PENDING" | "COLLECTED";
  /** Cents settled onto the winner's own week from this payout (0 = none). */
  settlementAmount: number;
};

export type UndoDrawConsequences = {
  weekNumber: number;
  payoutCount: number;
  /** Net across all payouts being removed. */
  totalNet: number;
  collectedCount: number;
  /** Money already handed over whose record would be un-recorded. */
  collectedNet: number;
  /** Every number in the drawn slot returns to the wheel pool. */
  numbersReturning: number[];
  /** Settled win-weeks that become owed again. */
  unsettled: { number: number; amount: number }[];
  /** Collected money is being un-recorded — demand a typed confirmation. */
  highStakes: boolean;
};

export function undoDrawConsequences(input: {
  weekNumber: number;
  slotNumbers: readonly number[];
  payouts: readonly UndoDrawPayout[];
}): UndoDrawConsequences {
  const collected = input.payouts.filter((p) => p.status === "COLLECTED");
  return {
    weekNumber: input.weekNumber,
    payoutCount: input.payouts.length,
    totalNet: input.payouts.reduce((sum, p) => sum + p.netAmount, 0),
    collectedCount: collected.length,
    collectedNet: collected.reduce((sum, p) => sum + p.netAmount, 0),
    numbersReturning: [...input.slotNumbers].sort((a, b) => a - b),
    unsettled: input.payouts
      .filter((p) => p.settlementAmount > 0)
      .map((p) => ({ number: p.number, amount: p.settlementAmount }))
      .sort((a, b) => a.number - b.number),
    highStakes: collected.length > 0,
  };
}

export type DeletePayoutConsequences = {
  number: number;
  netAmount: number;
  status: "PENDING" | "COLLECTED";
  /** The week settled from this payout that becomes owed again (null = none). */
  reopensWeek: { weekNumber: number; amount: number } | null;
  /** The draw stands: the number stays drawn, never returns to the pool. */
  drawStands: true;
  highStakes: boolean;
};

export function deletePayoutConsequences(input: {
  number: number;
  netAmount: number;
  status: "PENDING" | "COLLECTED";
  settlement: { weekNumber: number; amount: number } | null;
}): DeletePayoutConsequences {
  return {
    number: input.number,
    netAmount: input.netAmount,
    status: input.status,
    reopensWeek:
      input.settlement && input.settlement.amount > 0
        ? { weekNumber: input.settlement.weekNumber, amount: input.settlement.amount }
        : null,
    drawStands: true,
    highStakes: input.status === "COLLECTED",
  };
}
