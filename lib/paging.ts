// PAGING, IN ONE PLACE.
//
// The audit log was paged and nothing else was, and the lists that were not
// fell into two groups — both wrong, in opposite directions:
//
//   UNBOUNDED. Receipts on a member profile and the balances screen loaded
//   every row there had ever been. Fine at 189 receipts; the balances query
//   loaded every person WITH every ledger entry each of them had, and both
//   grow forever. Cycle three would not open.
//
//   SILENTLY CAPPED. The message log took 100 and the sign-in history 25,
//   with nothing on screen saying so. That is the worse failure: an unbounded
//   list is slow, and a silently truncated one is a LIE. An organizer looking
//   for a message he sent last cycle scrolls to the bottom, does not find it,
//   and concludes it was never sent.
//
// The rule this module encodes: a list is either fully shown, paged, or
// visibly truncated. It is never quietly cut off.

export type PageInfo = {
  page: number;
  pages: number;
  total: number;
  skip: number;
  take: number;
  /** 1-based position of the first row shown, or 0 when there are none. */
  firstShown: number;
  lastShown: number;
  hasPrevious: boolean;
  hasNext: boolean;
};

/**
 * Where a page sits in the whole.
 *
 * A page past the end is CLAMPED rather than shown empty: filters narrow while
 * a page number stays put — pick a filter while reading page 7 and there may
 * be one page — and an empty screen reads as "there is nothing here".
 */
export function pageInfo(total: number, page: number, pageSize: number): PageInfo {
  const size = Math.max(1, Math.floor(pageSize));
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const skip = (current - 1) * size;
  return {
    page: current,
    pages,
    total,
    skip,
    take: size,
    firstShown: total === 0 ? 0 : skip + 1,
    lastShown: Math.min(skip + size, total),
    hasPrevious: current > 1,
    hasNext: current < pages,
  };
}

/** A `?page=` value from the URL, as a usable number. */
export function parsePage(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const n = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * What this page is showing, as a sentence — always, including when it is
 * showing everything.
 *
 * A list that shows part of itself while looking whole is how someone
 * concludes a record does not exist.
 */
export function pageSummary(info: PageInfo, noun: { one: string; many: string }): string {
  if (info.total === 0) return `No ${noun.many}.`;
  if (info.pages === 1) {
    return info.total === 1 ? `1 ${noun.one}.` : `All ${info.total} ${noun.many}.`;
  }
  return `${info.firstShown}–${info.lastShown} of ${info.total} ${noun.many}.`;
}

/**
 * How many rows a screen shows at once.
 *
 * These live here rather than beside their actions because a `"use server"`
 * file may only export async functions — exporting a constant from one is a
 * build error, which is how they got here.
 */
export const PAGE_SIZES = {
  /** Balances are one line per person, so this is generous. */
  balances: 50,
  /** The send log: one row per message, each carrying its full text. */
  messageLog: 50,
  /**
   * A member's receipts. One editable row each, and the list grows with every
   * payment for as long as the person is in the group — a fourth-cycle member
   * has hundreds. Small enough that a page is a screenful, large enough that
   * a normal cycle's receipts are one or two pages.
   */
  receipts: 40,
  /** Cash readings, newest first — one line each. */
  cashReadings: 25,
} as const;

// ————————————————— Caps, for lists that are not paged —————————————————

/**
 * A hard ceiling on a list that has no paging.
 *
 * Used where a list is small in practice but has no structural bound — the
 * people directory grows one row per person the group ever had, which is slow
 * growth and still unbounded. The cap keeps one query from ever loading an
 * arbitrary number of rows; `truncationNotice` is what stops it lying.
 */
export const CAPS = {
  /** Directory rows. Twenty-seven today; a decade of members is well under. */
  people: 500,
  /** Sign-ins on one member, newest first. */
  memberSignIns: 25,
  /** A member's own devices. */
  ownSessions: 50,
  /** Messages sent to one member, newest first, on their profile. */
  memberMessages: 25,
} as const;

/**
 * The line a capped list must show when it has actually hit its cap, or null.
 *
 * Returns null when nothing was cut, so a list that fits says nothing at all —
 * a permanent "showing the first N" on a list of 27 is noise that trains the
 * reader to skip the one time it matters.
 */
export function truncationNotice(input: {
  shown: number;
  cap: number;
  noun: string;
  /** Where the whole thing can be read, when there is such a place. */
  fullListAt?: string;
}): string | null {
  if (input.shown < input.cap) return null;
  return (
    `Showing the first ${input.cap} ${input.noun}. There are more than this` +
    (input.fullListAt ? `, and the rest are on ${input.fullListAt}.` : ".")
  );
}
