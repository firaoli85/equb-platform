import {
  parseIsoDay,
  toIsoDay,
  weekDateBounds,
  type DateBounds,
} from "@/lib/date-bounds";
import { PAYMENT_WINDOW_DAYS, weekHasElapsed } from "@/lib/derived";
import type { DashboardParticipation, DashboardPayment } from "@/lib/dashboard";
import { inWindow } from "@/lib/participation-close";

// THE STORED WEEK DATES — the facts every figure on this page stands on.
//
// Rule 7: a week's stored `date` IS the truth for that week. Elapsed, late and
// behind all derive from it plus the payment window, never from counting weeks
// off `cycle.startDate`. The consequence is easy to state and was easy to
// miss: a week dated wrong does not LOOK wrong anywhere — it silently moves
// one member's arrears, and this screen reported the position those dates
// produce without ever showing the dates themselves.
//
// So two gaps, one cause. `/admin/cycle/position` never displayed them
// (`formatDateUTC` was imported by the page and never called), and
// `app/actions/edits.ts` `updateWeek` — which is correct, and which is the
// only way to change one — had zero callers since the old `/admin/cycle/weeks`
// route was deleted. `weekDateBounds` having no production caller either is
// how you can tell from the outside.
//
// Everything here is pure, so the panel renders what these decide and the
// tests pin them without a database or a clock.
//
// THERE IS NOTHING ABOUT SKIPPING IN THIS FILE, and that is deliberate.
// docs/CYCLE_POSITION_SPEC.md PART 2 removed the concept from the UI — "there
// are no skipped weeks in an Equb, every week is a commitment" — and
// docs/MANUAL_QA_CHECKLIST.md makes its absence a PASS condition. The column
// survives because the standing engine reads it; the surface does not.

export type WeekDateRow = {
  id: string;
  weekNumber: number;
  /** YYYY-MM-DD. THE stored fact (rule 7) — not a projection off anything. */
  date: string;
  notes: string | null;
  /** Members whose window covers this week, deferrals and skips excluded. */
  membersExpected: number;
  /** How many of those are short of their weekly amount for it. */
  membersShort: number;
  /**
   * How many members' late-and-behind standing this week's DATE actually
   * decides — which is NOT `membersShort`.
   *
   * It excludes anyone the organizer has marked late by hand (2.2): their week
   * is already due and already LATE whatever the date says, so moving the day
   * changes nothing for them. It INCLUDES anyone whose week is deferred, whom
   * `membersShort` drops before counting — a deferred week that has elapsed
   * still counts toward weeks-behind and still carries its amount (rule 5).
   *
   * Counted in week-dates-data.ts, where both facts still exist.
   */
  membersAffectedByDate: number;
};

/**
 * How many members' late-and-behind standing a week's DATE actually decides.
 *
 * TWO DERIVATIONS, TWO QUESTIONS — and this one exists because the other one
 * answers the wrong question here.
 *
 *   `receiptsByWeek` → membersShort   "who has not covered this week"
 *   this             → affected       "whose standing does the DAY decide"
 *
 * They are different sets, in BOTH directions:
 *
 *   MARKED LATE — in `membersShort`, NOT affected by the date. `paymentStatus`
 *   returns LATE on the organizer's own mark before it looks at the window,
 *   and `weekCountsAsDue` makes the week due whatever the day says (2.2). The
 *   date decides nothing for them.
 *
 *   DEFERRED — affected by the date, but DROPPED from `membersShort`:
 *   `weekReceipts` runs `if (payment?.isDeferred) continue;` before it counts.
 *   Yet an elapsed deferred week still counts toward weeks-behind and still
 *   carries its amount (only SKIPPED is excused — DOMAIN_RULES rule 5), so
 *   their standing moves with the day like anyone else's.
 *
 * PINNED, not merely commented: `week-dates.test.ts` builds one fixture holding
 * both cases and asserts the two counts DIFFER. Anyone who collapses them back
 * into one number fails the build with that fixture named.
 *
 * Takes the same two input types `receiptsByWeek` takes, so both can be run
 * over one set of rows and compared — which is the only way the divergence can
 * be asserted at all.
 */
