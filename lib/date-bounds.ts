// A DATE MUST MAKE SENSE FOR ITS CONTEXT.
//
// Pure, so every bound is tested law rather than an attribute somebody
// remembered to pass. The picker enforces what these functions decide, and —
// this is the part that matters — always says WHY a date is unavailable. A
// greyed-out calendar with no explanation is worse than no bound at all: the
// organizer concludes the app is broken.
//
// Bounds are INCLUSIVE on both ends and compared as UTC days, matching the
// YYYY-MM-DD contract every date field in the platform uses.

export type DateBounds = {
  /** Earliest selectable day, inclusive. */
  min?: string | null;
  /** Latest selectable day, inclusive. */
  max?: string | null;
  /**
   * Why the bound exists, in the organizer's words — shown in the picker and
   * read out to screen readers. A bound without a reason is a bug.
   */
  reason?: string | null;
};

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** YYYY-MM-DD → a UTC-midnight Date, or null when it is not a real date. */
export function parseIsoDay(iso: string | null | undefined): Date | null {
  const m = (iso ?? "").match(ISO);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  // Rejects 2026-02-31, which Date would silently roll into March.
  return toIsoDay(d) === iso ? d : null;
}

export function toIsoDay(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

/** Today as a UTC day, from a clock the caller supplies (so tests are stable). */
export function todayIsoDay(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}

/** Is this day inside the bounds? An unparseable day is never allowed. */
export function isWithinBounds(iso: string, bounds: DateBounds | null | undefined): boolean {
  if (parseIsoDay(iso) === null) return false;
  if (!bounds) return true;
  // String comparison is correct and cheaper than parsing: YYYY-MM-DD sorts
  // lexicographically in the same order it sorts chronologically.
  if (bounds.min && iso < bounds.min) return false;
  if (bounds.max && iso > bounds.max) return false;
  return true;
}

/**
 * The first day a picker should land on when it has no value yet.
 *
 * "Blank" is the worst default: it makes the organizer guess, and on a bounded
 * field it invites him to guess wrong. Prefer today; if today is outside the
 * bounds, prefer the nearest edge that is inside them.
 */
export function defaultWithinBounds(
  bounds: DateBounds | null | undefined,
  now: Date = new Date(),
): string {
  const today = todayIsoDay(now);
  if (isWithinBounds(today, bounds)) return today;
  if (bounds?.min && today < bounds.min) return bounds.min;
  if (bounds?.max && today > bounds.max) return bounds.max;
  return today;
}

/**
 * THE NEW-CYCLE RULE.
 *
 * Two things constrain when a cycle may start:
 *   1. It cannot start in the past. A cycle's week 1 IS its start date, so a
 *      past start would generate weeks that already closed unpaid and put
 *      every member instantly in arrears.
 *   2. It cannot start before the ACTIVE cycle's final week. Two live cycles
 *      overlapping would mean two draws in one week and two sets of weekly
 *      money, which the wheel and the ledger both assume cannot happen.
 *
 * The reason names the cycle and the date, because "you can't pick that" is
 * not something the organizer can act on.
 */
export function newCycleStartBounds(input: {
  now?: Date;
  activeCycle?: {
    name: string;
    /** The stored date of the active cycle's FINAL week (2.14 authority). */
    finalWeekDate: Date;
    /** Formatted for the reason sentence, e.g. "Sunday, September 27, 2026". */
    finalWeekLabel: string;
  } | null;
}): DateBounds {
  const today = todayIsoDay(input.now ?? new Date());
  const active = input.activeCycle ?? null;
  if (!active) {
    return {
      min: today,
      reason: "A cycle starts on its own week 1, so it cannot begin in the past.",
    };
  }

  const activeEnd = toIsoDay(active.finalWeekDate);
  // Whichever bound bites harder wins — an active cycle ending next year
  // matters more than "not in the past", and vice versa once it has ended.
  const min = activeEnd > today ? activeEnd : today;
  return {
    min,
    reason:
      activeEnd > today
        ? `${active.name} runs until ${active.finalWeekLabel}. A new cycle cannot start before then.`
        : "A cycle starts on its own week 1, so it cannot begin in the past.",
  };
}

/**
 * WHEN MONEY ARRIVED — never in the future.
 *
 * Every "when did this happen" field in the platform records something that
 * ALREADY happened: a payment received, a payout collected, a balance
 * settled. Back-dating is normal and stays free (money often arrives days
 * before it is recorded, and a balance can be settled long after a cycle
 * ended), so there is deliberately no lower bound. Forward-dating is always a
 * typo — and a costly one, because a receipt dated next week credits a week
 * that has not opened.
 */
export function moneyReceivedBounds(now: Date = new Date()): DateBounds {
  return {
    max: todayIsoDay(now),
    reason: "Money can only be recorded on or before today.",
  };
}

/**
 * A WEEK'S OWN DATE must stay in sequence with its neighbours.
 *
 * The elapsed-weeks rule reads stored week dates directly (2.14), so a week
 * dated out of order does not just look wrong — it changes who is in arrears.
 * Bounded strictly BETWEEN the neighbours: two weeks sharing a date would
 * make "which week closed first" unanswerable.
 *
 * The first and last weeks are each bounded on one side only, which is
 * correct — a cycle can legitimately be moved earlier or extended later.
 */
export function weekDateBounds(input: {
  previousWeek?: { weekNumber: number; date: Date } | null;
  nextWeek?: { weekNumber: number; date: Date } | null;
}): DateBounds {
  const previous = input.previousWeek ?? null;
  const next = input.nextWeek ?? null;
  const dayAfter = (d: Date) => toIsoDay(new Date(d.getTime() + 86_400_000));
  const dayBefore = (d: Date) => toIsoDay(new Date(d.getTime() - 86_400_000));

  const parts: string[] = [];
  if (previous) parts.push(`after week ${previous.weekNumber} (${toIsoDay(previous.date)})`);
  if (next) parts.push(`before week ${next.weekNumber} (${toIsoDay(next.date)})`);

  return {
    min: previous ? dayAfter(previous.date) : null,
    max: next ? dayBefore(next.date) : null,
    reason:
      parts.length === 0
        ? null
        : `Weeks run in order, so this one must fall ${parts.join(" and ")}.`,
  };
}

/**
 * The message for a date that is out of bounds — used by forms that validate
 * a typed value, so the refusal reads the same wherever it appears.
 */
export function outOfBoundsMessage(bounds: DateBounds | null | undefined): string | null {
  if (!bounds) return null;
  return bounds.reason ?? "That date is outside the range allowed here.";
}
