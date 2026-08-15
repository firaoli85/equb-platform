// Pure standing and commit-planning logic for the money core. No database,
// no I/O — the action layer feeds it rows and gets derived truth back, so
// every number here is unit-testable (2.14: derived, never stored).
//
// The key idea: STORED per-week payments are the receipts (what landed where
// at record time), but the member's CURRENT position is derived by re-running
// the one allocation engine (2.19) over their fungible money total at the
// current rate. After a rate change the receipts and the position legitimately
// differ — weeksCredited, weeksBehind, per-week status, and outstanding must
// all agree with each other, and they all derive from the same re-allocation.
//
// The ONE exception to fungibility: a payout settlement ("the winner does
// not pay the week they win") belongs to its drawn week. Pinned money is
// applied to that week FIRST and never slides oldest-first — otherwise the
// derived view would show the winner owing the very week their payout
// settled.

import { allocatePayment, type AllocationResult, type AllocationWeek } from "./allocation";
import {
  amountDeferred,
  amountOutstanding,
  paymentStatus,
  weekCountsAsDue,
  weeksBehind,
  weeksCredited,
  type PaymentStatusValue,
} from "./derived";
import { formatMoney } from "./format";
import { calculateFinishWeek } from "./money";

export type StandingWeekInput = {
  weekNumber: number;
  date: Date;
  /** The member's weekly amount at the current rate, in cents. */
  amountDue: number;
  /** Receipts recorded on this week's row, in cents. */
  storedPaid: number;
  /**
   * THIS MEMBER's week is PAUSED (D-42, §2.29a, 15 Aug 2026).
   *
   * It leaves the CURRENT expectation — out of `amountOutstanding`, out of
   * `weeksBehind`, never chased, never LATE — and its money is returned in
   * `amountDeferred` instead. It is not forgiven: it resolves at close, either
   * by being paid or by carrying into the person's balance (2.18).
   *
   * Money still allocates to it normally, oldest-first: deferral pauses the
   * chase, never the money.
   */
  isDeferred: boolean;
  /**
   * CYCLE-WIDE: the week did not happen, so nobody owes it. Fully excused —
   * this is what deferral used to mean. Never conflate the two.
   */
  isSkipped?: boolean;
  /**
   * THE ORGANIZER MARKED THIS WEEK LATE HIMSELF, before its window closed
   * (2.2). A stored decision, not a derivation — `payments.markedLateAt`.
   *
   * It makes the week count as DUE NOW, exactly as a closed window does: the
   * status reads LATE, the week joins the behind-count, and its money joins
   * the outstanding balance. Anything less would put a LATE week on screen
   * that the member's own balance says is not owed, which is the contradiction
   * this file exists to prevent.
   */
  markedLate: boolean;
};

export type StandingWeek = {
  weekNumber: number;
  date: Date;
  amountDue: number;
  /** The receipts fact — what was recorded on this row. */
  amountPaid: number;
  /** What the member's fungible money covers here at the current rate. */
  coveredAtCurrentRate: number;
  isDeferred: boolean;
  isSkipped: boolean;
  /** The organizer's own late mark, so a screen can offer to undo it. */
  markedLate: boolean;
  status: PaymentStatusValue;
};

export type Standing = {
  finishWeek: number;
  weeksElapsedInWindow: number;
  /** Window rows the cycle is missing for this commitment (pre-D-31 data). */
  missingWeekRows: number;
  totalPaid: number;
  weeksCredited: number;
  weeksBehind: number;
  amountOutstanding: number;
  /**
   * What their DEFERRED weeks hold — owed, but not expected now (D-42,
   * §2.29a). Paused, never forgiven: it resolves at close, either by being
   * paid (oldest-first) or by carrying into the person's balance (2.18).
   * Kept apart from `amountOutstanding` so "paused" is never read as "paid".
   */
  amountDeferred: number;
  /** Money beyond the member's entire window at the current rate. */
  surplus: number;
  lastPaymentWeek: number | null;
  weeks: StandingWeek[];
};