export function membersAffectedByWeekDate(input: {
  weekNumber: number;
  isSkipped: boolean;
  participations: readonly DashboardParticipation[];
  payments: readonly DashboardPayment[];
}): number {
  // Nobody owes a skipped week, so its day decides nothing for anyone.
  if (input.isSkipped) return 0;
  const rowFor = new Map(
    input.payments
      .filter((p) => p.weekNumber === input.weekNumber)
      .map((p) => [p.participationId, p]),
  );
  let affected = 0;
  for (const participation of input.participations) {
    // Their own window, breaks included (2.18) — a week they were away for is
    // not a week they can be late for.
    if (!inWindow(participation, input.weekNumber)) continue;
    const row = rowFor.get(participation.id);
    // Money is the truth: a covered week is untouched by any date (2.14).
    if ((row?.amountPaid ?? 0) >= participation.weeklyAmount) continue;
    // Already late by his own hand — the day is not what decides it (2.2).
    if (row?.markedLate) continue;
    affected++;
  }
  return affected;
}

const MS_PER_DAY = 86_400_000;

/**
 * The day this week's payment window shuts — its own date plus the window.
 *
 * Display only, and derived from the SAME constant `weekHasElapsed` uses, so
 * the day printed here is the day the arithmetic actually turns on. Two
 * copies of that boundary is how one screen calls a week closed while another
 * calls it open, which is the drift rule 7 exists to prevent.
 */
export function weekWindowClosesOn(
  dateIso: string,
  windowDays: number = PAYMENT_WINDOW_DAYS,
): string | null {
  const day = parseIsoDay(dateIso);
  if (day === null) return null;
  return toIsoDay(new Date(day.getTime() + windowDays * MS_PER_DAY));
}

/**
 * Where a week sits against today.
 *
 * `closed` — its payment window has shut; unpaid money for it is overdue.
 * `open`   — the week has arrived and its window is still running. Nobody is
 *            overdue for it, and no message may say they are.
 * `ahead`  — the day has not come yet.
 *
 * The `closed` half is `weekHasElapsed` verbatim rather than a second
 * comparison, for the reason above.
 */
export type WeekClock = "closed" | "open" | "ahead";

export function weekClock(input: {
  date: string;
  today: Date;
  windowDays?: number;
}): WeekClock | null {
  const day = parseIsoDay(input.date);
  if (day === null) return null;
  if (
    weekHasElapsed({ weekDate: day, today: input.today, windowClosesDays: input.windowDays })
  ) {
    return "closed";
  }
  // UTC days on both sides, matching weekHasElapsed — a local-calendar
  // comparison here would disagree with it for several hours a day.
  return toIsoDay(input.today) >= input.date ? "open" : "ahead";
}

/** The words for a clock state. Never "overdue": that word is about money. */
export function weekClockLabel(clock: WeekClock): string {
  return clock === "closed" ? "window closed" : clock === "open" ? "window open" : "not yet";
}

/**
 * THE BOUND FOR ONE WEEK'S DATE, from its neighbours in the same cycle.
 *
 * This is the production caller `weekDateBounds` never had. The rule itself
 * lives in `lib/date-bounds.ts` and is unchanged; all this does is find the
 * two weeks either side, which is the part a screen was always going to have
 * to do and the part nobody had written.
 */
export function boundsForWeek(rows: readonly WeekDateRow[], weekNumber: number): DateBounds {
  const sorted = [...rows].sort((a, b) => a.weekNumber - b.weekNumber);
  const index = sorted.findIndex((r) => r.weekNumber === weekNumber);
  if (index === -1) return weekDateBounds({});
  const neighbour = (row: WeekDateRow | undefined) => {
    if (!row) return null;
    const date = parseIsoDay(row.date);
    // A neighbour whose own date is unreadable cannot bound anything. Leaving
    // that side unbounded is right: it is the corrupt row that needs fixing,
    // and refusing every edit until it is fixed would trap the organizer.
    return date === null ? null : { weekNumber: row.weekNumber, date };
  };
  return weekDateBounds({
    previousWeek: neighbour(sorted[index - 1]),
    nextWeek: neighbour(sorted[index + 1]),
  });
}

/**
 * Weeks whose stored date does not run after the week before them.
 *
 * Audit finding 29 is the reason this exists: the server used to accept a
 * backwards week date, so live rows may already carry one. A ladder running
 * backwards makes "which week closed first" unanswerable, moves who counts as
 * overdue, and mis-dates every week generated afterwards — `nextWeekDates`
 * anchors on the last stored row.
 *
 * Only the offending week is named. The anchor stays on the last week that
 * was in sequence, so one bad row does not flag every row after it and turn a
 * pointed warning into noise.
 */
