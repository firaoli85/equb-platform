// Lucky-number assignment rules: auto by default, full manual control always
// (2.23). Numbers are PER CYCLE; the @@unique([cycleId, number]) constraint
// remains the durable backstop underneath these checks.

/**
 * Validate organizer-typed numbers BEFORE saving: right count for the
 * contribution's split, positive whole numbers, no duplicates, none already
 * used in this cycle. Returns a plain-language reason or null when valid.
 */
export function validateManualNumbers(input: {
  numbers: readonly number[];
  requiredCount: number;
  taken: ReadonlySet<number>;
}): string | null {
  const { numbers, requiredCount, taken } = input;
  if (numbers.length !== requiredCount) {
    return `This contribution splits into ${requiredCount} number${requiredCount === 1 ? "" : "s"} — enter exactly ${requiredCount}.`;
  }
  for (const n of numbers) {
    if (!Number.isSafeInteger(n) || n < 1) {
      return `"${n}" is not a valid lucky number — use positive whole numbers.`;
    }
  }
  const seen = new Set<number>();
  for (const n of numbers) {
    if (seen.has(n)) return `Number ${n} is entered twice.`;
    seen.add(n);
  }
  for (const n of numbers) {
    if (taken.has(n)) return `Number ${n} is already taken in this cycle.`;
  }
  return null;
}

/**
 * Auto-assignment, in the organizer's own words: "fresh numbers assign
 * incrementally from 1 with manual override available; carry-over reuses
 * previous numbers WHERE FREE."
 *
 * So carry-over is per-number, not all-or-nothing. Someone who held #15 and
 * #155 last cycle and finds #155 taken keeps #15 and gets the next free value
 * for the second — losing both because one clashed was never the rule, and it
 * silently renumbered people who could have kept their number.
 *
 * Fresh mode (no preferred set) is the next FREE SEQUENTIAL values counting up
 * from 1, so gaps left by edits are reused naturally.
 */
export function chooseAutoNumbers(input: {
  count: number;
  taken: ReadonlySet<number>;
  preferred?: readonly number[];
}): number[] {
  const { count, taken, preferred } = input;
  const chosen: number[] = [];
  // Working copy: a number picked here must not be picked twice.
  const used = new Set<number>(taken);

  for (const n of preferred ?? []) {
    if (chosen.length >= count) break;
    if (!Number.isSafeInteger(n) || n < 1 || used.has(n)) continue;
    chosen.push(n);
    used.add(n);
  }
  for (let candidate = 1; chosen.length < count; candidate++) {
    if (used.has(candidate)) continue;
    chosen.push(candidate);
    used.add(candidate);
  }
  return chosen;
}

// ————————————————————————————————————————————————————————————————
// A NUMBER ALREADY IN USE — say who has it, then offer a real choice.
// ————————————————————————————————————————————————————————————————
//
// "Number 22 is already taken in this cycle" is true and useless: it does not
// say who has it, and it leaves the organizer with nothing to do but guess
// another number. Two intentions are possible and only he knows which:
//
//   REPLACE — #22 belongs to THIS member; the current holder is renumbered.
//   KEEP    — #22 stays where it is; this member takes the next free number.
//
// The database's @@unique([cycleId, number]) remains the durable backstop
// underneath both.

/** Who currently holds a number, and whether it can be taken from them. */
export type NumberHolder = {
  luckyNumberId: string;
  number: number;
  participationId: string;
  memberName: string;
  /** The number sits in a drawn slot — it has left the pool for good (2.27). */
  drawn: boolean;
  /** Money recorded against it. */
  payoutCount: number;
};

export type NumberConflict = {
  number: number;
  holder: NumberHolder;
  /** The plain sentence naming the holder. */
  message: string;
  /** Why the number cannot be taken from them, or null when it can. */
  replaceRefusal: string | null;
  /** What KEEP would assign instead — computed, never guessed at by the UI. */
  suggestedNumber: number;
};

/**
 * Why this number cannot be taken from its current holder, or null.
 *
 * A DRAWN number is history: it identifies who won a week, and the payout
 * record is read back through it. Renumbering it would rewrite that record
 * from underneath, so the swap is refused and only KEEP is offered — the
 * organizer can still edit the drawn number itself, deliberately, on its own
 * row.
 */
export function replaceHolderRefusal(holder: NumberHolder): string | null {
  if (holder.drawn) {
    return (
      `#${holder.number} has already been drawn for ${holder.memberName} — it is the record of ` +
      `a week they won, so it cannot be handed to someone else.`
    );
  }
  if (holder.payoutCount > 0) {
    return (
      `#${holder.number} has ${holder.payoutCount} payout record${holder.payoutCount === 1 ? "" : "s"} ` +
      `against it for ${holder.memberName} — money is recorded on that number, so it cannot be ` +
      `handed to someone else.`
    );
  }
  return null;
}

/**
 * The full conflict, as the UI needs it: who has it, whether it can be taken,
 * and what KEEP would assign instead.
 */
export function describeNumberConflict(input: {
  number: number;
  holder: NumberHolder;
  taken: ReadonlySet<number>;
  /** The number being vacated by this edit, if any — the swap partner. */
  vacating?: number | null;
}): NumberConflict {
  const refusal = replaceHolderRefusal(input.holder);
  const suggested = chooseAutoNumbers({ count: 1, taken: input.taken })[0];
  // Where the current holder ends up under REPLACE. A swap when this edit
  // vacates a number (nobody is left without one), otherwise the next free
  // value. Written as its own clause so the member's NAME keeps its capital —
  // splicing it mid-sentence is how "Meheret" became "meheret".
  const swapNote =
    input.vacating != null
      ? `${input.holder.memberName} would take #${input.vacating} in the swap`
      : `${input.holder.memberName} would move to #${suggested}`;
  return {
    number: input.number,
    holder: input.holder,
    message:
      `#${input.number} already belongs to ${input.holder.memberName} in this cycle. ` +
      (refusal
        ? `${refusal} Choose another number instead — #${suggested} is free.`
        : `Replace it — ${swapNote}. Or keep it where it is and take #${suggested} instead.`),
    replaceRefusal: refusal,
    suggestedNumber: suggested,
  };
}