/**
 * Derive a member's complete position from their stored receipts and the
 * calendar. `windowWeeks` are the EXISTING week rows of their window in
 * ascending order; `totalPaid` is every cent recorded on the participation.
 */
export function computeStanding(input: {
  weeklyAmount: number;
  startWeek: number;
  weeksCommitted: number;
  /**
   * The cycle's current calendar week (0 before the cycle starts). DISPLAY
   * ONLY — no money number derives from it (2.14). Elapsed weeks come from
   * each week row's own stored date.
   */
  cycleWeek: number;
  today: Date;
  windowWeeks: readonly StandingWeekInput[];
  totalPaid: number;
  /** Payout-settled cents per weekNumber — NOT fungible, stays on its week. */
  pinnedByWeek?: ReadonlyMap<number, number>;
}): Standing {
  const { windowWeeks, today, totalPaid } = input;
  const finishWeek = calculateFinishWeek(input.startWeek, input.weeksCommitted);

  // Pinned settlements land on their own week first (capped at its due). A
  // SKIPPED week takes nothing — that money becomes fungible again. A
  // DEFERRED week still owes, so its settlement lands normally.
  const pinnedApplied = new Map<number, number>();
  let pinnedTotal = 0;
  for (const w of windowWeeks) {
    const pinned = input.pinnedByWeek?.get(w.weekNumber) ?? 0;
    if (pinned <= 0 || w.isSkipped) continue;
    const applied = Math.min(pinned, w.amountDue);
    if (applied > 0) {
      pinnedApplied.set(w.weekNumber, applied);
      pinnedTotal += applied;
    }
  }

  // The REST of the member's money is fungible, re-allocated oldest-first at
  // the current rate — the single engine (2.19) defines coverage.
  const effective: AllocationResult = allocatePayment(
    Math.max(0, totalPaid - pinnedTotal),
    windowWeeks.map(
      (w): AllocationWeek => ({
        weekNumber: w.weekNumber,
        amountDue: w.amountDue,
        amountAlreadyPaid: pinnedApplied.get(w.weekNumber) ?? 0,
        // Only a skipped week is passed over — deferred money is still owed.
        isSkipped: w.isSkipped ?? false,
      }),
    ),
  );
  const coveredByWeek = new Map<number, number>(pinnedApplied);
  for (const a of effective.allocations) {
    coveredByWeek.set(a.weekNumber, (coveredByWeek.get(a.weekNumber) ?? 0) + a.applied);
  }

  // ELAPSED IS DECIDED BY EACH WEEK'S OWN STORED DATE (2.14), not by
  // projecting a week number off the cycle's start date. `cycleWeek` is still
  // accepted — the calendar position is a useful DISPLAY fact — but no money
  // number depends on it any more, so correcting a start date can never move
  // anyone's arrears while their week rows are unchanged.
  //
  // The boundary is the payment window, the same one paymentStatus uses for
  // LATE: a week the screen still shows as UNPAID-and-open can no longer also
  // count as behind.
  //
  // "Elapsed" now means COUNTS AS DUE NOW: the calendar closed the window, or
  // the organizer marked the week late himself (2.2). Both routes produce the
  // same LATE on screen, so both have to produce the same arithmetic — a week
  // shown as late while the balance says nothing is owed would be the exact
  // contradiction the paragraph above rules out.
  const elapsed = windowWeeks.filter((w) =>
    weekCountsAsDue({
      weekDate: w.date,
      today,
      markedLate: w.markedLate,
      // Deferral beats the mark (ruling, Aug 2026) — a deferred week is one he
      // has decided not to chase, so a mark on it does not pull it forward.
      isDeferred: w.isDeferred,
    }),
  );
  // DEFERRED WEEKS ARE ALREADY OUT of `elapsed` — `weekCountsAsDue` drops them
  // (D-42, §2.29a) — so the behind-count needs no second deferral test here.
  // Skipped weeks still have to be subtracted, because a skipped week IS due by
  // the calendar and simply owed by nobody.
  const skippedElapsed = elapsed.filter((w) => w.isSkipped).length;
  const credited = weeksCredited(totalPaid, input.weeklyAmount);
  const behind = weeksBehind(elapsed.length, credited, skippedElapsed);
  const outstanding = amountOutstanding(
    elapsed.map((w) => ({
      amountDue: w.amountDue,
      amountAlreadyPaid: coveredByWeek.get(w.weekNumber) ?? 0,
      isDeferred: w.isDeferred,
      isSkipped: w.isSkipped ?? false,
    })),
  );

  // OVER THE WHOLE WINDOW, not only the elapsed weeks: a week paused before
  // its window closed is still paused, and its money still has to be somewhere.
  const deferredHeld = amountDeferred(
    windowWeeks.map((w) => ({
      amountDue: w.amountDue,
      amountAlreadyPaid: coveredByWeek.get(w.weekNumber) ?? 0,
      isDeferred: w.isDeferred,
      isSkipped: w.isSkipped ?? false,
    })),
  );

  const paidRows = windowWeeks.filter((w) => w.storedPaid > 0);

  return {
    finishWeek,
    weeksElapsedInWindow: elapsed.length,
    missingWeekRows: Math.max(0, input.weeksCommitted - windowWeeks.length),
    totalPaid,
    weeksCredited: credited,
    weeksBehind: behind,
    amountOutstanding: outstanding,
    amountDeferred: deferredHeld,
    surplus: effective.unallocated,
    lastPaymentWeek: paidRows.length > 0 ? paidRows[paidRows.length - 1].weekNumber : null,
    weeks: windowWeeks.map((w) => ({
      weekNumber: w.weekNumber,
      date: w.date,
      amountDue: w.amountDue,
      amountPaid: w.storedPaid,
      coveredAtCurrentRate: coveredByWeek.get(w.weekNumber) ?? 0,
      isDeferred: w.isDeferred,
      isSkipped: w.isSkipped ?? false,
      markedLate: w.markedLate ?? false,
      status: paymentStatus({
        amountPaid: coveredByWeek.get(w.weekNumber) ?? 0,
        amountDue: w.amountDue,
        isDeferred: w.isDeferred,
        isSkipped: w.isSkipped ?? false,
        markedLate: w.markedLate ?? false,
        weekDate: w.date,
        today,
      }),
    })),
  };
}

