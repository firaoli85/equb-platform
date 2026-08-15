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
  /**
   * PART PAID, AND THE WEEK IS BEING CHASED — the sixth state (R2, 15 Aug
   * 2026). Money arrived and the rest is still owed, still chased.
   *
   * It exists because a single-label ladder could not say both halves at
   * once: the window test used to return LATE before the money test was
   * reached, so a week with $200 of $2,000 on it read exactly like a week
   * with nothing on it, and the chase then told a member who had paid that
   * nothing arrived.
   */
  | "PARTIAL_LATE"
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
  // A DEFERRED WEEK IS NOT IN THE CURRENT EXPECTATION (D-42, §2.29a).
  //
  // Deferring is the organizer saying "I have agreed not to chase this week".
  // It is a PAUSE, not a write-off: the week leaves what is owed right now —
  // not expected, not chased, not in "N of M paid" — and its money is kept in
  // `amountDeferred`, resolving at close either by being paid or by carrying
  // into the person's balance (2.18).
  //
  // AMENDED 15 Aug 2026. Until then this returned true for an elapsed deferred
  // week, and the comment here said so in terms: "a deferred week that has
  // ELAPSED still counts as due… the money is owed either way". That was the
  // pre-D-42 law; §2.29a supersedes it, and keeping the old sentence beside
  // the new behaviour would be the §5.5 defect — a comment as the bug's best
  // camouflage.
  //
  // The mark still cannot pull a not-yet-due deferred week forward: deferral
  // outranks the mark across all five effects (2.29), so the check below is
  // reached only for weeks he has NOT paused.
  if (args.isDeferred) return false;
  if (args.markedLate) return true;
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
  const daysSinceWeekOpened = Math.floor((utcDay(args.today) - utcDay(args.weekDate)) / MS_PER_DAY);
  const windowClosed = daysSinceWeekOpened >= windowDays;
  // THE MONEY AND THE CALENDAR, COMBINED — never one or the other (R2, and
  // ONE_TRUTH_ENGINE.md rule 1). Both halves are read before a word is chosen,
  // so a part-paid week that is being chased says so instead of reading as
  // though nothing came in.
  const part = args.amountPaid > 0;
  const chased = args.markedLate || windowClosed;
  if (chased) return part ? "PARTIAL_LATE" : "LATE";
  return part ? "PARTIAL" : "UNPAID";
}

/**
 * IS THIS WEEK BEING CHASED — the one predicate, for all six consumers.
 *
 * A part-paid week whose window has closed is chased exactly like an unpaid
 * one: the remainder is still owed (R2). Six places used to ask
 * `status === "LATE"` for this, and after the sixth state arrived, six copies
 * of `LATE || PARTIAL_LATE` would be six chances to forget the second half —
 * and forgetting it drops a real debt off the chase silently, which is the
 * money-visibility trap §3.3 warned about.
 *
 * DEFERRED is deliberately absent: it is paused, and the whole point of a
 * pause is that nobody chases it (D-42).
 */
export function isChasedStatus(status: string): boolean {
  return status === "LATE" || status === "PARTIAL_LATE";
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
 *
 * DEFERRED WEEKS ARE EXCLUDED (D-42, §2.29a, 15 Aug 2026). They are paused,
 * not forgiven: their money is returned by {@link amountDeferred} instead, and
 * resolves at close (2.18). Until this date they counted here, and the
 * docblock said "DEFERRED weeks DO count" — that was the pre-D-42 law.
 *
 * THE TWO ARE A PARTITION, and that is the point: nothing can fall between
 * them, so "paused" can never be read as "paid". Anything totalling what a
 * member owes ALTOGETHER — a cycle-end balance, a carried debt — must add
 * both, and the close paths do.
 *
 * Money recorded on any week still counts — it is money. Never negative. The
 * CALLER chooses the window semantics: pass the weeks that count as due now
 * for "owed now", or the whole commitment for a cycle-end balance.
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
    // A deferred week's money is not owed RIGHT NOW, and its receipts belong
    // with it — counting the payment here while dropping the charge would
    // understate the debt of everyone who part-paid a week before it was
    // paused.
    if (week.isDeferred) continue;
    if (!week.isSkipped) due += week.amountDue;
    paid += week.amountAlreadyPaid;
  }
  return Math.max(0, due - paid);
}

/**
 * What a member's DEFERRED weeks still hold — owed, but not expected now.
 *
 * The other half of the partition with {@link amountOutstanding} (D-42). Not a
 * write-off and not a separate state: it is the money attached to weeks the
 * organizer paused, and §2.29a gives it exactly two endings — filled when they
 * pay (oldest-first, 2.15), or carried into the person's balance at close.
 *
 * PER-WEEK, NOT NETTED. Surplus on a deferred week cannot offset a debt on
 * another deferred week: they are paused independently and resolve
 * independently, so netting them would invent a figure that answers no
 * question anyone asks.
 */
export function amountDeferred(
  weeks: readonly {
    amountDue: number;
    amountAlreadyPaid: number;
    isDeferred: boolean;
    isSkipped?: boolean;
  }[],
): number {
  let held = 0;
  for (const [i, week] of weeks.entries()) {
    if (!week.isDeferred || week.isSkipped) continue;
    assertCents(`week[${i}] amountDue`, week.amountDue);
    assertCents(`week[${i}] amountAlreadyPaid`, week.amountAlreadyPaid);
    held += Math.max(0, week.amountDue - week.amountAlreadyPaid);
  }
  return held;
}
