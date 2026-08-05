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
  amountOutstanding,
  paymentStatus,
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
  /** Personal deferral or cycle-wide skipped week — excused, never owed. */
  isDeferred: boolean;
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
  /** The cycle's current calendar week (0 before the cycle starts). */
  cycleWeek: number;
  today: Date;
  windowWeeks: readonly StandingWeekInput[];
  totalPaid: number;
  /** Payout-settled cents per weekNumber — NOT fungible, stays on its week. */
  pinnedByWeek?: ReadonlyMap<number, number>;
}): Standing {
  const { windowWeeks, cycleWeek, today, totalPaid } = input;
  const finishWeek = calculateFinishWeek(input.startWeek, input.weeksCommitted);

  // Pinned settlements land on their own week first (capped at its due; an
  // excused week takes nothing — that money becomes fungible again).
  const pinnedApplied = new Map<number, number>();
  let pinnedTotal = 0;
  for (const w of windowWeeks) {
    const pinned = input.pinnedByWeek?.get(w.weekNumber) ?? 0;
    if (pinned <= 0 || w.isDeferred) continue;
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
        isDeferred: w.isDeferred,
      }),
    ),
  );
  const coveredByWeek = new Map<number, number>(pinnedApplied);
  for (const a of effective.allocations) {
    coveredByWeek.set(a.weekNumber, (coveredByWeek.get(a.weekNumber) ?? 0) + a.applied);
  }

  const elapsed = windowWeeks.filter((w) => w.weekNumber <= cycleWeek);
  const deferredElapsed = elapsed.filter((w) => w.isDeferred).length;
  const credited = weeksCredited(totalPaid, input.weeklyAmount);
  const behind = weeksBehind(elapsed.length, credited, deferredElapsed);
  const outstanding = amountOutstanding(
    elapsed.map((w) => ({
      amountDue: w.amountDue,
      amountAlreadyPaid: coveredByWeek.get(w.weekNumber) ?? 0,
      isDeferred: w.isDeferred,
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
    surplus: effective.unallocated,
    lastPaymentWeek: paidRows.length > 0 ? paidRows[paidRows.length - 1].weekNumber : null,
    weeks: windowWeeks.map((w) => ({
      weekNumber: w.weekNumber,
      date: w.date,
      amountDue: w.amountDue,
      amountPaid: w.storedPaid,
      coveredAtCurrentRate: coveredByWeek.get(w.weekNumber) ?? 0,
      isDeferred: w.isDeferred,
      status: paymentStatus({
        amountPaid: coveredByWeek.get(w.weekNumber) ?? 0,
        amountDue: w.amountDue,
        isDeferred: w.isDeferred,
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
