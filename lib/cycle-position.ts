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

export type CashOnHand = {
  /** Every cent members have handed in. */
  collected: number;
  /**
   * Money that has actually left — payouts marked COLLECTED, and nothing else.
   *
   * A payout that is DRAWN BUT NOT HANDED OVER is still cash in his hand. It is
   * promised, and promised is not gone. Subtracting it would tell him he holds
   * less than he does, which is the direction that makes an organizer borrow
   * money he did not need to borrow.
   */
  handedOut: number;
  /** collected − handedOut. What should be in the bank and the tin. */
  shouldBeHolding: number;

  // ————— Two plain statements ABOUT that figure, not subtractions from it ————

  /** Of what he holds: money paid for weeks that have not happened yet. */
  paidEarly: number;
  /** Of what he holds: payouts drawn, not yet handed over. */
  drawnNotHandedOut: number;
};

/**
 * What the organizer might keep if the cycle finishes as planned.
 *
 * DELIBERATELY NOT PART OF THE CASH POSITION. A cash position is FACTS: money
 * in, money out, what is left. This is a projection — it depends on how the
 * cycle finishes, on whether every remaining payout is actually handed over,
 * and on nobody being written off. Mixing a projection into a statement of
 * fact makes the whole figure less trustworthy, and the organizer stops
 * believing any of it.
 *
 * Shown separately, labelled an estimate, never subtracted from anything.
 */
export type FeeEstimate = {
  /** Fee on payouts already handed over — the settled part of the estimate. */
  soFar: number;
  /** Fee on payouts drawn but not yet handed over. */
  ifRemainingPayoutsComplete: number;
  /** The two together. Still an estimate: the cycle is not finished. */
  total: number;
};

/**
 * WHAT HE SHOULD BE HOLDING — three facts, and nothing else.
 *
 * Money in, money out, what is left. That is a cash position, and every part of
 * it is something that has already happened.
 *
 * WHAT IS NOT IN IT, AND WHY:
 *
 *   THE FEE. It used to be subtracted here as a component of what he holds.
 *   It is a PROJECTION — what he might keep depending on how the cycle
 *   finishes — and folding a projection into a statement of fact makes the
 *   whole figure less trustworthy. See {@link feeEstimate}, which reports it
 *   separately and labelled.
 *
 *   PAYOUTS DRAWN BUT NOT HANDED OVER. Only money that has actually LEFT
 *   reduces what he holds. A drawn payout is promised, and promised is not
 *   gone — the cash is still in the tin. Subtracting it understates what he
 *   has, which is the direction that makes an organizer borrow money he did
 *   not need to borrow.
 *
 * Both still appear on the screen. They are stated as sentences ABOUT the
 * figure, never as arithmetic inside it.
 */
export function cashOnHand(input: {
  /** Every cent members have handed in. */
  collected: number;
  /** Payouts marked COLLECTED. Not the drawn ones. */
  handedOut: number;
  /** Payouts drawn but not yet handed over — reported, never subtracted. */
  drawnNotHandedOut: number;
  /** From collectionPosition — money on weeks that have not elapsed. */
  paidEarly: number;
}): CashOnHand {
  return {
    collected: input.collected,
    handedOut: input.handedOut,
    shouldBeHolding: input.collected - input.handedOut,
    paidEarly: input.paidEarly,
    drawnNotHandedOut: input.drawnNotHandedOut,
  };
}

/** The fee, as an estimate, kept away from the cash position. */
export function feeEstimate(input: {
  /** Fee on payouts already handed over. */
  onHandedOut: number;
  /** Fee on payouts drawn but not yet handed over. */
  onDrawn: number;
}): FeeEstimate {
  return {
    soFar: input.onHandedOut,
    ifRemainingPayoutsComplete: input.onDrawn,
    total: input.onHandedOut + input.onDrawn,
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
  cash: CashOnHand;
  /** The organizer's entered reading, in cents. */
  actual: number;
  formatMoney: (cents: number) => string;
}): PositionVerdict {
  const money = input.formatMoney;
  const difference = input.actual - input.cash.shouldBeHolding;
  // What he is holding for somebody else: money paid early for weeks that have
  // not happened, and payouts drawn but not yet handed over. Both are real
  // cash in his hand today and both have to come out of it later. The FEE is
  // deliberately absent — it is an estimate, and a question about whether he
  // can meet what he owes must not lean on one.
  const holdingForOthers = input.cash.paidEarly + input.cash.drawnNotHandedOut;
  const coverage = input.actual - holdingForOthers;

  const versusBooks =
    difference === 0
      ? "You hold exactly what the books say."
      : difference < 0
        ? `You hold ${money(-difference)} LESS than the books say.`
        : `You hold ${money(difference)} MORE than the books say.`;

  if (coverage < 0) {
    const shortBy = -coverage;
    return {
      kind: "short",
      difference,
      coverage,
      shortBy,
      sentence:
        `${versusBooks} You are short by ${money(shortBy)} against what you owe: ` +
        `${money(input.cash.drawnNotHandedOut)} is drawn but not handed out yet, and ` +
        `${money(input.cash.paidEarly)} was paid early for weeks that have not happened. ` +
        `You would need to find that before the next payout.`,
    };
  }

  if (difference === 0) {
    return {
      kind: "exact",
      difference,
      coverage,
      shortBy: 0,
      sentence:
        `${versusBooks} After the ${money(holdingForOthers)} you are holding for other ` +
        `people, ${money(coverage)} is yours to use.`,
    };
  }

  if (difference > 0) {
    return {
      kind: "surplus",
      difference,
      coverage,
      shortBy: 0,
      sentence:
        `${versusBooks} After the ${money(holdingForOthers)} you are holding for other ` +
        `people, ${money(coverage)} is yours to use. Worth finding where the extra came ` +
        `from — a payment recorded twice, or one handed out and not marked.`,
    };
  }

  return {
    kind: "covered",
    difference,
    coverage,
    shortBy: 0,
    sentence:
      `${versusBooks} You can still cover everything — after the ` +
      `${money(holdingForOthers)} you are holding for other people, ${money(coverage)} is ` +
      `yours to use. The gap is worth explaining: a payment not recorded, or a payout ` +
      `handed over without being marked.`,
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
