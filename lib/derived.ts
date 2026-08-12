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
 * Does this week COUNT AS DUE NOW — either the calendar says so, or the
 * organizer does?
 *
 * `weekHasElapsed` above stays pure calendar, because that is what it is
 * named. This is the predicate everything else asks, and it has to include the
 * organizer's own mark (2.2): if a screen shows a week as LATE then the member
 * IS behind for it, and their outstanding balance says so. The mirror of the
 * rule `weekHasElapsed` already enforces — nobody is counted behind for a week
 * the same screen shows as open — is that nobody is shown LATE for a week that
 * counts as nothing.
 *
 * One predicate, one moment, no contradiction, whichever way the decision came.
 */
export function weekCountsAsDue(args: {
  weekDate: Date;
  today: Date;
  windowClosesDays?: number;
  /** The organizer marked this week late himself, before its window closed. */
  markedLate?: boolean;
  /** This member's week is not chased. DEFERRAL BEATS THE MARK — see below. */
  isDeferred?: boolean;
}): boolean {
  // DEFERRAL WINS (organizer ruling, Aug 2026). Deferred means "not chased,
  // still owed", and it exists precisely to stop a chase reaching someone the
  // organizer has decided not to pursue. A mark on a deferred week says two
  // opposite things about the same week, so the mark simply does not apply —
  // not to the status, and not here either.
  //
  // NOTE what this does NOT change: a deferred week that has ELAPSED still
  // counts as due, exactly as it always has. The money is owed either way.
  // What the mark cannot do is pull a not-yet-due deferred week forward.
  if (args.markedLate && !args.isDeferred) return true;
  return weekHasElapsed(args);
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
 *   PAID     — the money is there in full. PAID BEATS DEFERRED, and PAID BEATS
 *              A MARK: money is the truth (2.14), so a week the organizer
 *              marked late and the member then paid reads PAID. The payment
 *              path clears the mark as well; this order means the status is
 *              right even if a mark is somehow left behind.
 *   DEFERRED — still owed, just not chased. ABOVE THE ORGANIZER'S OWN MARK
 *              (ruling, Aug 2026): deferral exists precisely to stop a chase
 *              reaching someone he has decided not to pursue, so a mark on a
 *              deferred week would be saying two opposite things about one
 *              week. Deferral wins, and the screen says to remove it first.
 *   LATE     — because the ORGANIZER SAID SO (2.2), before the window closed.
 *   LATE     — not fully paid AND the window has closed.
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
  /** The organizer marked it late himself, before the window closed (2.2). */
  markedLate?: boolean;
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
  if (args.markedLate) return "LATE";

  const daysSinceWeekOpened = Math.floor((utcDay(args.today) - utcDay(args.weekDate)) / MS_PER_DAY);
  const windowClosed = daysSinceWeekOpened >= windowDays;
  if (windowClosed) return "LATE";
  return args.amountPaid > 0 ? "PARTIAL" : "UNPAID";
}

export type ManualLateAdvice =
  | { kind: "already-late"; message: string }
  | { kind: "deferred"; message: string }
  | { kind: "current"; message: null }
  | { kind: "future"; message: string };

/**
 * Why a deferred week cannot be marked late — the sentence, in one place.
 *
 * Names the way OUT, not just the refusal: the organizer who reaches for this
 * control has decided to chase, and "you cannot" without "here is how" is the
 * shape of message that gets a screen blamed for a decision it did not make.
 */
export const DEFERRED_BEATS_MARK =
  "This week is deferred — remove the deferral first if you want to chase it.";

/**
 * What marking THIS week late means today — and whether it is worth saying.
 *
 * FOUR CASES, AND TWO OF THEM STOP IT.
 *
 *   deferred     — the organizer has already decided not to chase this week
 *                  (ruling, Aug 2026). A mark would contradict that decision
 *                  rather than replace it, so it is refused with the way out.
 *   already-late — the window has closed, so the week reads LATE without any
 *                  help. Marking it would change nothing, and offering a
 *                  control that changes nothing is how a screen loses trust.
 *   current      — the week has started and its window is still open. This is
 *                  the ordinary case: he was told on Monday. SILENT.
 *   future       — the week has not begun. Unusual, and legitimate — a member
 *                  who says now that next month is impossible is telling him
 *                  something true. So it WARNS and lets him proceed. Never
 *                  blocked: he has reasons the system does not know (2.2).
 *
 * DEFERRAL IS CHECKED FIRST, above even "already late". A deferred week whose
 * window has closed is not late at all — that is the whole point of deferral —
 * so telling him it "is already late" would be false as well as unhelpful.
 */
export function manualLateAdvice(args: {
  weekDate: Date;
  today: Date;
  windowClosesDays?: number;
  /** For the sentence — "week 15" reads better than "this week". */
  weekNumber?: number;
  /** Deferral beats the mark, so it answers before anything else. */
  isDeferred?: boolean;
}): ManualLateAdvice {
  assertValidDate("weekDate", args.weekDate);
  assertValidDate("today", args.today);
  const windowDays = args.windowClosesDays ?? PAYMENT_WINDOW_DAYS;
  assertCount("windowClosesDays", windowDays);

  const days = Math.floor((utcDay(args.today) - utcDay(args.weekDate)) / MS_PER_DAY);
  const which = args.weekNumber === undefined ? "This week" : `Week ${args.weekNumber}`;

  if (args.isDeferred) return { kind: "deferred", message: DEFERRED_BEATS_MARK };

  if (days >= windowDays) {
    return {
      kind: "already-late",
      message: `${which} is already late — its payment window closed. There is nothing to mark.`,
    };
  }
  if (days < 0) {
    return {
      kind: "future",
      message: `${which} has not started yet. Marking it late now is allowed, and it will show as late from this moment.`,
    };
  }
  return { kind: "current", message: null };
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
