// THE ONE-TRUTH ENGINE — phase 2, the core.
//
// ONE function returns a member's complete current truth
// (docs/ONE_TRUTH_ENGINE.md §3). Every screen, message and total will READ
// from it; nobody recomputes and nobody keeps a second copy. This phase BUILDS
// it and proves it. It wires nothing: after this phase every screen still
// reads its old implementation, and §5 step 2 migrates them one at a time.
//
// WHY THIS IS A NEW MODULE AND NOT AN EDIT TO computeStanding.
// §5 orders the work: (1) build the engine, nothing reads it; (2) migrate
// readers one at a time, each proven identical-or-corrected; (3) retire the
// duplicates LAST — "deleting a derivation before its last reader has moved is
// how a migration turns into an outage". `computeStanding` has nine live
// callers feeding admin screens, the member portal, cycle close and the
// messaging engine. Changing its deferral arithmetic in place would move
// numbers on all nine at once, in a phase whose stated boundary is that no
// screen changes. So the CORRECT D-42 arithmetic lives here, and §6.4's three
// gap sites close when their last reader moves — which is what §6.4 already
// says ("All three close with the engine build").
//
// This module composes the primitives that are already proven rather than
// re-deriving them: `allocatePayment` (2.19, one allocation engine),
// `computeStanding` for coverage, `lib/money.ts` for fee and payout. The
// engine's job is to answer the questions ONCE, not to invent new arithmetic.

import { allocatePayment } from "./allocation";
import { weekHasElapsed, weeksCredited, type PaymentStatusValue } from "./derived";
import { calculateFee, calculateGross, calculateNet } from "./money";
import { computeStanding, type StandingWeekInput } from "./standing";

// ————————————————— THE STATUS PAIR (§3.0 rule 1, §3.3) —————————————————

/** How much of the week's money is in. */
export type WeekMoney = "paid" | "part" | "none";

/**
 * A week's truth as the PAIR it actually is — money AND calendar — never one
 * word (§3.0 rule 1).
 *
 * The single-label ladder could not express PARTIAL + LATE: its window test
 * returned before the money test was reached, so a part-paid week whose window
 * had closed read LATE with money in it, and the chase then told a member who
 * paid $200 that nothing arrived. Callers get the components and decide; the
 * derived `label` below is a convenience for display, never the source.
 */
export type WeekTruth = {
  weekNumber: number;
  /** Their own counting — week 1 is their start week. */
  ownWeekNumber: number;
  date: Date;
  amountDue: number;
  /** The receipt stored on this week's row. */
  amountPaid: number;
  /** What their fungible money covers here at the CURRENT rate. */
  covered: number;
  /** Still owed on THIS week. The figure a late notice must name (§3.7). */
  remainder: number;
  money: WeekMoney;
  /** The calendar half: this week's own window has closed. */
  windowClosed: boolean;
  deferred: boolean;
  skipped: boolean;
  markedLate: boolean;
  /** Derived from the pair for display. Never compute money from this. */
  label: WeekLabel;
};

/**
 * The six display states, including the sixth R2 ruled: part-paid, still owed,
 * still chased.
 */
export type WeekLabel =
  | "PAID"
  | "PARTIAL"
  | "PARTIAL_LATE"
  | "LATE"
  | "DEFERRED"
  | "SKIPPED"
  | "UPCOMING";

/**
 * The label a week shows, derived from the pair.
 *
 * ORDER IS THE RULING (§3.0 rule 1). Money first: a fully covered week reads
 * PAID whenever it arrived, and a skipped week owes nothing at all. Deferral
 * outranks the mark and the calendar (2.29) — the organizer agreed not to
 * chase it, so it can never read LATE. Then the pair: part-paid and closed is
 * its own state, not LATE.
 */
export function weekLabel(w: {
  money: WeekMoney;
  windowClosed: boolean;
  deferred: boolean;
  skipped: boolean;
  markedLate: boolean;
}): WeekLabel {
  if (w.skipped) return "SKIPPED";
  if (w.money === "paid") return "PAID";
  if (w.deferred) return "DEFERRED";
  const chased = w.windowClosed || w.markedLate;
  if (w.money === "part") return chased ? "PARTIAL_LATE" : "PARTIAL";
  return chased ? "LATE" : "UPCOMING";
}

