// The payment allocation engine (ground truth 2.15): oldest debt first, then
// forward. Pure functions only — no database, no I/O. All money in integer
// CENTS. This is THE one allocation engine (2.19); every entry point — week
// view, member profile, preview, commit — must run this exact function.

export type AllocationWeek = {
  weekNumber: number;
  /** Cents this week costs the member (their weekly amount at read time). */
  amountDue: number;
  /** Cents already recorded on this week. */
  amountAlreadyPaid: number;
  /**
   * Cycle-wide: the week did not happen, so nobody owes it and no money is
   * ever allocated to it (2.15).
   *
   * NOTE this is SKIPPED, not deferred. A deferred week is still owed — the
   * member is only spared the chasing — so money lands on it like any other
   * week, oldest first (organizer ruling, Aug 2026).
   */
  isSkipped: boolean;
};

export type WeekAllocation = {
  weekNumber: number;
  /** Cents applied to this week by THIS payment. Always > 0. */
  applied: number;
  /** True when the week reaches its amountDue after this application. */
  fillsWeek: boolean;
  /** Cents still undistributed after this week was filled. */
  runningRemainder: number;
};

export type AllocationResult = {
  /** One entry per week that receives money, oldest first. */
  allocations: WeekAllocation[];
  totalApplied: number;
  /** Cents left over after every available week is full. */
  unallocated: number;
};

function assertCents(name: string, cents: number): void {
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError(`${name} must be an integer number of cents, got ${cents}`);
  }
  if (cents < 0) {
    throw new RangeError(`${name} must not be negative, got ${cents}`);
  }
}

/**
 * Allocate a received amount across a member's weeks, oldest unpaid first,
 * waterfalling forward (2.15):
 *
 *   1. The oldest not-fully-paid week is filled to its amountDue.
 *   2. Then the next, and the next — current week, then future weeks.
 *   3. SKIPPED weeks are passed over entirely: nobody owed them. Deferred
 *      weeks are NOT skipped — they are still owed.
 *   4. A leftover too small to fill a week becomes a PARTIAL on that week.
 *   5. Money beyond the last available week is returned as `unallocated`.
 *
 * `weeks` must be the member's weeks ordered by ascending weekNumber — the
 * function throws rather than silently reordering, so a caller bug cannot
 * quietly change who is owed what.
 */
export function allocatePayment(
  amountReceived: number,
  weeks: readonly AllocationWeek[],
): AllocationResult {
  assertCents("amountReceived", amountReceived);
  let previousWeekNumber = Number.NEGATIVE_INFINITY;
  for (const week of weeks) {
    if (!Number.isSafeInteger(week.weekNumber)) {
      throw new RangeError(`weekNumber must be an integer, got ${week.weekNumber}`);
    }
    if (week.weekNumber <= previousWeekNumber) {
      throw new RangeError(
        `weeks must be ordered by ascending weekNumber (week ${week.weekNumber} after ${previousWeekNumber})`,
      );
    }
    previousWeekNumber = week.weekNumber;
    assertCents(`week ${week.weekNumber} amountDue`, week.amountDue);
    assertCents(`week ${week.weekNumber} amountAlreadyPaid`, week.amountAlreadyPaid);
  }

  const allocations: WeekAllocation[] = [];
  let remaining = amountReceived;

  for (const week of weeks) {
    if (remaining === 0) break;
    if (week.isSkipped) continue;
    const owed = week.amountDue - week.amountAlreadyPaid;
    if (owed <= 0) continue;
    const applied = Math.min(owed, remaining);
    remaining -= applied;
    allocations.push({
      weekNumber: week.weekNumber,
      applied,
      fillsWeek: week.amountAlreadyPaid + applied >= week.amountDue,
      runningRemainder: remaining,
    });
  }

  return {
    allocations,
    totalApplied: amountReceived - remaining,
    unallocated: remaining,
  };
}