export function outOfSequenceWeeks(rows: readonly WeekDateRow[]): number[] {
  const sorted = [...rows].sort((a, b) => a.weekNumber - b.weekNumber);
  const faults: number[] = [];
  let previous: WeekDateRow | null = null;
  for (const row of sorted) {
    if (parseIsoDay(row.date) === null) {
      faults.push(row.weekNumber);
      continue;
    }
    // YYYY-MM-DD sorts lexicographically in the same order it sorts
    // chronologically, so this is the same comparison weekDateBounds makes.
    if (previous !== null && row.date <= previous.date) {
      faults.push(row.weekNumber);
      continue;
    }
    previous = row;
  }
  return faults;
}

/**
 * WHAT MOVING A WEEK'S DATE ACTUALLY DOES — computed, not asserted.
 *
 * The organizer is about to change the fact that decides who is late for this
 * week. "This may affect member standing" is the kind of warning nobody reads
 * because it never says anything. These fields carry the real figures: which
 * day the window shuts before and after, whether the week counts as elapsed
 * either side of the change, and how many members are short of it.
 *
 * `formatDay` is injected so the sentences print dates in exactly the same
 * form as the rest of the screen — the same shape `collectionSentence` uses
 * for money.
 *
 * Returns null when the date is unreadable or unchanged: there is no honest
 * consequence to state for a move that is not a move.
 */
export type WeekDateChange = {
  weekNumber: number;
  fromDate: string;
  toDate: string;
  /** The day the payment window shuts, before and after the change. */
  fromCloses: string | null;
  toCloses: string | null;
  wasElapsed: boolean;
  willBeElapsed: boolean;
  membersShort: number;
  /** The move itself, and the window either side of it. */
  facts: string[];
  /** WHO this moves. The consequence he may have missed — stated loudly. */
  standing: string;
  /**
   * WHAT THE MOVE DOES TO THE MONEY FIGURES — and what it genuinely does not.
   *
   * This slot was called `reassurance` and held one constant sentence: "No
   * money moves. Every payment stays on week N — only the day the week
   * happened changes." The first half is true of the RECEIPT ROWS and false of
   * every figure built on the date. Elapsed comes from this day and nothing
   * else (rule 7), and elapsed is the filter feeding `weeksBehind` and
   * `amountOutstanding` in `lib/standing.ts` and LATE in
   * `lib/derived.ts` `paymentStatus`. Drag a week forward past its payment
   * window and a member who is current becomes a member who is late, with
   * money reading as overdue that was not overdue a second earlier; drag it
   * back and the reverse. The platform was reassuring him about the one thing
   * the button actually changes.
   *
   * THE NAME WENT WITH THE SENTENCE, deliberately. A field called
   * `reassurance` can only ever hold a comforting string, so the slot itself
   * was half the defect — the same shape as §5.15, a reason that outlives its
   * cause. This one is named after the question instead, and it has to answer
   * both halves of it.
   */
  whatMoves: string;
};