/**
 * Is this week owed RIGHT NOW — is it in the current expectation?
 *
 * D-42 (§2.29a), and the one place that rule is expressed. A deferred week is
 * a pause: not expected this week, not chased, not in "N of M paid" — and
 * never forgiven, because `amountDeferred` keeps its money and rule 4 resolves
 * it at close. A skipped week was owed by nobody.
 */
export function weekCountsNow(w: {
  deferred: boolean;
  skipped: boolean;
  windowClosed: boolean;
  markedLate: boolean;
}): boolean {
  if (w.skipped || w.deferred) return false;
  return w.windowClosed || w.markedLate;
}

// ————————————————— THE TRUTH OBJECT (§3) —————————————————

export type MemberTruth = {
  participationId: string;
  weeklyAmount: number;
  startWeek: number;
  weeksCommitted: number;
  finishWeek: number;

  weeks: WeekTruth[];

  /** Money totals — §3.4. */
  totalPaid: number;
  weeksCredited: number;
  weeksPaid: number;
  /** Elapsed − skipped − DEFERRED − credited, floored at 0 (D-42). */
  weeksBehind: number;
  /** weeklyAmount × elapsed non-deferred, non-skipped weeks (§3.0 rule 5). */
  expectedByNow: number;
  /** Σ remainder over weeks that count NOW. Deferred excluded, rolled (rule 2). */
  amountOutstanding: number;
  /** Σ remainder over DEFERRED weeks. Owed, not expected now, resolves at close. */
  amountDeferred: number;
  surplus: number;
  /** The contiguous fully-paid prefix of their own weeks; null if none. */
  paidUpToWeek: number | null;
  lastPaymentWeek: number | null;
  missingWeekRows: number;

  /** Fee and payout — §3.5, 2.30. */
  feePercent: number;
  grossProjected: number;
  feeProjected: number;
  payoutNet: number;
};

export type MemberTruthInput = {
  participationId: string;
  weeklyAmount: number;
  startWeek: number;
  weeksCommitted: number;
  today: Date;
  /** The member's own week rows, ascending. */
  windowWeeks: readonly StandingWeekInput[];
  totalPaid: number;
  /** Payout-settled cents per week — not fungible. */
  pinnedByWeek?: ReadonlyMap<number, number>;
  /** The cycle's fee percent (2.6 — read from the cycle, never a constant). */
  feePercent: number;
  /** Display only. No money number derives from it (2.14). */
  cycleWeek?: number;
  windowClosesDays?: number;
};

/**
 * A member's complete current truth — the one function (§2).
 *
 * Derives ONCE. Every figure below is computed here and read elsewhere; a
 * caller that recomputes any of them has reintroduced the defect this engine
 * exists to remove.
 */
