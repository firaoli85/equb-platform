// A CLOSED CYCLE IS READ-ONLY, AND CLOSING WAITS (2.9, 2.14).
//
// TWO separate rules that both protect the same thing — a cycle's books after
// its last week — and were both missing.
//
// 1. READ-ONLY ONCE CLOSED. `frozenCycleRefusal` already existed but was
//    applied by hand, action by action: of the 19 mutations in
//    app/actions/edits.ts only 9 carried it, participations.ts carried none,
//    and wheel.ts carried 3 of 10. A guard that must be REMEMBERED is a guard
//    that will be forgotten, so lib/cycle-lock.test.ts now scans the source
//    and fails when a cycle-mutating action ships without it.
//
// 2. A WAIT PERIOD BEFORE CLOSING IS OFFERED. Closing writes every member's
//    shortfall onto their carried ledger and freezes the books. Money for the
//    final week routinely arrives days after that week's date — the payment
//    window itself is 5 days — so a cycle closed the moment its last week
//    passed converts payments-in-transit into permanent debts. The wait is
//    configurable (2.6) and stated plainly on the pre-close review rather than
//    silently disabling a button.

export const CLOSING_WAIT_DAYS_DEFAULT = 5;

const MS_PER_DAY = 86_400_000;
const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

export type CloseTiming =
  | {
      state: "too-soon";
      /** Whole days still to wait. Always ≥ 1. */
      daysRemaining: number;
      /** The day closing becomes available. */
      availableOn: Date;
      reason: string;
    }
  | { state: "ready"; reason: string };

/**
 * Whether enough time has passed since the cycle's FINAL week for closing to
 * be offered.
 *
 * Measured from the final week's own stored date (2.14 — stored week dates are
 * authoritative), not from a projection off the start date, because a cycle
 * that ran long finishes when its last week actually happened.
 */
export function closeTiming(input: {
  /** The stored date of the cycle's last week. */
  finalWeekDate: Date;
  today: Date;
  /** From the closingWaitDays setting; falls back to the default. */
  waitDays?: number;
  /** How the date reads to the organizer, e.g. "Sunday, September 27, 2026". */
  finalWeekLabel: string;
  /** Named in the reason so the sentence reads about a real cycle. */
  cycleNameForReason?: string;
}): CloseTiming {
  const wait =
    Number.isFinite(input.waitDays) && (input.waitDays ?? 0) >= 0
      ? Math.trunc(input.waitDays!)
      : CLOSING_WAIT_DAYS_DEFAULT;

  const elapsed = Math.floor((utcDay(input.today) - utcDay(input.finalWeekDate)) / MS_PER_DAY);
  if (elapsed >= wait) {
    return {
      state: "ready",
      reason:
        wait === 0
          ? "Closing is available."
          : `The last week was ${input.finalWeekLabel}, more than ${wait} day${wait === 1 ? "" : "s"} ago.`,
    };
  }

  const daysRemaining = wait - elapsed;
  const availableOn = new Date(utcDay(input.finalWeekDate) + wait * MS_PER_DAY);
  return {
    state: "too-soon",
    daysRemaining,
    availableOn,
    reason:
      `${input.cycleNameForReason ?? "This cycle"}'s last week was ${input.finalWeekLabel}. ` +
      `Closing waits ${wait} day${wait === 1 ? "" : "s"} after that, so late payments land on the ` +
      `week rather than becoming carried debts — ${daysRemaining} day${daysRemaining === 1 ? "" : "s"} to go.`,
  };
}

/**
 * What a CLOSED cycle still allows. Reading and exporting the archive always
 * work; nothing that writes does (2.9: clean delete, readable archive).
 */
export function closedCycleAllows(action: "read" | "archive-export" | "delete" | "write"): boolean {
  return action === "read" || action === "archive-export" || action === "delete";
}