/** Sum pinned settlement events into a weekNumber → cents map. */
export function pinnedMapFromEvents(
  events: readonly { amount: number; weekNumber: number | null }[],
): Map<number, number> {
  const map = new Map<number, number>();
  for (const e of events) {
    if (e.weekNumber === null) continue;
    map.set(e.weekNumber, (map.get(e.weekNumber) ?? 0) + e.amount);
  }
  return map;
}

export type CommitPlan =
  | { ok: true; result: AllocationResult }
  | { ok: false; error: string };

/**
 * Plan a payment commit: the SAME engine as the preview (2.19), plus the
 * money-conservation rule — an amount the member's window cannot absorb is
 * refused outright, never partially written and never silently dropped
 * (2.14: every cent received must land somewhere the system remembers).
 */
export function planCommit(amount: number, weeks: readonly AllocationWeek[]): CommitPlan {
  const result = allocatePayment(amount, weeks);
  if (result.unallocated > 0) {
    return {
      ok: false,
      error:
        `Only ${formatMoney(result.totalApplied)} fits in this member's remaining weeks. ` +
        `Enter that amount instead — the extra ${formatMoney(result.unallocated)} needs the ` +
        `carried-balance ledger, which is not built yet.`,
    };
  }
  return { ok: true, result };
}