export function memberTruth(input: MemberTruthInput): MemberTruth {
  // Coverage, pinned settlements and the per-week rows come from the proven
  // nucleus — this engine does not re-implement allocation (2.19).
  const standing = computeStanding({
    weeklyAmount: input.weeklyAmount,
    startWeek: input.startWeek,
    weeksCommitted: input.weeksCommitted,
    cycleWeek: input.cycleWeek ?? 0,
    today: input.today,
    windowWeeks: input.windowWeeks,
    totalPaid: input.totalPaid,
    pinnedByWeek: input.pinnedByWeek,
  });

  const weeks: WeekTruth[] = standing.weeks.map((w) => {
    const covered = w.coveredAtCurrentRate;
    const skipped = w.isSkipped;
    const remainder = skipped ? 0 : Math.max(0, w.amountDue - covered);
    const money: WeekMoney =
      skipped || covered >= w.amountDue ? "paid" : covered > 0 ? "part" : "none";
    const windowClosed = weekHasElapsed({
      weekDate: w.date,
      today: input.today,
      windowClosesDays: input.windowClosesDays,
    });
    const pair = {
      money: skipped ? ("paid" as const) : money,
      windowClosed,
      deferred: w.isDeferred,
      skipped,
      markedLate: w.markedLate,
    };
    return {
      weekNumber: w.weekNumber,
      ownWeekNumber: w.weekNumber - input.startWeek + 1,
      date: w.date,
      amountDue: w.amountDue,
      amountPaid: w.amountPaid,
      covered,
      remainder,
      money,
      windowClosed,
      deferred: w.isDeferred,
      skipped,
      markedLate: w.markedLate,
      label: weekLabel(pair),
    };
  });

  // ——— D-42: what is owed NOW, and what is merely paused ———
  //
  // Two sums over the same weeks, split by one rule (`weekCountsNow`). Keeping
  // them separate is what stops "paused" ever being read as "paid" or as
  // "owed right now".
  let amountOutstanding = 0;
  let amountDeferred = 0;
  let dueNowCount = 0;
  for (const w of weeks) {
    if (w.skipped) continue;
    if (w.deferred) {
      // Not in the current expectation, and NOT forgiven — rule 4 resolves it.
      amountDeferred += w.remainder;
      continue;
    }
    if (weekCountsNow(w)) {
      dueNowCount++;
      // ROLLED FORWARD (rule 2): every week that counts contributes its own
      // remainder, so a $300 shortfall from week 4 is still owed in week 5.
      amountOutstanding += w.remainder;
    }
  }

  const credited = weeksCredited(input.totalPaid, input.weeklyAmount);
  const weeksPaid = Math.min(credited, input.weeksCommitted);
  // Elapsed here already excludes skipped AND deferred, so the subtraction is
  // just the credited weeks (D-42; the old shape subtracted skipped only).
  const behind = Math.max(0, dueNowCount - credited);
  const expectedByNow = input.weeklyAmount * dueNowCount;

  // The contiguous fully-paid prefix. A gap ends it: "paid up to week 11"
  // promises every week through 11 is settled and nothing less.
  let paidUpToWeek: number | null = null;
  for (const w of weeks) {
    if (w.money !== "paid") break;
    paidUpToWeek = w.weekNumber;
  }

  const grossProjected = calculateGross(input.weeklyAmount, input.weeksCommitted);
  const feeProjected = calculateFee(grossProjected, input.feePercent);

  return {
    participationId: input.participationId,
    weeklyAmount: input.weeklyAmount,
    startWeek: input.startWeek,
    weeksCommitted: input.weeksCommitted,
    finishWeek: standing.finishWeek,
    weeks,
    totalPaid: input.totalPaid,
    weeksCredited: credited,
    weeksPaid,
    weeksBehind: behind,
    expectedByNow,
    amountOutstanding,
    amountDeferred,
    surplus: standing.surplus,
    paidUpToWeek,
    lastPaymentWeek: standing.lastPaymentWeek,
    missingWeekRows: standing.missingWeekRows,
    feePercent: input.feePercent,
    grossProjected,
    feeProjected,
    payoutNet: calculateNet(grossProjected, feeProjected),
  };
}

// ————————————————— THE PAYMENT EVENT (§3.7) —————————————————

/**
 * What a payment DID — the event the engine names, and the message reads.
 *
 * The allocator has always computed this (`fillsWeek`, `runningRemainder`);
 * the recording path threw it away and kept only week numbers, which is why a
 * confirmation could say a part-paid week was "recorded on" and the member
 * later got chased for it. Nothing here is new arithmetic — it is a name for
 * what `allocatePayment` already worked out.
 */
export type PaymentEventTruth = {
  amount: number;
  /** Weeks this payment settled outright (they had nothing on them before). */
  fullWeeks: number[];
  /** Weeks ALREADY part-paid that this payment finished off. */
  completedWeeks: number[];
  /** The week left part-paid — at most one, per 2.15's waterfall. */
  partialWeek: number | null;
  /** Still owed on `partialWeek`. Zero when there is none. */
  remainder: number;
  /** Future weeks this payment ran into (paying ahead is normal). */
  aheadWeeks: number[];
  /** Money that fit nowhere — the commit refusal (2.15). */
  unallocated: number;
  /** Caught up after this payment. */
  nowCurrent: boolean;
  weeksBehindAfter: number;
};

