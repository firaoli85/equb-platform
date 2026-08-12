// SELECTION AND AMOUNT ARE TWO VIEWS OF ONE NUMBER.
//
// Recording money is the thing the organizer does most, and it was the slowest
// screen in the platform: one week at a time, with the arithmetic done in his
// head. "Getahun paid $2,000, that's weeks 8, 9, 10 and 11" is a sum he should
// never have to do, and a sum he can get wrong.
//
// So the entry works from either end:
//
//   TICK WEEKS  → the amount fills in    (four weeks at $500 = $2,000)
//   TYPE AN AMOUNT → the weeks light up  ($1,750 = weeks 8, 9, 10 and $250
//                                         toward week 11)
//
// TICKING COMPUTES AN AMOUNT. IT NEVER PINS THE MONEY.
//
// That distinction is the whole reason this module is small and boring.
// §2.15 says money is allocated OLDEST DEBT FIRST and the organizer never
// picks the week — because a member four weeks behind who sends money is
// paying down the oldest debt, not the current week. Letting a tick pin money
// to week 11 would let week 5 sit unpaid, which is the exact mistake the rule
// removed.
//
// So nothing here decides where money LANDS. It answers one question — "how
// much is this many weeks?" — and the real allocation engine
// (`allocatePayment`, 2.19) does the rest. When the engine lands the money
// somewhere other than what was ticked, `allocationOutsideSelection` says so
// before anything commits.

/** A week the organizer can tick, with what it still needs. */
export type PickableWeek = {
  weekNumber: number;
  /** Cents this week costs them. */
  amountDue: number;
  /** Cents already covered here. */
  amountPaid: number;
  /** Nobody owes a skipped week, so it can never be ticked. */
  isSkipped: boolean;
  /** Not chased, but still owed — tickable (2.15: deferred is not skipped). */
  isDeferred: boolean;
};

/** What a week still needs. Never negative — an overpaid week needs nothing. */
export function remainingOn(week: PickableWeek): number {
  if (week.isSkipped) return 0;
  return Math.max(0, week.amountDue - week.amountPaid);
}

/** Can this week be ticked at all? A skipped or fully-paid week cannot. */
export function isPickable(week: PickableWeek): boolean {
  return !week.isSkipped && remainingOn(week) > 0;
}

// ————————————————— Weeks → amount —————————————————

/**
 * What the ticked weeks add up to.
 *
 * The sum of what each still NEEDS, not of what each costs: ticking a week
 * that is half paid should produce the half that is missing, or the organizer
 * types a figure that overshoots and the remainder lands somewhere he did not
 * intend.
 */
export function amountForWeeks(
  weeks: readonly PickableWeek[],
  selected: ReadonlySet<number>,
): number {
  return weeks
    .filter((w) => selected.has(w.weekNumber) && isPickable(w))
    .reduce((sum, w) => sum + remainingOn(w), 0);
}

// ————————————————— Amount → weeks —————————————————

export type AmountCoverage = {
  /** Weeks this amount covers in FULL, oldest first. */
  fullWeeks: number[];
  /** The week the leftover part-pays, if any. */
  partialWeek: number | null;
  /** Cents landing on that partial week. */
  partialAmount: number;
  /** Cents that fit nowhere — their window cannot absorb it. */
  unallocated: number;
};

/**
 * What an amount covers, oldest-debt-first.
 *
 * A PREVIEW of the engine's own rule, so the squares can fill while he types.
 * It is deliberately the same walk `allocatePayment` performs, and the commit
 * still goes through that engine — this never writes and is never the
 * authority. If the two ever disagree, the engine is right and this is a bug.
 */
export function coverageForAmount(
  weeks: readonly PickableWeek[],
  amount: number,
): AmountCoverage {
  const fullWeeks: number[] = [];
  let left = Math.max(0, amount);
  let partialWeek: number | null = null;
  let partialAmount = 0;

  for (const week of [...weeks].sort((a, b) => a.weekNumber - b.weekNumber)) {
    if (left <= 0) break;
    const needs = remainingOn(week);
    // A skipped week is passed over entirely — nobody owes it, so money must
    // not stop there on its way to a week that IS owed.
    if (needs <= 0) continue;
    if (left >= needs) {
      fullWeeks.push(week.weekNumber);
      left -= needs;
    } else {
      partialWeek = week.weekNumber;
      partialAmount = left;
      left = 0;
    }
  }

  return { fullWeeks, partialWeek, partialAmount, unallocated: left };
}

