// THE commitment shape rules (ground truth 2.22), pure and unit-tested.
//
// The organizer must NEVER calculate a finish date. Two things follow, and both
// live here so every surface that edits a start week or a weeks figure behaves
// identically:
//
//   1. FINISH WITH THE GROUP — the default. Weeks committed TRACKS the start
//      week so a late joiner lands on the cycle's last week. Join at week 15 of
//      20 and the figure is 6, not "whatever was typed last".
//   2. THE FINISH IS ALWAYS VISIBLE — week number AND calendar date, recomputed
//      live as either field changes, whether or not the toggle is on.
//
// The 2.22 cap and its deliberate override are unchanged by any of this: the
// cap is what "finish with the group" fills in, and exceeding it still requires
// the explicit organizer override.

import { weekHasElapsed } from "./derived";
import {
  calculateFinishWeek,
  currentWeekNumber,
  dateOfWeek,
  remainingWeeksInCycle,
} from "./money";

const MS_PER_DAY = 86_400_000;

/**
 * Read a number out of a free-text field. Returns null for empty, non-numeric,
 * fractional or below-1 input — the UI shows nothing rather than guessing, so a
 * half-typed "1" never renders a finish for week 1.
 */
export function parseWeekField(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(n) || n < 1) return null;
  return n;
}

/**
 * How many weeks make them finish WITH the group (2.22): every remaining week
 * from their start through the planned end. Never below 1 — a member joining
 * after the planned end still commits to at least one week, and that is the
 * case the override exists for.
 */
export function weeksToFinishWithGroup(plannedWeeks: number, startWeek: number): number {
  return Math.max(1, remainingWeeksInCycle(plannedWeeks, Math.min(startWeek, plannedWeeks)));
}

/**
 * The stored week rows, keyed by week number. A `Week` row records WHAT
 * ACTUALLY HAPPENED — the day money was due, the day a draw ran — so it is the
 * authority for that week's date (2.14, 2.7).
 */
export type StoredWeekDates = ReadonlyMap<number, Date>;

/** Build the lookup from whatever shape the caller has its week rows in. */
export function storedWeekDates(
  weeks: readonly { weekNumber: number; date: Date | string }[],
): Map<number, Date> {
  const map = new Map<number, Date>();
  for (const w of weeks) {
    const d = w.date instanceof Date ? w.date : new Date(w.date);
    if (Number.isNaN(d.getTime())) continue;
    map.set(w.weekNumber, d);
  }
  return map;
}

export type ResolvedWeekDate = {
  date: Date;
  /**
   * "stored" — read from the week row, the day that actually happened.
   * "computed" — no row exists for this week (past the planned end, or the
   * cycle's weeks are not generated yet), so the weekly rhythm was projected.
   */
  source: "stored" | "computed";
};

/**
 * THE date of a week. The STORED row always wins; the calendar is projected
 * only where no row exists.
 *
 * This matters because a cycle's start date can be edited (2.23) while its
 * existing week rows are deliberately kept as historical facts — computing
 * over them would silently rewrite the day a payment was due or a draw ran.
 * Every date shown for a week number goes through here.
 */
export function resolveWeekDate(input: {
  weekNumber: number;
  stored?: StoredWeekDates | null;
  /** Only used when no stored row exists for this week number. */
  cycleStartDate: Date;
}): ResolvedWeekDate | null {
  const fromRow = input.stored?.get(input.weekNumber);
  if (fromRow && !Number.isNaN(fromRow.getTime())) {
    return { date: fromRow, source: "stored" };
  }
  if (Number.isNaN(input.cycleStartDate.getTime())) return null;
  if (!Number.isSafeInteger(input.weekNumber) || input.weekNumber < 1) return null;
  return { date: dateOfWeek(input.cycleStartDate, input.weekNumber), source: "computed" };
}

/**
 * The dates for weeks that do not exist yet, continuing the weekly rhythm from
 * the LAST STORED week rather than from the cycle's start date.
 *
 * This is the write-side half of the same ruling. `Cycle.startDate` is
 * editable while existing week rows are deliberately kept (2.14), so
 * projecting a new row off the current start date can date week N+1 BEFORE
 * week N — a ladder running backwards, which would make the later week read
 * LATE before the earlier one. Anchoring on the last real row cannot do that.
 *
 * Falls back to the cycle start only when there is no stored week at all.
 */
