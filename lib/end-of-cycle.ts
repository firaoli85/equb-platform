// WHERE THE CYCLE FINISHES — the organizer's own calculation, computed.
//
// He did this on paper and got a different answer from the screen: he made it
// about $875 short, the screen said $6,325. Both were right, about DIFFERENT
// QUESTIONS, and nothing on the page said so.
//
//   THE CASH POSITION asks: does the money in front of me match what the books
//   say I collected minus what I handed over? It looks BACKWARD, at money that
//   has already moved. A gap there is an error to find.
//
//   THIS asks: if everyone pays what they owe and I pay what I owe, where does
//   the cycle end up? It looks FORWARD, over money that has not moved yet. A
//   gap here is a hole to plan for.
//
// They share almost no inputs and they should not agree. Showing one without
// the other is what made him work the second out by hand every week.
//
// ————————————————— THE ARITHMETIC IS HIS, AND IT WAS RIGHT —————————————————
//
// Reconciled against the live cycle line by line. Four of his five lines
// matched to the cent. The one that did not was the one he had no way to know:
// a member he owes money back to, who is not "awaiting their turn" and so
// appeared nowhere in his sum.
//
// THE FEE IS INSIDE THE PAYOUT FIGURE AND NOWHERE ELSE. A payout hands over
// the pot LESS the fee, so the fee never leaves the tin. Counting the pot at
// its full size and then adding the fee back as income counts it twice; that
// is the single easiest mistake to make here, and `lib/end-of-cycle.test.ts`
// scans this file to make sure no fee term is ever added or subtracted outside
// `payoutsStillToGoOut`. The fee is reported on the page as a fact about the
// figure, never as a term in it.
//
// THE POT IS PER NUMBER, NOT PER MEMBER, AND NOT A FIXED TWENTY WEEKS. It is
// the number's own amount times the weeks that member signed up for. Henok is
// a ten-week member and Alex a fifteen-week one; treating everyone as twenty
// overstates what is still to go out by tens of thousands, which is exactly
// the error a first pass at this made.

export type RefundOwed = {
  participationId: string;
  name: string;
  /** Their paid-in less the fee on their whole commitment (§2.30). */
  amount: number;
  /**
   * Whether the organizer has said this belongs in the projection.
   *
   * FALSE DOES NOT MEAN FORGIVEN. He still owes it and the page still says so
   * — it means he is settling it outside the cycle's money, so it does not
   * belong in this particular sum.
   */
  counted: boolean;
};

export type EndOfCycle = {
  // ————— coming in —————
  /** Contributions on weeks that have not happened yet, not already paid. */
  futureContributions: number;
  /** Money owed on weeks that HAVE happened and did not arrive. */
  arrears: number;
  comingIn: number;

  // ————— going out —————
  /**
   * Every payout still to be drawn, at what actually crosses the table.
   *
   * The fee is ALREADY TAKEN OUT of this figure. It is not a separate line and
   * it must never become one.
   */
  payoutsStillToGoOut: number;
  /** Refunds he has said to count. Excluded ones are not in here. */
  refundsCounted: number;
  goingOut: number;

  // ————— in hand —————
  /** His latest counted reading. Null when he has never entered one. */
  inHand: number;

  /** inHand + comingIn − goingOut. Negative means the cycle finishes short. */
  endOfCycle: number;

  // ————— stated, never added —————
  /**
   * The fee he will keep on the payouts still to come.
   *
   * REPORTED ONLY. It is already inside `payoutsStillToGoOut`, and adding it
   * anywhere would count it twice.
   */
  feeStillToEarn: number;
  /** Every refund he owes, counted or not — the obligation is never hidden. */
  refundsOwedInFull: number;
  /** The refunds he has chosen to settle his own way. */
  refundsHandledByHand: number;
  refunds: RefundOwed[];
};

/**
 * One number for "will this balance when it is done".
 *
 * EVERY INPUT IS ALREADY DERIVED SOMEWHERE ELSE. This adds and subtracts; it
 * does not decide what a week expects, what a payout is worth or what a
 * stopped member is owed. Those live in `receiptsByWeek`, `calculatePayout`
 * and `recoverableForUndrawn`, and this reads their answers so a change to any
 * rule reaches here without this file being edited.
 */
export function endOfCycle(input: {
  /** Expected on weeks after the current one, less what is already paid. */
  futureContributions: number;
  /** Sum of the per-week gaps on weeks that have elapsed. */
  arrears: number;
  /** Remaining payouts at what crosses the table, fee already removed. */
  payoutsStillToGoOut: number;
  /** The fee inside that figure. Reported, never added. */
  feeStillToEarn: number;
  /** Everyone he owes money back to, each carrying its own choice. */
  refunds: readonly RefundOwed[];
  /** His latest counted cash reading. */
  inHand: number;
}): EndOfCycle {
  const refundsCounted = input.refunds.filter((r) => r.counted).reduce((s, r) => s + r.amount, 0);
  const refundsOwedInFull = input.refunds.reduce((s, r) => s + r.amount, 0);

  const comingIn = input.futureContributions + input.arrears;
  const goingOut = input.payoutsStillToGoOut + refundsCounted;

  return {
    futureContributions: input.futureContributions,
    arrears: input.arrears,
    comingIn,
    payoutsStillToGoOut: input.payoutsStillToGoOut,
    refundsCounted,
    goingOut,
    inHand: input.inHand,
    endOfCycle: input.inHand + comingIn - goingOut,
    feeStillToEarn: input.feeStillToEarn,
    refundsOwedInFull,
    refundsHandledByHand: refundsOwedInFull - refundsCounted,
    refunds: [...input.refunds],
  };
}

/**
 * THE SENTENCE. Never just a number, and never without its assumption.
 *
 * THE ASSUMPTION IS PART OF THE ANSWER. This whole figure rests on every
 * remaining contribution arriving, and one more member stopping after being
 * paid out moves it by thousands — which has already happened once on this
 * cycle. A projection stated without that line invites him to treat it as
 * settled fact, and it is not one.
 *
 * "net" is deliberately absent, along with the rest of the accounting
 * register. It is on the banned list in lib/cycle-position.test.ts because
 * every word there made him stop and translate.
 */
export function endOfCycleSentence(
  p: EndOfCycle,
  money: (cents: number) => string,
  hasReading: boolean,
): string {
  if (!hasReading) {
    return (
      `Enter what you are holding and this will finish the sum. ` +
      `${money(p.comingIn)} is still due in and ${money(p.goingOut)} still has to go out.`
    );
  }

  const head =
    p.endOfCycle === 0
      ? `The cycle finishes level.`
      : p.endOfCycle < 0
        ? `The cycle finishes ${money(-p.endOfCycle)} short.`
        : `The cycle finishes with ${money(p.endOfCycle)} left over.`;

  const tail =
    p.endOfCycle < 0
      ? ` That is what you would have to find yourself before the last payout.`
      : p.endOfCycle > 0
        ? ` That is still equb money until the cycle closes, not yours to spend.`
        : ``;

  return (
    `${head}${tail} This assumes every remaining contribution arrives. ` +
    `One more member stopping after being paid out moves it, and that has ` +
    `already happened once.`
  );
}
