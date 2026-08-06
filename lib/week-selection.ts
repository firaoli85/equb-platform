// Pure week-selection logic for the catch-up strip (2.15: the organizer
// picks WEEKS, the engine still allocates oldest-first). No money math here
// beyond what a selection needs — totals reuse bulkCatchUpAmount.

export type SelectableWeek = {
  weekNumber: number;
  amountDue: number;
  amountAlreadyPaid: number;
  /** THIS member is not chased for it — the money is still owed. */
  isDeferred?: boolean;
  /** Cycle-wide: the week did not happen, so nobody owes it. */
  isSkipped?: boolean;
};

/**
 * A week the organizer may select: still owed and not SKIPPED. A DEFERRED
 * week IS selectable — deferral spares the chasing, not the debt (organizer
 * ruling, Aug 2026), so catching a member up must be able to clear it.
 */
export function isSelectable(w: SelectableWeek): boolean {
  return !w.isSkipped && w.amountAlreadyPaid < w.amountDue;
}

export function selectableWeekNumbers(weeks: readonly SelectableWeek[]): number[] {
  return weeks.filter(isSelectable).map((w) => w.weekNumber);
}

/**
 * Parse a human range: "7 to 12", "7-12", "7–12", "7..12", or a single "9".
 * Order-forgiving ("12 to 7" means 7..12). Null when it isn't a range.
 */
export function parseWeekRange(text: string): { from: number; to: number } | null {
  const m = text
    .trim()
    .match(/^(\d{1,3})\s*(?:to|[-–—]|\.\.)\s*(\d{1,3})$/i);
  if (m) {
    const a = Number.parseInt(m[1], 10);
    const b = Number.parseInt(m[2], 10);
    if (a < 1 || b < 1) return null;
    return { from: Math.min(a, b), to: Math.max(a, b) };
  }
  const single = text.trim().match(/^(\d{1,3})$/);
  if (single) {
    const n = Number.parseInt(single[1], 10);
    if (n < 1) return null;
    return { from: n, to: n };
  }
  return null;
}

/** The SELECTABLE weeks inside a range — paid/skipped weeks never sneak in. */
export function weeksInRange(
  weeks: readonly SelectableWeek[],
  range: { from: number; to: number },
): number[] {
  return weeks
    .filter((w) => w.weekNumber >= range.from && w.weekNumber <= range.to && isSelectable(w))
    .map((w) => w.weekNumber);
}

/** The N oldest owing weeks (2.15's spirit: oldest debt first). */
export function oldestN(weeks: readonly SelectableWeek[], n: number): number[] {
  return weeks
    .filter(isSelectable)
    .sort((a, b) => a.weekNumber - b.weekNumber)
    .slice(0, Math.max(0, n))
    .map((w) => w.weekNumber);
}