export function nextWeekDates(input: {
  existing: readonly { weekNumber: number; date: Date }[];
  fromWeek: number;
  toWeek: number;
  cycleStartDate: Date;
}): { weekNumber: number; date: Date }[] {
  const have = new Map(input.existing.map((w) => [w.weekNumber, w.date]));
  let anchor = [...input.existing]
    .filter((w) => !Number.isNaN(w.date.getTime()))
    .sort((a, b) => a.weekNumber - b.weekNumber)
    .at(-1) ?? { weekNumber: 1, date: input.cycleStartDate };

  const made: { weekNumber: number; date: Date }[] = [];
  for (let n = input.fromWeek; n <= input.toWeek; n++) {
    const already = have.get(n);
    if (already) {
      // An existing row past the anchor becomes the new anchor: the rhythm
      // always continues from real recorded days.
      if (n > anchor.weekNumber && !Number.isNaN(already.getTime())) {
        anchor = { weekNumber: n, date: already };
      }
      continue;
    }
    const date = new Date(anchor.date.getTime() + (n - anchor.weekNumber) * 7 * MS_PER_DAY);
    made.push({ weekNumber: n, date });
  }
  return made;
}

/**
 * The last week whose OWN stored date has passed its payment window — the
 * boundary every MONEY number uses (2.14). Pass a cycle's week rows; weeks
 * outside a member's window are filtered by the caller.
 *
 * 0 when nothing has elapsed yet. Never derived from `cycle.startDate`: that
 * column is editable, and arrears may not move because it was corrected.
 */
export function elapsedThroughWeek(
  weeks: readonly { weekNumber: number; date: Date }[],
  today: Date,
  windowClosesDays?: number,
): number {
  let last = 0;
  for (const w of weeks) {
    if (Number.isNaN(w.date.getTime())) continue;
    if (!weekHasElapsed({ weekDate: w.date, today, windowClosesDays })) continue;
    if (w.weekNumber > last) last = w.weekNumber;
  }
  return last;
}

/**
 * Which week the cycle is IN, from the stored rows: the highest week whose
 * date has ARRIVED. No payment-window grace — this answers "where are we", not
 * "what is overdue", so it is the right clock for questions like whether a
 * member's participation window is currently open (2.27 eligibility).
 *
 * Falls back to projecting off the cycle start only past the last stored row.
 */
export function currentWeekFromRows(input: {
  weeks: readonly { weekNumber: number; date: Date }[];
  today: Date;
  cycleStartDate: Date;
}): number {
  let last = 0;
  let lastDate: Date | null = null;
  for (const w of input.weeks) {
    if (Number.isNaN(w.date.getTime())) continue;
    if (w.date.getTime() > input.today.getTime()) continue;
    if (w.weekNumber > last) {
      last = w.weekNumber;
      lastDate = w.date;
    }
  }
  if (last === 0) return currentWeekNumber(input.cycleStartDate, input.today);
  // Past the last stored row the rhythm continues from that row, not from a
  // start date that may since have been corrected.
  const weeksSince = Math.floor(
    (input.today.getTime() - lastDate!.getTime()) / (7 * MS_PER_DAY),
  );
  return last + Math.max(0, weeksSince);
}

export type FinishPreview = {
  startWeek: number;
  weeksCommitted: number;
  /** The last week they pay, inclusive. */
  finishWeek: number;
  /** That week's calendar date — the STORED row when one exists. */
  finishDate: Date;
  /** Where finishDate came from. "computed" only when no week row exists. */
  finishDateSource: "stored" | "computed";
  /** Weeks beyond the cycle's planned end; 0 when they finish within it. */
  weeksPastPlannedEnd: number;
  /** True when they land exactly on the cycle's last planned week. */
  finishesWithGroup: boolean;
};

/**
 * Everything a live finish line needs, or null when the inputs are not yet a
 * complete commitment. Valid past the planned end (2.7/2.22 — override weeks
 * keep the same weekly rhythm), so the preview keeps working while the
 * organizer is deciding whether to extend.
 */
