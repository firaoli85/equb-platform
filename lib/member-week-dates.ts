// MEMBER-RELATIVE WEEKS, WITH THEIR DATES — the composer behind the v2
// statement templates (switchover build, Aug 2026).
//
// THE PRINCIPLE (organizer): statements speak the member's OWN weeks paired
// with real dates, never the group calendar. "Week 14" is the organizer's
// coordinate; a ten-week member who joined mid-cycle has a week 1 of their
// own, and that — with its date — is the only numbering they can read
// (UI_STANDARDS 8c, 2.22: everyone simply has their own window).
//
//   single week            "2 (Aug 23)"
//   contiguous range       "2–3 (Aug 23 – Aug 30)"
//   non-contiguous list    "2 (Aug 23) and 4 (Sep 6)"
//   runs mix freely        "2–3 (Aug 23 – Aug 30) and 5 (Sep 13)"
//
// PURE, AND STRICT ABOUT ITS INPUTS. The date beside a week is the STORED
// week row's date (rule 7) — callers resolve it before composing, and this
// file never projects one from a start date. Every date renders in UTC like
// every other date in the platform (rule 11).

export type MemberWeekDate = {
  /** The member's own week number — 1 is THEIR first week. */
  ownWeek: number;
  /** The stored date of that week's row (rule 7 — resolved by the caller). */
  date: Date;
};

/**
 * A cycle week in the member's own numbering.
 *
 * Their week 1 is `startWeek`; a founding member's numbers coincide with the
 * cycle's, a mid-cycle joiner's do not — same calendar dates, different
 * numbers, which is the entire reason this function exists.
 */
export function ownWeekNumber(cycleWeek: number, startWeek: number): number {
  if (!Number.isSafeInteger(cycleWeek) || !Number.isSafeInteger(startWeek) || startWeek < 1) {
    throw new RangeError(`ownWeekNumber needs integers (cycleWeek ${cycleWeek}, startWeek ${startWeek})`);
  }
  return cycleWeek - startWeek + 1;
}

/** "Aug 23" — the short form the approved bodies carry inline. UTC, no year. */
function shortDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * "Sunday, July 26" — the FULL form the v3 bodies carry: weekday and month
 * written out, no year (the samples Meta approved carry none). UTC, rule 11.
 */
export function memberFullDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** One week with its date: "2 (Aug 23)". */
export function memberWeekLabel(week: MemberWeekDate): string {
  return `${week.ownWeek} (${shortDate(week.date)})`;
}

/** One week with its FULL date: "11 (Sunday, July 26)" — the v3 form. */
export function memberWeekLabelFull(week: MemberWeekDate): string {
  return `${week.ownWeek} (${memberFullDate(week.date)})`;
}

/**
 * The v3 LIST form — plain enumeration, dates grouped in ONE bracket:
 *
 *   single      "12 (Aug 2)"
 *   two         "12 and 13 (Aug 2 and Aug 9)"
 *   three plus  "12, 13 and 14 (Aug 2, Aug 9 and Aug 16)"
 *
 * NO RANGES AND NO DASHES — the organizer's v3 standing rules (14 Aug 2026):
 * maximally simple, and dashes are banned from member-facing text. The v2
 * range form ("2–3 (Aug 23 – Aug 30)") survives only inside the frozen
 * payment_confirmed_v2 body via memberWeeksPhrase below.
 */
export function memberWeeksListPhrase(weeks: readonly MemberWeekDate[]): string {
  if (weeks.length === 0) return "";

  const byWeek = new Map<number, MemberWeekDate>();
  for (const week of weeks) byWeek.set(week.ownWeek, week);
  const sorted = [...byWeek.values()].sort((a, b) => a.ownWeek - b.ownWeek);

  if (sorted.length === 1) return memberWeekLabel(sorted[0]);

  const joinAnd = (parts: readonly string[]) =>
    `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  const numbers = joinAnd(sorted.map((w) => String(w.ownWeek)));
  const dates = joinAnd(sorted.map((w) => shortDate(w.date)));
  return `${numbers} (${dates})`;
}

/**
 * The composed phrase for ANY set of a member's weeks.
 *
 * Sorted, deduplicated, grouped into contiguous runs; a run of one renders
 * as a single, a run of many as a range — "2–3 (Aug 23 – Aug 30)", the en
 * dash unspaced between week numbers and spaced between dates, exactly as
 * approved. Runs join with commas and a final "and".
 *
 * Empty in, empty out: a statement with zero weeks to name is refused
 * upstream at the extras boundary — this composes, it does not judge.
 */
export function memberWeeksPhrase(weeks: readonly MemberWeekDate[]): string {
  if (weeks.length === 0) return "";

  const byWeek = new Map<number, MemberWeekDate>();
  for (const week of weeks) byWeek.set(week.ownWeek, week);
  const sorted = [...byWeek.values()].sort((a, b) => a.ownWeek - b.ownWeek);

  const runs: MemberWeekDate[][] = [];
  for (const week of sorted) {
    const current = runs[runs.length - 1];
    if (current && week.ownWeek === current[current.length - 1].ownWeek + 1) {
      current.push(week);
    } else {
      runs.push([week]);
    }
  }

  const parts = runs.map((run) =>
    run.length === 1
      ? memberWeekLabel(run[0])
      : `${run[0].ownWeek}–${run[run.length - 1].ownWeek} ` +
        `(${shortDate(run[0].date)} – ${shortDate(run[run.length - 1].date)})`,
  );

  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * Convenience for callers holding CYCLE week numbers (the shape standing and
 * extras carry): converts to the member's own numbering and pairs each with
 * its stored date, then composes.
 *
 * STRICT: a cycle week with no stored date is a STOP, not an approximation —
 * rule 7 says the stored dates are authoritative, and a phrase that guessed
 * a date would put a wrong day in an approved sentence a member keeps.
 */
export function memberWeeksPhraseFromCycleWeeks(input: {
  cycleWeeks: readonly number[];
  startWeek: number;
  /** cycle week number → its stored date. */
  weekDates: ReadonlyMap<number, Date>;
}): string {
  return memberWeeksPhrase(resolveOwnWeeks(input));
}

/** The v3 list form, from cycle week numbers — same strict date resolution. */
export function memberWeeksListPhraseFromCycleWeeks(input: {
  cycleWeeks: readonly number[];
  startWeek: number;
  weekDates: ReadonlyMap<number, Date>;
}): string {
  return memberWeeksListPhrase(resolveOwnWeeks(input));
}

function resolveOwnWeeks(input: {
  cycleWeeks: readonly number[];
  startWeek: number;
  weekDates: ReadonlyMap<number, Date>;
}): MemberWeekDate[] {
  return input.cycleWeeks.map((cycleWeek) => {
    const date = input.weekDates.get(cycleWeek);
    if (!date) {
      throw new RangeError(
        `No stored date for cycle week ${cycleWeek} — rule 7 forbids projecting one into a member statement.`,
      );
    }
    return { ownWeek: ownWeekNumber(cycleWeek, input.startWeek), date };
  });
}
