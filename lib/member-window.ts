// THE MEMBER'S OWN FRAME — dates and their own counts, never cycle weeks.
//
// A cycle week number is the ORGANIZER'S administrative coordinate. He runs a
// 20-week cycle and thinks in it all day. The member does not. They think:
// "I started on this date and I am paying for ten weeks."
//
// Two things went wrong every time the portal showed a cycle week number:
//
//   IT MEANT NOTHING. "Your weeks run from 14 to 23" is a coordinate in a
//   system the reader has never seen. There is no week 14 in their life.
//
//   IT IMPLIED THEY WERE LATE. "You joined in week 14" reads as arriving late
//   to something already running. That is not how an Equb works — 2.22 is
//   explicit that everyone simply has their own window, that windows differ
//   from person to person, "and that is normal".
//
// So the portal speaks in a start DATE, a NUMBER OF WEEKS, and a finish DATE.
// Where an index genuinely helps — reading down a list of ten rows — it is
// THEIR ordinal, "week 3 of your 10", counted from their own start.
//
// The admin keeps cycle week numbers everywhere. That is the organizer's frame
// and it is correct there. `lib/member-vocabulary.test.ts` guards the split.

/** Their position in their OWN window, 1-based. Null outside it. */
export function ownWeekNumber(input: {
  /** The cycle's week number, as stored. */
  weekNumber: number;
  /** The cycle week their window opens on. */
  startWeek: number;
  weeksCommitted: number;
}): number | null {
  const own = input.weekNumber - input.startWeek + 1;
  if (own < 1 || own > input.weeksCommitted) return null;
  return own;
}

/**
 * THE LINE THE PORTAL LEADS WITH.
 *
 *   "You started Sunday, August 16, 2026 and you are paying for 10 weeks —
 *    you finish Sunday, October 18, 2026."
 *
 * Three facts, all of them theirs. No cycle week appears, and nothing suggests
 * they came in late to something already running.
 *
 * Degrades honestly: a missing date is dropped rather than printed as a
 * placeholder, because a sentence about someone's own money must not contain
 * a dash where a day should be.
 */
export function memberWindowSentence(input: {
  /** Their first week's own date. Null when no week row exists yet. */
  startDate: Date | null;
  weeksCommitted: number;
  /** Their last week's own date. Null when it falls past the generated weeks. */
  finishDate: Date | null;
  formatDate: (date: Date) => string;
}): string {
  const weeks = `${input.weeksCommitted} week${input.weeksCommitted === 1 ? "" : "s"}`;
  const opening =
    input.startDate !== null
      ? `You started ${input.formatDate(input.startDate)} and you are paying for ${weeks}`
      : `You are paying for ${weeks}`;
  return input.finishDate !== null
    ? `${opening} — you finish ${input.formatDate(input.finishDate)}.`
    : `${opening}.`;
}

/** "week 3 of your 10" — an index only where reading down a list needs one. */
export function ownWeekLabel(own: number, weeksCommitted: number): string {
  return `week ${own} of your ${weeksCommitted}`;
}

/** "3 of 10 weeks paid" — their own denominator, never the cycle's. */
export function ownProgressLabel(paid: number, weeksCommitted: number): string {
  return `${paid} of ${weeksCommitted} weeks paid`;
}

/**
 * What a week OUTSIDE their window is, said in their terms.
 *
 * "Before you joined" carries the same late-arrival implication the headline
 * had, so the boundary is stated as a date: the reader can check it against
 * their own memory of when they started, which a week number never allowed.
 */
export function outsideWindowLabel(input: {
  side: "before" | "after";
  /** The day their window opens or closes. */
  boundary: Date | null;
  formatDate: (date: Date) => string;
}): string {
  if (input.boundary === null) {
    return input.side === "before" ? "Before your weeks started" : "After your last week";
  }
  return input.side === "before"
    ? `Before you started — your weeks begin ${input.formatDate(input.boundary)}`
    : `After you finish — your last week is ${input.formatDate(input.boundary)}`;
}
