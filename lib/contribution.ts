// WHAT A MEMBER HAS SAVED (ground truth 2.1, 2.14).
//
// This is a SAVINGS group. The number a member cares about most is how much
// they have put in — and the platform used to state only what they owed. These
// are the three figures, kept deliberately separate because conflating them is
// exactly the mistake that made the whole app read as debt collection:
//
//   PAID IN       what they have actually contributed. The headline.
//   STILL TO SAVE the rest of their commitment. NOT a debt — a member who is
//                 perfectly current still has most of it ahead of them.
//   OVERDUE       money owed RIGHT NOW: only weeks whose payment window has
//                 already closed (2.16, and the stored-date elapsed rule).
//
// Everything here is DERIVED (2.14). Total contributed is the sum of the
// member's payment EVENTS — the receipts — never a stored column, so it can
// never drift from what was actually received.

/** A receipt as stored: one payment event, in cents. */
export type ContributionReceipt = { amount: number };

export type Contribution = {
  /** Every cent received from them, summed from their receipts. */
  paidIn: number;
  /** The whole commitment: weekly amount x weeks committed. */
  commitmentTotal: number;
  /**
   * What is LEFT of the commitment — the saving still ahead of them. Never
   * negative: paying beyond the commitment is surplus, not a negative target.
   */
  stillToSave: number;
  /**
   * What is owed TODAY — elapsed weeks only. Supplied by the standing engine
   * (amountOutstanding), never recomputed here, so this figure and the LATE
   * markers can never disagree.
   */
  overdue: number;
  /** Whole weeks their money covers at the current rate, capped at the commitment. */
  weeksCovered: number;
  weeksCommitted: number;
  /** 0..1 for a progress indicator. 1 once the commitment is fully saved. */
  progress: number;
  /** Money beyond the whole commitment (a genuine overpayment). */
  surplus: number;
};

function assertCents(name: string, cents: number): void {
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError(`${name} must be an integer number of cents, got ${cents}`);
  }
  if (cents < 0) throw new RangeError(`${name} must not be negative, got ${cents}`);
}

/**
 * Sum the receipts. THE definition of total contributed (2.14): a payment
 * event is the stored fact that money was received, so this can never
 * disagree with the record.
 */
export function totalContributed(receipts: readonly ContributionReceipt[]): number {
  let total = 0;
  for (const [i, r] of receipts.entries()) {
    assertCents(`receipt[${i}] amount`, r.amount);
    total += r.amount;
  }
  return total;
}

/**
 * The three figures together, from the receipts and the commitment.
 *
 * `overdue` comes from the standing engine rather than being derived here on
 * purpose: what is owed depends on which weeks have elapsed, which depends on
 * each week's own stored date (2.14). One rule, one place.
 */
export function contribution(input: {
  receipts: readonly ContributionReceipt[];
  weeklyAmount: number;
  weeksCommitted: number;
  /** amountOutstanding from computeStanding — elapsed weeks only. */
  overdue: number;
}): Contribution {
  assertCents("weeklyAmount", input.weeklyAmount);
  assertCents("overdue", input.overdue);
  if (!Number.isSafeInteger(input.weeksCommitted) || input.weeksCommitted < 0) {
    throw new RangeError(`weeksCommitted must be a non-negative integer, got ${input.weeksCommitted}`);
  }

  const paidIn = totalContributed(input.receipts);
  const commitmentTotal = input.weeklyAmount * input.weeksCommitted;
  const stillToSave = Math.max(0, commitmentTotal - paidIn);
  const surplus = Math.max(0, paidIn - commitmentTotal);
  const weeksCovered =
    input.weeklyAmount > 0
      ? Math.min(Math.floor(paidIn / input.weeklyAmount), input.weeksCommitted)
      : 0;

  return {
    paidIn,
    commitmentTotal,
    stillToSave,
    overdue: input.overdue,
    weeksCovered,
    weeksCommitted: input.weeksCommitted,
    progress: commitmentTotal > 0 ? Math.min(1, paidIn / commitmentTotal) : 0,
    surplus,
  };
}

/**
 * The plain sentence under the headline. It must never imply debt when there
 * is none: a member who is current has plenty still to save and owes nothing,
 * and the screen has to say exactly that.
 */
export function savingSummary(c: Contribution): string {
  if (c.stillToSave === 0) {
    return c.overdue > 0
      ? "Your whole commitment is saved, and an earlier week is still open."
      : "Your whole commitment is saved.";
  }
  return c.overdue > 0
    ? "still to save — and one or more closed weeks are unpaid."
    : "still to save. Nothing is overdue.";
}