/** The weeks an amount touches at all — full and partial together. */
export function weeksTouchedBy(coverage: AmountCoverage): number[] {
  return coverage.partialWeek === null
    ? [...coverage.fullWeeks]
    : [...coverage.fullWeeks, coverage.partialWeek];
}

// ————————————————— The quick amounts —————————————————

export type QuickAmount = {
  label: string;
  amount: number;
  /** The weeks it works out to, for filling the squares on hover. */
  weeks: number[];
};

/**
 * The two or three figures he actually reaches for, computed from THEIR real
 * weeks — never a tier list.
 *
 * "One week" and "everything owed" are the two ends of almost every
 * conversation. The middle option only appears when it differs from both,
 * because a chip that duplicates its neighbour is a chip he has to read twice.
 */
export function quickAmounts(weeks: readonly PickableWeek[]): QuickAmount[] {
  const owing = [...weeks].filter(isPickable).sort((a, b) => a.weekNumber - b.weekNumber);
  if (owing.length === 0) return [];

  const make = (label: string, n: number): QuickAmount => {
    const take = owing.slice(0, n);
    return {
      label,
      amount: take.reduce((s, w) => s + remainingOn(w), 0),
      weeks: take.map((w) => w.weekNumber),
    };
  };

  const out: QuickAmount[] = [make("1 week", 1)];
  if (owing.length >= 4) out.push(make("4 weeks", 4));
  if (owing.length > 1) {
    out.push({
      label: `All ${owing.length} owed`,
      amount: owing.reduce((s, w) => s + remainingOn(w), 0),
      weeks: owing.map((w) => w.weekNumber),
    });
  }
  // Drop any chip that came out identical to another — same money, same weeks.
  return out.filter((c, i) => out.findIndex((o) => o.amount === c.amount) === i);
}

// ————————————————— Dragging across the squares —————————————————

/**
 * The weeks between two squares, inclusive, in either drag direction.
 *
 * Only PICKABLE weeks come back: dragging across a paid or skipped week must
 * not silently add it, and must not stop the drag either — he is sweeping a
 * range, not clicking each one.
 */
export function weeksInDrag(
  weeks: readonly PickableWeek[],
  from: number,
  to: number,
): number[] {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  return weeks
    .filter((w) => w.weekNumber >= lo && w.weekNumber <= hi && isPickable(w))
    .map((w) => w.weekNumber)
    .sort((a, b) => a - b);
}

// ————————————————— What the entry says —————————————————

/**
 * The sentence beneath the amount, in the organizer's own register.
 *
 * ALWAYS states the remainder, even when it is zero — "partial payments are
 * first-class, not a special case" means the leftover line does not appear and
 * disappear, because a field that comes and goes is one he stops reading.
 */
export function coverageSentence(
  coverage: AmountCoverage,
  money: (cents: number) => string,
): string {
  const parts: string[] = [];

  if (coverage.fullWeeks.length === 0 && coverage.partialWeek === null) {
    return coverage.unallocated > 0
      ? `${money(coverage.unallocated)} fits nowhere — their weeks are already covered.`
      : "Nothing to record yet.";
  }

  if (coverage.fullWeeks.length === 1) {
    parts.push(`covers week ${coverage.fullWeeks[0]} in full`);
  } else if (coverage.fullWeeks.length > 1) {
    const list = coverage.fullWeeks.join(", ").replace(/, (\d+)$/, " and $1");
    parts.push(`covers weeks ${list} in full`);
  }

  if (coverage.partialWeek !== null) {
    // "leaves" only reads as a continuation. On its own — an amount smaller
    // than a single week — the partial IS the whole sentence, and joining on
    // "and leaves" produced "This $123.45 toward week 5."
    parts.push(
      `${parts.length === 0 ? "leaves " : ""}${money(coverage.partialAmount)} toward week ${coverage.partialWeek}`,
    );
  }

  const head = `This ${parts.join(", and leaves ")}.`;
  return coverage.unallocated > 0
    ? `${head} ${money(coverage.unallocated)} fits nowhere — reduce the amount.`
    : head;
}
