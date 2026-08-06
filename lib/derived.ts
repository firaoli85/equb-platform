// Derived state (ground truth 2.14): nothing in this file is EVER stored.
// Weeks credited, behind-count, status, late, and outstanding amounts are
// computed from the stored money facts on every read, so they can never
// drift. Pure functions only — no database, no I/O, cents as integers.

const MS_PER_DAY = 86_400_000;

/**
 * The payment window: a week opens on its date and closes after this many
 * days. 5 = Sunday start, Thursday close (days 0–4 open, late from day 5).
 * A named constant today; becomes cycle configuration later (2.6).
 */
export const PAYMENT_WINDOW_DAYS = 5;

/**
 * DEFERRED and SKIPPED are OPPOSITE meanings and must never be one flag:
 *
 *   DEFERRED — one person's week. Still owed, just not chased (organizer
 *              ruling, Aug 2026). Its only effect is that the week never
 *              reads LATE and the member is left out of chasing messages.
 *   SKIPPED  — a cycle-wide week that did not happen. Nobody owes it, ever.
 *              Fully excused, exactly as deferral used to be.
 */
export type PaymentStatusValue =
  | "PAID"
  | "PARTIAL"
  | "DEFERRED"
  | "SKIPPED"
  | "UNPAID"
  | "LATE";

function assertCents(name: string, cents: number): void {
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError(`${name} must be an integer number of cents, got ${cents}`);
  }
  if (cents < 0) {
    throw new RangeError(`${name} must not be negative, got ${cents}`);
  }
}

function assertCount(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer, got ${value}`);
  }
}

function assertValidDate(name: string, date: Date): void {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new RangeError(`${name} must be a valid Date`);
  }
}

function utcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * Has this week ELAPSED? Decided by the day the week ITSELF records, plus its
 * payment window — never by projecting a week number off the cycle's start
 * date (2.14: stored facts win; the start date is editable while week rows are
 * kept deliberately).
 *
 * This is the same boundary `paymentStatus` uses for LATE, and that is the
 * point: a member cannot be counted BEHIND for a week that the very same
 * screen still shows as UNPAID with its window open (2.16). One rule, one
 * moment, no contradiction.
 */
export function weekHasElapsed(args: {
  weekDate: Date;
  today: Date;
  windowClosesDays?: number;
}): boolean {
  assertValidDate("weekDate", args.weekDate);
  assertValidDate("today", args.today);
  const windowDays = args.windowClosesDays ?? PAYMENT_WINDOW_DAYS;
  assertCount("windowClosesDays", windowDays);
  const daysSinceWeekOpened = Math.floor((utcDay(args.today) - utcDay(args.weekDate)) / MS_PER_DAY);
  return daysSinceWeekOpened >= windowDays;
}

/**
 * Whole weeks the member's money covers at their CURRENT weekly amount
 * (2.14: total money paid ÷ current weekly amount). A mid-cycle rate change
 * needs no special case: $1,500 paid at a new $500 rate is 3 weeks credited.
 */
export function weeksCredited(totalPaid: number, weeklyAmount: number): number {
  assertCents("totalPaid", totalPaid);
  if (!Number.isSafeInteger(weeklyAmount) || weeklyAmount < 1) {
    throw new RangeError(`weeklyAmount must be a positive integer, got ${weeklyAmount}`);
  }
  return Math.floor(totalPaid / weeklyAmount);
}

/**
 * Weeks elapsed in the member's window minus SKIPPED weeks (nobody owed
 * them) minus weeks their money covers. Never below zero — paying ahead is
 * not "negative behind", it is simply current.
 *
 * Deferred weeks are NOT subtracted: the money is still owed, so a deferred
 * week the member has not paid makes them behind exactly like any other.
 */
export function weeksBehind(
  weeksElapsedInWindow: number,
  weeksCreditedCount: number,
  skippedCount: number,
): number {
  assertCount("weeksElapsedInWindow", weeksElapsedInWindow);
  assertCount("weeksCreditedCount", weeksCreditedCount);
  assertCount("skippedCount", skippedCount);
  return Math.max(0, weeksElapsedInWindow - skippedCount - weeksCreditedCount);
}

/**
 * The status of one week, derived from money and the calendar (2.14, 2.16).
 * The ORDER is the ruling:
 *
 *   SKIPPED  — the week did not happen for anyone; nothing was ever owed.
 *   PAID     — the money is there in full. PAID BEATS DEFERRED: a deferred
 *              week the member has since covered reads as paid, because it
 *              is. Deferral describes how we treat a DEBT, not the money.
 *   DEFERRED — still owed, just not chased. Its whole job is to stand where
 *              LATE would otherwise appear.
 *   LATE     — not fully paid AND the window has closed. From dates only,
 *              never a stored flag.
 *   PARTIAL  — some money, window still open.
 *   UNPAID   — no money, window still open (or the week is in the future).
 */
export function paymentStatus(args: {
  amountPaid: number;
  amountDue: number;
  /** This member's week is excused from CHASING — the money is still owed. */
  isDeferred: boolean;
  /** Cycle-wide: the week did not happen, so nobody owes it. */
  isSkipped?: boolean;
  weekDate: Date;
  today: Date;
  windowClosesDays?: number;
}): PaymentStatusValue {
  assertCents("amountPaid", args.amountPaid);
  assertCents("amountDue", args.amountDue);
  assertValidDate("weekDate", args.weekDate);
  assertValidDate("today", args.today);
  const windowDays = args.windowClosesDays ?? PAYMENT_WINDOW_DAYS;
  assertCount("windowClosesDays", windowDays);

  if (args.isSkipped) return "SKIPPED";
  if (args.amountPaid >= args.amountDue) return "PAID";
  if (args.isDeferred) return "DEFERRED";

  const daysSinceWeekOpened = Math.floor((utcDay(args.today) - utcDay(args.weekDate)) / MS_PER_DAY);
  const windowClosed = daysSinceWeekOpened >= windowDays;
  if (windowClosed) return "LATE";
  return args.amountPaid > 0 ? "PARTIAL" : "UNPAID";
}

/**
 * Total still owed across the weeks given. NETTED, because money is fungible
 * (2.14: credited = total money ÷ current rate): surplus sitting on one week
 * — e.g. weeks recorded at an old, higher rate — offsets debt on another,
 * exactly as weeksCredited/weeksBehind see it. A per-week clamp would strand
 * that surplus and overstate debt after a rate decrease.
 *
 * SKIPPED weeks contribute nothing to the amount due — nobody owed them.
 * DEFERRED weeks DO count: the money is still owed, the member is simply not
 * chased for it. Money recorded on either still counts — it is money. Never
 * negative. The CALLER chooses the window semantics — pass elapsed weeks for
 * "owed now" (the 2.19 profile number), or the whole commitment for a
 * cycle-end balance (2.18).
 */
export function amountOutstanding(
  weeks: readonly {
    amountDue: number;
    amountAlreadyPaid: number;
    isDeferred: boolean;
    isSkipped?: boolean;
  }[],
): number {
  let due = 0;
  let paid = 0;
  for (const [i, week] of weeks.entries()) {
    assertCents(`week[${i}] amountDue`, week.amountDue);
    assertCents(`week[${i}] amountAlreadyPaid`, week.amountAlreadyPaid);
    if (!week.isSkipped) due += week.amountDue;
    paid += week.amountAlreadyPaid;
  }
  return Math.max(0, due - paid);
}