export function finishPreview(input: {
  cycleStartDate: Date;
  plannedWeeks: number;
  startWeek: number | null;
  weeksCommitted: number | null;
  /**
   * The cycle's week rows. Supply them wherever they are in hand: the finish
   * date is then the day that ACTUALLY belongs to that week, not a projection
   * off a start date that may since have been edited.
   */
  stored?: StoredWeekDates | null;
}): FinishPreview | null {
  const { startWeek, weeksCommitted } = input;
  if (startWeek === null || weeksCommitted === null) return null;
  if (!Number.isSafeInteger(startWeek) || startWeek < 1) return null;
  if (!Number.isSafeInteger(weeksCommitted) || weeksCommitted < 1) return null;

  const finishWeek = calculateFinishWeek(startWeek, weeksCommitted);
  const resolved = resolveWeekDate({
    weekNumber: finishWeek,
    stored: input.stored,
    cycleStartDate: input.cycleStartDate,
  });
  if (resolved === null) return null;

  return {
    startWeek,
    weeksCommitted,
    finishWeek,
    finishDate: resolved.date,
    finishDateSource: resolved.source,
    weeksPastPlannedEnd: Math.max(0, finishWeek - input.plannedWeeks),
    finishesWithGroup: finishWeek === input.plannedWeeks,
  };
}

/**
 * The same preview for a WHOLE CYCLE. A cycle has no start week — week 1 IS
 * its start date — so its finish week is always its planned length. Exposed
 * separately so the cycle forms cannot drift into a fourth local formula, and
 * so they print the identical sentence as every member surface.
 */
export function cycleFinishPreview(input: {
  cycleStartDate: Date;
  plannedWeeks: number | null;
  stored?: StoredWeekDates | null;
}): FinishPreview | null {
  if (input.plannedWeeks === null) return null;
  return finishPreview({
    cycleStartDate: input.cycleStartDate,
    plannedWeeks: input.plannedWeeks,
    startWeek: 1,
    weeksCommitted: input.plannedWeeks,
    stored: input.stored,
  });
}

/**
 * THE sentence, identical on every surface: "Finishes week 20 — Sunday,
 * September 27, 2026". The date formatter is injected so this stays pure and
 * the caller keeps one formatting decision.
 *
 * When the commitment runs past the planned end the sentence says so in the
 * same breath — that is the moment the override matters, so it is never
 * something the organizer has to notice for themselves.
 */
export function finishLine(
  preview: FinishPreview,
  formatDate: (date: Date) => string,
  plannedWeeks?: number,
): string {
  const base = `Finishes week ${preview.finishWeek} — ${formatDate(preview.finishDate)}`;
  if (preview.weeksPastPlannedEnd === 0) return base;
  const n = preview.weeksPastPlannedEnd;
  const planned = plannedWeeks ?? preview.finishWeek - n;
  return `${base} — ${n} week${n === 1 ? "" : "s"} past the planned ${planned}`;
}

export type CommitmentCap = {
  /** The most weeks allowed without the override (2.22). 0 past the end. */
  cap: number;
  /** True when the entered figure needs the override to be legal. */
  exceedsCap: boolean;
};

/**
 * The 2.22 cap for a start week, and whether the entered figure breaks it.
 * Unchanged behaviour: the cap is advisory in the UI and enforced server-side;
 * `extendPastPlannedEnd` is the only thing that legitimises exceeding it.
 */
export function commitmentCap(input: {
  plannedWeeks: number;
  startWeek: number | null;
  weeksCommitted: number | null;
  extendPastPlannedEnd: boolean;
}): CommitmentCap | null {
  if (input.startWeek === null) return null;
  // NOT clamped to plannedWeeks: a start week past the planned end genuinely
  // has a cap of 0, and the UI says so ("the planned weeks are over"). Only
  // weeksToFinishWithGroup clamps, because a 0-week commitment is not one.
  const cap = remainingWeeksInCycle(input.plannedWeeks, input.startWeek);
  const exceedsCap =
    !input.extendPastPlannedEnd && input.weeksCommitted !== null && input.weeksCommitted > cap;
  return { cap, exceedsCap };
}
