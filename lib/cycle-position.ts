// THE WHOLE-CYCLE MONEY PICTURE — the number the organizer has calculated by
// hand for six years.
//
// In his words: "am I in negative, am I using someone else's money, or am I on
// track." And: "if it's negative, I'm using other people's money. If it's
// positive, I'm good. And if I have to borrow, I know how much."
//
// PAID AHEAD IS THE PIECE HE CANNOT SEE TODAY. Money received for weeks that
// have NOT yet elapsed is not this cycle's collection — it is owed forward. A
// cash balance that looks healthy because four people paid three weeks early
// is not healthy, and nothing in the platform said so.
//
// ONE DERIVATION. Every per-week figure comes from `receiptsByWeek`
// (lib/dashboard.ts) — the same rows the dashboard's own cards and charts are
// built from, already carrying `expected`, `received` and `elapsed`. Nothing
// here recomputes what a week owes or when its window closed; the elapsed
// boundary is each week's OWN stored date (2.14), decided once in
// `elapsedThroughWeek` and stamped onto the series.
//
// Nothing is stored. The single stored fact in this whole feature is the cash
// READING the organizer enters, and it lives outside this module.

import type { WeekReceipts } from "./dashboard";

export type OwingMember = {
  participationId: string;
  name: string;
  /** Cents they are short across elapsed weeks. */
  amount: number;
};

export type AheadMember = {
  participationId: string;
  name: string;
  /** Cents they have paid toward weeks that have not elapsed. */
  amount: number;
  /** How many not-yet-elapsed weeks their money reaches. */
  weeks: number;
};

export type CollectionPosition = {
  /** Sum of every ELAPSED week's expectation. */
  shouldHaveCollected: number;
  /** What actually came in for those elapsed weeks. */
  collected: number;
  /** shouldHaveCollected − collected, never negative. */
  shortfall: number;
  /** Who makes the shortfall up, largest first. */
  owedBy: OwingMember[];
  /** Money received for weeks that have NOT elapsed — owed forward. */
  paidAhead: number;
  /** Who paid ahead, largest first. */
  aheadBy: AheadMember[];
  /** The last week whose payment window has closed. */
  elapsedThroughWeek: number;
};

/**
 * What should have been collected by now, what actually was, and — the part
 * that was invisible — what has been paid toward weeks that have not happened.
 */
export function collectionPosition(input: {
  /** From `receiptsByWeek`, already carrying `elapsed` per week. */
  series: readonly WeekReceipts[];
  owedBy: readonly OwingMember[];
  aheadBy: readonly AheadMember[];
}): CollectionPosition {
  const elapsed = input.series.filter((w) => w.elapsed);
  const ahead = input.series.filter((w) => !w.elapsed);

  const shouldHaveCollected = elapsed.reduce((s, w) => s + w.expected, 0);
  const collected = elapsed.reduce((s, w) => s + w.received, 0);

  return {
    shouldHaveCollected,
    collected,
    shortfall: Math.max(0, shouldHaveCollected - collected),
    owedBy: [...input.owedBy].filter((m) => m.amount > 0).sort((a, b) => b.amount - a.amount),
    // Money sitting on weeks that have not happened yet. NOT this cycle's
    // collection, and not his to spend.
    paidAhead: ahead.reduce((s, w) => s + w.received, 0),
    aheadBy: [...input.aheadBy].filter((m) => m.amount > 0).sort((a, b) => b.amount - a.amount),
    elapsedThroughWeek: elapsed.reduce((max, w) => Math.max(max, w.weekNumber), 0),
  };
}

// ————————————————— What he SHOULD be holding —————————————————

export type ExpectedHolding = {
  /** received − paid out. What the books say is in his hands. */
  expected: number;
  /** Of that: money for weeks that have not happened. Not his to spend. */
  owedForward: number;
  /** Of that: drawn but not yet handed over. Already promised. */
  committedToPayouts: number;
  /** Of that: fee on payouts already handed over. GENUINELY HIS. */
  feeEarned: number;
  /** Fee on payouts drawn but not yet collected — his once they are paid. */
  feeCommitted: number;
  /** What is left after the three claims above. Can be negative. */
  uncommitted: number;
};

/**
 * The expected cash position, with the parts separated.
 *
 * THE FEE IS WHY THIS IS NOT ONE NUMBER. A positive balance may simply be his
 * fee accumulating rather than a surplus — the group hands the winner NET and
 * keeps the fee, so every collected payout leaves its fee behind in the same
 * pot as everyone's contributions. Reporting "you're up $8,000" without saying
 * that $8,350 of it is fee tells him he has slack he does not have.
 */