export type DescribePaymentInput = {
  amount: number;
  today: Date;
  weeklyAmount: number;
  /** The member's weeks as they stood BEFORE this payment, ascending. */
  weeksBefore: readonly {
    weekNumber: number;
    date: Date;
    amountDue: number;
    /** Covered before this payment. */
    covered: number;
    isDeferred: boolean;
    isSkipped?: boolean;
    markedLate?: boolean;
  }[];
  /** The member's behind-count AFTER the payment, from `memberTruth`. */
  weeksBehindAfter: number;
  windowClosesDays?: number;
};

/**
 * Name what this payment did.
 *
 * DEFERRED WEEKS ARE FILLED, OLDEST FIRST (§3.0 rule 3). Deferral pauses the
 * chase, never the money: `allocatePayment` has always passed over skipped
 * weeks only, so a payment lands on the oldest deferred week before anything
 * newer, and this event says so.
 */
export function describePayment(input: DescribePaymentInput): PaymentEventTruth {
  const result = allocatePayment(
    input.amount,
    input.weeksBefore.map((w) => ({
      weekNumber: w.weekNumber,
      amountDue: w.amountDue,
      amountAlreadyPaid: w.covered,
      isSkipped: w.isSkipped ?? false,
    })),
  );
  const byWeek = new Map(input.weeksBefore.map((w) => [w.weekNumber, w]));

  const fullWeeks: number[] = [];
  const completedWeeks: number[] = [];
  const aheadWeeks: number[] = [];
  let partialWeek: number | null = null;
  let remainder = 0;

  for (const a of result.allocations) {
    const before = byWeek.get(a.weekNumber);
    if (!before) continue;
    const notYetDue = !weekHasElapsed({
      weekDate: before.date,
      today: input.today,
      windowClosesDays: input.windowClosesDays,
    });
    if (a.fillsWeek) {
      // FINISHED vs SETTLED OUTRIGHT — the member's sentence differs. "That
      // completes week 12" and "that paid week 12 in full" are different facts
      // and only one of them is true.
      if (before.covered > 0) completedWeeks.push(a.weekNumber);
      else fullWeeks.push(a.weekNumber);
      if (notYetDue) aheadWeeks.push(a.weekNumber);
    } else {
      partialWeek = a.weekNumber;
      remainder = Math.max(0, before.amountDue - (before.covered + a.applied));
    }
  }

  return {
    amount: input.amount,
    fullWeeks,
    completedWeeks,
    partialWeek,
    remainder,
    aheadWeeks,
    unallocated: result.unallocated,
    nowCurrent: input.weeksBehindAfter === 0,
    weeksBehindAfter: input.weeksBehindAfter,
  };
}

// ————————————————— GROUP TOTALS ARE SUMS OF TRUTHS (§2) —————————————————

/**
 * What the group is short for ONE week — the sum of what its in-window members
 * owe for that week, and nothing else.
 *
 * THIS IS THE SHAPE THAT MAKES §1(a) UNREPRESENTABLE. The old figure subtracted
 * one group total from another (`expected − received`) with no per-member cap,
 * and accumulated `received` for EVERY participation before the window gate —
 * so a member outside their window who overpaid silently paid down another
 * member's debt on screen, and `Math.max(0, …)` guaranteed the error could only
 * ever hide a shortfall. A sum over per-member remainders has no group
 * subtraction to get wrong: a member can never owe less than zero, so no
 * member's surplus can mask another's.
 */
export function weekShortfall(truths: readonly MemberTruth[], weekNumber: number): number {
  let short = 0;
  for (const t of truths) {
    const week = t.weeks.find((w) => w.weekNumber === weekNumber);
    if (!week) continue; // not their week — they owe nothing for it
    if (week.skipped || week.deferred) continue;
    short += week.remainder;
  }
  return short;
}

/** Cash the group is owed right now — the sum of members' truths (§3.0 rule 5). */
export function cashExpected(truths: readonly MemberTruth[]): number {
  return truths.reduce((sum, t) => sum + t.amountOutstanding, 0);
}

/** The single-label view, for surfaces not yet migrated. Display only. */
export function legacyStatus(w: WeekTruth): PaymentStatusValue {
  if (w.label === "PARTIAL_LATE") return "LATE";
  if (w.label === "UPCOMING") return "UNPAID";
  return w.label;
}
