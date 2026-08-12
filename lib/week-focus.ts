// ARRIVING AT A WEEK (ADMIN_IA §8, §5.1–§5.4).
//
//   "A week number or date → that week, on Payments."
//
// Eleven places already wrote `/admin/payments?week=7` — the cash chart, the
// collected-vs-expected chart, the consistency strip, the cash page's three
// tables. `lib/context-linking.test.ts` checked that every one of those links
// EXISTS. Nothing checked that the destination reads it, and it did not:
// `PaymentsPage` took no `searchParams` at all, so eleven links landed on the
// unfocused default and the organizer had to find week 7 again by eye.
//
// The parsing is here rather than inline because the failure modes are worth
// pinning: `?week=abc` must not throw, `?week=99` on a 20-week cycle must not
// highlight nothing while claiming to, and `?week=7&week=8` (which the URL
// spec allows and a double-click can produce) must resolve to one of them
// rather than to `NaN`.

/**
 * The week a link asked for, or null.
 *
 * Null means "show everything", which is also what an unreadable or
 * out-of-range value means — a request the screen cannot honour is answered
 * by the ordinary view, never by a highlight pointing at nothing.
 */
export function focusedWeek(
  raw: string | string[] | undefined,
  weeksInCycle: number,
): number | null {
  // A repeated param arrives as an array. The FIRST is the one the link
  // carried; a second is an accident of history or a stale form.
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) return null;

  // `Number()` on "" is 0 and on " 7 " is 7 — neither is a week the organizer
  // asked for by clicking something, so the shape is checked before the value.
  if (!/^\d+$/.test(value)) return null;

  const week = Number(value);
  if (week < 1 || week > weeksInCycle) return null;
  return week;
}

/**
 * The sentence the screen shows when it has been pointed at one week.
 *
 * It names the week and says the rest is still there, because a filtered
 * screen that does not announce itself is one the organizer reads as the whole
 * truth — the same failure `truncationNotice` exists to prevent.
 */
export function focusNotice(week: number): string {
  return `Showing week ${week}. Every other week is still below.`;
}