export function expectedHolding(input: {
  totalReceived: number;
  /** Net actually handed over. */
  totalPaidOut: number;
  /** Net of payouts drawn but not yet collected. */
  committedPending: number;
  /** Fee on COLLECTED payouts. */
  feeOnCollected: number;
  /** Fee on PENDING payouts. */
  feeOnPending: number;
  /** From collectionPosition — money on weeks that have not elapsed. */
  paidAhead: number;
}): ExpectedHolding {
  const expected = input.totalReceived - input.totalPaidOut;
  return {
    expected,
    owedForward: input.paidAhead,
    committedToPayouts: input.committedPending,
    feeEarned: input.feeOnCollected,
    feeCommitted: input.feeOnPending,
    // Deliberately allowed to go negative: that IS the "I am using other
    // people's money" signal, and clamping it would hide exactly the thing
    // he has been calculating by hand for six years.
    uncommitted:
      expected - input.paidAhead - input.committedPending - input.feeOnCollected,
  };
}

// ————————————————— The answer, in plain English —————————————————

export type PositionVerdict = {
  kind: "covered" | "surplus" | "short" | "exact";
  /** actual − expected. Positive means he holds more than the books say. */
  difference: number;
  /**
   * What he holds beyond everything owed out and owed forward. Negative means
   * he could not meet his obligations from what is in hand.
   */
  coverage: number;
  /** The sentence. Never just a number. */
  sentence: string;
  /** When short: what he would have to find. */
  shortBy: number;
};

/**
 * Compare what he should be holding with what he says he actually holds, and
 * say what it MEANS.
 *
 * Two different questions, and both get answered, because either alone
 * misleads:
 *
 *   DIFFERENCE — does the cash agree with the books? A gap here is an error
 *                somewhere: an unrecorded receipt, a payout handed over
 *                without being marked, or money spent.
 *   COVERAGE   — can he meet what he owes from what he holds? This is the
 *                "am I using other people's money" question, and it can be
 *                bad even when the books agree perfectly.
 */
export function positionVerdict(input: {
  expected: ExpectedHolding;
  /** The organizer's entered reading, in cents. */
  actual: number;
  formatMoney: (cents: number) => string;
}): PositionVerdict {
  const money = input.formatMoney;
  const difference = input.actual - input.expected.expected;
  // Everything that is not his: money owed forward, and money promised to
  // winners already drawn.
  const owed = input.expected.owedForward + input.expected.committedToPayouts;
  const coverage = input.actual - owed;

  if (coverage < 0) {
    const shortBy = -coverage;
    return {
      kind: "short",
      difference,
      coverage,
      shortBy,
      sentence:
        (difference === 0
          ? `You hold exactly what the books say. `
          : difference < 0
            ? `You hold ${money(-difference)} LESS than expected. `
            : `You hold ${money(difference)} MORE than expected. `) +
        `You are short by ${money(shortBy)} against what members are owed — ` +
        `${money(input.expected.committedToPayouts)} is promised to winners already drawn and ` +
        `${money(input.expected.owedForward)} was paid toward weeks that have not happened yet. ` +
        `You would need to cover that before the next payout.`,
    };
  }

  if (difference === 0) {
    return {
      kind: "exact",
      difference,
      coverage,
      shortBy: 0,
      sentence:
        `You hold exactly what the books say. ` +
        `${money(input.expected.feeEarned)} of it is your fee, so you are covered.`,
    };
  }

  if (difference > 0) {
    return {
      kind: "surplus",
      difference,
      coverage,
      shortBy: 0,
      sentence:
        `You hold ${money(difference)} MORE than expected. ` +
        // The fee is named first because it is the usual explanation for a
        // healthy-looking balance, and mistaking it for slack is the error.
        `${money(input.expected.feeEarned)} of what you hold is your fee, so you are covered.`,
    };
  }

  return {
    kind: "covered",
    difference,
    coverage,
    shortBy: 0,
    sentence:
      `You hold ${money(-difference)} LESS than expected, but still enough to cover ` +
      `everything owed — ${money(coverage)} clear. ` +
      `${money(input.expected.feeEarned)} of what you hold is your fee. ` +
      `The gap is worth explaining: a receipt not recorded, or a payout handed over ` +
      `without being marked collected.`,
  };
}

/**
 * The collection sentence, for the page header — the same register as the
 * dashboard's cash sentence.
 */
export function collectionSentence(
  p: CollectionPosition,
  formatMoney: (cents: number) => string,
): string {
  const head =
    `Through week ${p.elapsedThroughWeek}, ${formatMoney(p.shouldHaveCollected)} should have come in ` +
    `and ${formatMoney(p.collected)} has.`;
  const short =
    p.shortfall > 0
      ? ` ${formatMoney(p.shortfall)} is outstanding, from ${p.owedBy.length} member${p.owedBy.length === 1 ? "" : "s"}.`
      : " Nothing is outstanding.";
  const ahead =
    p.paidAhead > 0
      ? ` A further ${formatMoney(p.paidAhead)} has been paid toward weeks that have not happened yet, ` +
        `by ${p.aheadBy.length} member${p.aheadBy.length === 1 ? "" : "s"} — that money is owed forward, not collected.`
      : "";
  return head + short + ahead;
}
