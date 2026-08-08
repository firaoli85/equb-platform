// A MEMBER'S OWN RECORD OF A FINISHED CYCLE.
//
// Why this exists at all: the archive is the member's ONLY copy of their
// financial history. Without it the sole record of what they paid into a
// twenty-week cycle, what they received and what they still owe sits with the
// organizer. That is not an acceptable place for it to sit alone.
//
// TWO RULES SHAPE EVERYTHING HERE.
//
//   1. IT COMES FROM THE FROZEN ARCHIVE, NOT FROM LIVE ROWS. Closing writes a
//      snapshot (2.9) and the admin archive page renders that snapshot
//      verbatim. If this re-derived the figures from participations instead,
//      the member and the organizer could open the same cycle and read
//      different numbers — and the member has no way to tell which is right.
//
//   2. IT IS NEVER MISTAKEN FOR THE CURRENT CYCLE. Every summary carries the
//      cycle's own name and its start and finish dates spelled out in full,
//      and nothing that produces one is reachable from the home screen while
//      a live cycle exists.
//
// PRIVACY. The stored snapshot holds EVERY member's figures. `mine()` pulls
// out one row by personId and nothing else crosses the wire — the caller must
// never hand a whole archive to a client component.

/** The subset of the stored snapshot this module reads. */
export type StoredArchive = {
  cycleName: string;
  startDate: string;
  closedAt: string;
  plannedWeeks: number;
  members: readonly {
    personId: string;
    weeklyAmount: number;
    weeksCommitted: number;
    weeksPaid: number;
    outstanding: number;
    drawnWeek: number | null;
    receivedNet: number;
    pendingNet: number;
    totalPaid: number;
  }[];
  weeks?: readonly { weekNumber: number; date: string }[];
};

export type PastCycle = {
  cycleId: string;
  cycleName: string;
  /** Spelled out: "May 17, 2026". Never a week number on its own — a week
   *  number means nothing to the person reading it months later. */
  startLabel: string;
  finishLabel: string;
  weeksCommitted: number;
  weeksPaid: number;
  /** Cents they actually paid in across the whole cycle. */
  totalPaid: number;
  /** Cents handed over to them, and the week their number came up. */
  receivedNet: number;
  drawnWeek: number | null;
  /** Cents awarded but not yet collected when the cycle closed. */
  pendingNet: number;
  /** Cents still owed at close. Zero means complete. */
  outstanding: number;
  /** The closing line, already worded. */
  closing: string;
  /** True when the snapshot could not be read — say so rather than show zeroes. */
  unreadable: boolean;
};

const DAY = { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" } as const;

/** "May 17, 2026" from an ISO date, or null when it cannot be read. */
export function fullDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", DAY);
}

/**
 * The closing sentence for a finished cycle.
 *
 * "$0, complete" is deliberately not "$0" — a bare zero on a money screen
 * reads as missing data. The member has to be told they finished.
 */
export function closingLine(input: {
  outstanding: number;
  pendingNet: number;
  cycleName: string;
}): string {
  if (input.outstanding > 0) {
    return (
      `${money(input.outstanding)} outstanding — what was left unpaid when ${input.cycleName} ` +
      `closed. It moved to your carried balance, which is the same money, not a second debt.`
    );
  }
  if (input.pendingNet > 0) {
    return (
      `Complete — nothing owed. ${money(input.pendingNet)} of your payout had not been handed ` +
      `over when the cycle closed; speak to the organizer if you have not received it.`
    );
  }
  return "$0 outstanding — complete.";
}

/** Local formatter so this module stays importable from a client component. */
function money(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  const rem = abs % 100;
  const base = rem === 0 ? `$${whole}` : `$${whole}.${String(rem).padStart(2, "0")}`;
  return negative ? `-${base}` : base;
}

/**
 * One member's row out of a stored archive, or an honest placeholder.
 *
 * A snapshot that will not parse, or that has no row for this person, still
 * produces a summary: the cycle happened and they were in it, and hiding the
 * entry entirely would look like the record had been lost. `unreadable` says
 * which case the reader is looking at.
 */
export function mine(input: {
  cycleId: string;
  /** The stored JSON. Parsed here so a bad blob cannot take the page down. */
  raw: string;
  personId: string;
  /** Used only when the snapshot cannot supply them. */
  fallback: { cycleName: string; startDate: Date | null; closedAt: Date | null };
}): PastCycle {
  const empty = (cycleName: string, start: string | null, finish: string | null): PastCycle => ({
    cycleId: input.cycleId,
    cycleName,
    startLabel: start ?? "date not recorded",
    finishLabel: finish ?? "date not recorded",
    weeksCommitted: 0,
    weeksPaid: 0,
    totalPaid: 0,
    receivedNet: 0,
    drawnWeek: null,
    pendingNet: 0,
    outstanding: 0,
    closing:
      "This cycle's detailed record could not be read. Ask the organizer for a copy — the " +
      "figures still exist, this page simply cannot show them.",
    unreadable: true,
  });

  const fallbackStart = input.fallback.startDate?.toISOString() ?? null;
  const fallbackFinish = input.fallback.closedAt?.toISOString() ?? null;

  let parsed: StoredArchive;
  try {
    parsed = JSON.parse(input.raw) as StoredArchive;
  } catch {
    return empty(
      input.fallback.cycleName,
      fullDate(fallbackStart),
      fullDate(fallbackFinish),
    );
  }

  const name = parsed.cycleName || input.fallback.cycleName;
  // The last WEEK's date is the true finish, not the day the organizer got
  // round to pressing close — those can be days apart, and the member
  // remembers the week.
  const lastWeek = parsed.weeks?.length
    ? [...parsed.weeks].sort((a, b) => a.weekNumber - b.weekNumber).at(-1)?.date
    : null;
  const start = fullDate(parsed.startDate ?? fallbackStart);
  const finish = fullDate(lastWeek ?? parsed.closedAt ?? fallbackFinish);

  const row = parsed.members?.find((m) => m.personId === input.personId);
  if (!row) return empty(name, start, finish);

  return {
    cycleId: input.cycleId,
    cycleName: name,
    startLabel: start ?? "date not recorded",
    finishLabel: finish ?? "date not recorded",
    weeksCommitted: row.weeksCommitted,
    weeksPaid: row.weeksPaid,
    totalPaid: row.totalPaid,
    receivedNet: row.receivedNet,
    drawnWeek: row.drawnWeek,
    pendingNet: row.pendingNet,
    outstanding: row.outstanding,
    closing: closingLine({
      outstanding: row.outstanding,
      pendingNet: row.pendingNet,
      cycleName: name,
    }),
    unreadable: false,
  };
}

/**
 * The one line the home screen shows a member who is not in the running
 * cycle, above the summary of their most recent one.
 *
 * Calm on purpose. The old behaviour rendered their LAST cycle's savings ring,
 * week grid and "next payment due" with no label at all, so a member whose
 * cycle ended in September opened the app in November and saw what looked
 * like a live cycle they were behind on.
 */
export function notInCurrentCycleLine(hasPast: boolean): string {
  return hasPast
    ? "Your record below is from a finished cycle. Nothing is due, and nothing here is a bill."
    : "When the organizer adds you to a cycle, it will appear here.";
}