export function describeWeekDateChange(input: {
  row: Pick<WeekDateRow, "weekNumber" | "date" | "membersShort" | "membersAffectedByDate">;
  /** The proposed date, YYYY-MM-DD. */
  to: string;
  today: Date;
  windowDays?: number;
  formatDay: (date: Date) => string;
}): WeekDateChange | null {
  const from = parseIsoDay(input.row.date);
  const to = parseIsoDay(input.to);
  if (from === null || to === null) return null;
  if (input.row.date === input.to) return null;

  const windowDays = input.windowDays ?? PAYMENT_WINDOW_DAYS;
  const wasElapsed = weekHasElapsed({
    weekDate: from,
    today: input.today,
    windowClosesDays: windowDays,
  });
  const willBeElapsed = weekHasElapsed({
    weekDate: to,
    today: input.today,
    windowClosesDays: windowDays,
  });
  const fromCloses = weekWindowClosesOn(input.row.date, windowDays);
  const toCloses = weekWindowClosesOn(input.to, windowDays);

  const week = input.row.weekNumber;
  const short = input.row.membersShort;
  // WHO THE DATE ACTUALLY DECIDES IT FOR. See the field's note: this is the
  // population whose standing moves, and `short` is the population who have
  // not covered the week. They are different sets, in both directions.
  const moved = input.row.membersAffectedByDate;
  const people = (n: number) => `${n} member${n === 1 ? "" : "s"}`;
  // The verb has to agree with the count, or the one case the organizer sees
  // most often — a single member — reads as a bug in the sentence.
  const verb = (n: number, one: string, many: string) => (n === 1 ? one : many);
  const day = (iso: string | null) => {
    const parsed = iso === null ? null : parseIsoDay(iso);
    return parsed === null ? iso ?? "an unreadable date" : input.formatDay(parsed);
  };

  const facts = [
    `Week ${week} moves from ${day(input.row.date)} to ${day(input.to)}.`,
    `Its payment window shuts ${windowDays} days after the week's own date: ${day(fromCloses)} as things stand, ${day(toCloses)} once this is saved.`,
  ];

  let standing: string;
  if (wasElapsed && !willBeElapsed) {
    standing =
      short > 0
        ? `${people(short)} ${verb(short, "counts", "count")} as overdue for week ${week} today. On the new date its window has not shut yet, so they stop being overdue for it until ${day(toCloses)}.`
        : `Nobody is short for week ${week}, so no member's standing moves — but the week stops counting as elapsed until ${day(toCloses)}.`;
  } else if (!wasElapsed && willBeElapsed) {
    standing =
      short > 0
        ? `Week ${week} is still open today, so nobody is overdue for it. On the new date its window has already shut, and ${people(short)} ${verb(short, "counts", "count")} as overdue for week ${week} the moment you save.`
        : `Week ${week} starts counting as elapsed the moment you save. Everyone in window has paid it, so nobody becomes overdue.`;
  } else if (wasElapsed) {
    standing =
      short > 0
        ? `Week ${week} counts as elapsed before and after, so nobody's overdue standing changes today — ${people(short)} ${verb(short, "is", "are")} short for it either way.`
        : `Week ${week} counts as elapsed before and after, and nobody is short for it. No member's standing changes.`;
  } else {
    standing = `Week ${week}'s window is still open before and after, so nobody is overdue for it either way.`;
  }

  // BOTH HALVES, AND THE TRUE HALF FIRST.
  //
  // The receipts genuinely do not move — money is allocated by week NUMBER and
  // each receipt already sits on its own week row (2.15) — and that is worth
  // saying, because a receipt landing somewhere else is what an organizer fears
  // about a date edit. But it was the ONLY thing being said, and it was said
  // identically for a move that flips who is late and a move that flips
  // nothing, which is how one sentence managed to be true for the harmless case
  // and false for the dangerous one.
  const receiptsStay =
    `No receipt moves: every payment stays on week ${week}, nothing is re-allocated, and ` +
    `nobody hands over a cent because of this.`;
  // The count is only stated when there is one. "0 members are short for it"
  // reads as a figure the organizer has to check; silence does not.
  const movedClause =
    moved > 0 ? ` — it decides this for ${people(moved)}` : "";
  const whatMoves =
    wasElapsed === willBeElapsed
      ? // The claim is SCOPED to what is actually unchanged. This week's place
        // in the elapsed set is the same either side, so the behind-count and
        // the overdue money built on it are the same either side. It does not
        // claim nothing anywhere moves: the day itself is printed in a dozen
        // places, and past the last stored row it is also what "which week are
        // we in" counts from.
        `${receiptsStay} And no member's weeks behind or overdue money moves either: week ` +
        `${week} ${wasElapsed ? "counts as elapsed" : "has not elapsed"} before and after, so ` +
        `the same weeks are counted against everyone whose window covers it.`
      : moved === 0
        ? // THE DATE FLIPS, AND IT MOVES NOBODY. Everyone in window has either
          // covered the week or been marked late by hand, so there is no
          // standing left for the day to decide. Saying "who counts as late
          // changes" here would be the old false promise inverted.
          `${receiptsStay} Week ${week} ${willBeElapsed ? "starts" : "stops"} counting as ` +
          `elapsed, but that decides nothing for anybody: every member whose window covers ` +
          `it has either paid it or been marked late by hand already.`
        : `${receiptsStay} What DOES move is who counts as late. For anyone you have NOT ` +
          `already marked late by hand, this day is what decides whether week ${week}'s ` +
          `payment window has shut, and that is what decides late and behind (rule 7): week ` +
          `${week} ${willBeElapsed ? "starts" : "stops"} counting against them${movedClause}, ` +
          `so their weeks behind, what reads as overdue for them, and what a late notice ` +
          `would say all change the moment you save.`;

  return {
    weekNumber: week,
    fromDate: input.row.date,
    toDate: input.to,
    fromCloses,
    toCloses,
    wasElapsed,
    willBeElapsed,
    membersShort: short,
    facts,
    standing,
    whatMoves,
  };
}
