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

// ————————————————— EVERY WEEK LANDS IN EXACTLY ONE BUCKET —————————————————
//
// THE BUG THIS EXISTS TO MAKE IMPOSSIBLE. The first version of this feature
// bucketed the weeks in the action, with two INDEPENDENT filters:
//
//     arrears = series.filter((w) => w.elapsed)
//     future  = series.filter((w) => w.weekNumber > currentWeek)
//
// Those read two DIFFERENT CLOCKS. `elapsed` is the last week whose payment
// WINDOW has closed; `currentWeek` is the last week whose DATE has arrived, and
// a week's window stays open for days after it starts. So the week the cycle is
// actually IN satisfied neither condition, and every cent still to come for it
// vanished out of the sum.
//
// On the live cycle that was week 14 and $12,125 — the projection said the
// cycle would finish $12,750 short when the true figure was $625. It made the
// organizer's own weekly arithmetic look wrong when it was right.
//
// TWO FILTERS CANNOT PARTITION ANYTHING. A week fell through the middle because
// nothing in the shape of the code said the buckets had to cover everything.
// This classifies each week ONCE, through an if/else chain that has no fall
// through by construction, and `bucketOutstanding` is where any future clock
// question has to be answered — not in a caller.
//
// THREE BUCKETS, NOT TWO, because there are three honest answers. Money missing
// from a week whose window has closed means someone IS late. Money still to
// come for the week we are in means nobody is late yet (2.16 — no screen may
// say a member is behind while their window is open). Money for a week that has
// not arrived is simply not due. Folding the middle one into either end would
// have made the total right and the sentence wrong.

export type OutstandingBuckets = {
  /** Weeks whose window has CLOSED and whose money did not arrive. */
  overdue: number;
  /** The week the cycle is in: arrived, window still open, nobody late. */
  currentWeekOutstanding: number;
  /** Weeks that have not arrived yet. */
  notYetDue: number;
  /** The three added up — every cent still to come in, from any week. */
  total: number;
};

/**
 * Sort every week's uncollected money into exactly one bucket.
 *
 * EXHAUSTIVE BY CONSTRUCTION. One `if / else if / else` over each week, so a
 * week cannot be in two buckets and cannot be in none. `lib/end-of-cycle
 * .test.ts` asserts the partition property over generated weeks as well as the
 * live shape, because "the three add up" is the whole point of this function.
 */
export function bucketOutstanding(input: {
  series: readonly { weekNumber: number; expected: number; received: number; elapsed: boolean }[];
  /** The highest week whose DATE has arrived (`currentWeekFromRows`). */
  currentWeek: number;
}): OutstandingBuckets {
  let overdue = 0;
  let currentWeekOutstanding = 0;
  let notYetDue = 0;

  for (const w of input.series) {
    // Never negative: a week that took in more than it asked for is not a
    // credit against another week's shortfall.
    const uncollected = Math.max(0, w.expected - w.received);
    if (uncollected === 0) continue;

    if (w.elapsed) {
      overdue += uncollected;
    } else if (w.weekNumber <= input.currentWeek) {
      currentWeekOutstanding += uncollected;
    } else {
      notYetDue += uncollected;
    }
  }

  return {
    overdue,
    currentWeekOutstanding,
    notYetDue,
    total: overdue + currentWeekOutstanding + notYetDue,
  };
}

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
  /** Money owed on weeks whose window has CLOSED. Someone is late for these. */
  arrears: number;
  /**
   * Still to come for the week the cycle is IN.
   *
   * Its own line because it is its own fact. The window is open, so nobody is
   * behind for it (2.16), and calling it arrears would accuse members who have
   * done nothing wrong. Leaving it out of the sum entirely is the bug this
   * whole bucketing exists to prevent.
   */
  currentWeekOutstanding: number;
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
  /**
   * THE LIVE POSITION: what the books say he holds right now, `collected −
   * handedOut`. Derived, never declared.
   *
   * IT USED TO BE HIS LATEST COUNTED READING, and that was the same disease
   * this projection was built to cure. A reading is a declaration made at a
   * moment; it is stale as soon as the next payment lands. On the live cycle
   * the reading was eight payments and $9,000 out of date, and every forward
   * figure anchored to it was wrong by that much with nothing on screen saying
   * so.
   *
   * Anchoring to the derived position means recording a payment IS the update.
   * There is no number to go and correct, because there is no second copy.
   */
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
  /** Every week sorted into exactly one bucket, by `bucketOutstanding`. */
  outstanding: OutstandingBuckets;
  /** Remaining payouts at what crosses the table, fee already removed. */
  payoutsStillToGoOut: number;
  /** The fee inside that figure. Reported, never added. */
  feeStillToEarn: number;
  /** Everyone he owes money back to, each carrying its own choice. */
  refunds: readonly RefundOwed[];
  /**
   * THE LIVE POSITION — `collected − handedOut`, never a counted reading.
   * A reading is stale the moment the next payment lands.
   */
  inHand: number;
}): EndOfCycle {
  const refundsCounted = input.refunds.filter((r) => r.counted).reduce((s, r) => s + r.amount, 0);
  const refundsOwedInFull = input.refunds.reduce((s, r) => s + r.amount, 0);

  // EVERY bucket, so nothing can be dropped by forgetting to add one here.
  const comingIn = input.outstanding.total;
  const goingOut = input.payoutsStillToGoOut + refundsCounted;

  return {
    futureContributions: input.outstanding.notYetDue,
    arrears: input.outstanding.overdue,
    currentWeekOutstanding: input.outstanding.currentWeekOutstanding,
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
export function endOfCycleSentence(p: EndOfCycle, money: (cents: number) => string): string {
  // NO "ENTER WHAT YOU ARE HOLDING" BRANCH ANY MORE. This used to refuse to
  // answer until the organizer had typed in a counted reading, because the sum
  // rested on one. It rests on the derived position now, which exists from the
  // first payment onward, so there is always an answer and nothing to enter.
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
