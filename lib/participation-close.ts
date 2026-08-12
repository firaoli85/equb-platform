// CLOSING A PARTICIPATION MID-CYCLE — so the cash position tells the truth.
//
// Two members stopped and will not resume. The system went on counting their
// remaining weeks as money that should arrive, so every forward figure was
// inflated by money that will never come. The organizer could see he was short
// but not WHY, because a member who has stopped and a member who is merely
// late looked identical on every screen.
//
// THEY ARE NOT THE SAME FACT, and conflating them is the whole problem:
//
//   BEHIND  — the money is late. It is still coming. Chase it.
//   STOPPED — the money is not coming. Record it, and stop counting on it.
//
// WHAT CLOSING IS NOT. It is not `removeParticipation` (edits.ts), which
// deletes the row, its receipts and its payouts outright. Closing keeps
// everything: every cent they paid stays exactly as recorded, they keep their
// portal, and the record of where they stopped survives into the archive
// (2.18). What ENDS is the expectation of money from the closing point on.
//
// EVERYTHING HERE IS PURE. The window rule is the only mechanism: a closed
// participation's window ends at `closedAtWeek`, so every derived figure in
// the platform — expected, behind, outstanding, the pool (2.27) — follows
// from one line in `effectiveFinishWeek`, and no screen needs a special case.

import { formatMoney } from "./format";
import { calculateFinishWeek } from "./money";

// ————————————————— The reason (neutral, never personal) —————————————————

/**
 * Why they stopped, from a fixed neutral list.
 *
 * A free-text reason on a financial record about a real person becomes a
 * character note, and it outlives the cycle in the archive. The list is
 * deliberately flat and blameless: none of these say anything about the member
 * beyond the fact that they are no longer contributing. "Other" carries a
 * note, and that note is about the ARRANGEMENT, never the person.
 */
export const CLOSE_REASONS = [
  {
    key: "STOPPED_CONTRIBUTING",
    label: "Stopped contributing",
    hint: "They have stopped paying and have not said they will resume.",
  },
  {
    key: "COULD_NOT_CONTINUE",
    label: "Could not continue",
    hint: "Circumstances changed. The organizer absorbs the gap (2.18).",
  },
  {
    key: "LEFT_THE_GROUP",
    label: "Left the group",
    hint: "They are no longer part of the Equb.",
  },
  { key: "OTHER", label: "Other", hint: "Add a short factual note." },
] as const;

export type CloseReason = (typeof CLOSE_REASONS)[number]["key"];

export function isCloseReason(value: unknown): value is CloseReason {
  return CLOSE_REASONS.some((r) => r.key === value);
}

export function closeReasonLabel(key: string): string {
  return CLOSE_REASONS.find((r) => r.key === key)?.label ?? key;
}

/** The reason as it reads on the record. "Other" is nothing without its note. */
export function closeReasonText(reason: CloseReason, note: string | null): string {
  const label = closeReasonLabel(reason);
  const trimmed = note?.trim();
  return trimmed ? `${label} — ${trimmed}` : label;
}

// ————————————————— The window rule, and the whole mechanism —————————————————

/** A stretch of weeks they were not part of the cycle. Open while `toWeek` is null. */
export type WindowBreak = {
  /** First week NOT counted. */
  fromWeek: number;
  /** Last week not counted. Null while they are still stopped. */
  toWeek: number | null;
};

export type ClosableWindow = {
  startWeek: number;
  weeksCommitted: number;
  /** Stretches they were away. Absent or empty means they never stopped. */
  breaks?: readonly WindowBreak[];
};

/** Is this week inside one of the stretches they were away? */
export function inBreak(breaks: readonly WindowBreak[] | undefined, weekNumber: number): boolean {
  if (!breaks) return false;
  return breaks.some(
    (b) => weekNumber >= b.fromWeek && (b.toWeek === null || weekNumber <= b.toWeek),
  );
}

/**
 * THE ONE PREDICATE THE WHOLE FEATURE RESTS ON.
 *
 * Every derived figure in the platform already asks "is this week inside their
 * window" — expected, membersExpected, weeks behind, outstanding, and the
 * lucky-number pool (2.27). Adding the breaks here is all it takes for a
 * stopped member to leave every forward expectation at once, with no screen
 * carrying its own rule about it.
 *
 * A BREAK IS A HOLE, NOT A TRUNCATION, and that distinction is the whole
 * reason it is not a single `closedAtWeek` column. Stopping at week 5 opens a
 * break at 6 with no end, so the window really does end there. But bringing
 * them back at week 9 CLOSES that break at 8 — the weeks they were away stay
 * outside their expectation for good, while weeks 9 onward return. Restoring
 * those weeks would invent arrears for weeks nobody ever asked them about, and
 * a truncation cannot express the difference.
 *
 * Their history is never rewritten: weeks BEFORE the break are untouched, and
 * every cent they paid keeps counting whatever this returns.
 */
export function inWindow(p: ClosableWindow, weekNumber: number): boolean {
  if (weekNumber < p.startWeek) return false;
  if (weekNumber > calculateFinishWeek(p.startWeek, p.weeksCommitted)) return false;
  return !inBreak(p.breaks, weekNumber);
}

/**
 * The last week they are counted — their commitment's end, or the week before
 * an OPEN break if one has started.
 *
 * Display and the pool use this; the per-week figures use {@link inWindow},
 * because only that one knows about holes.
 */
export function effectiveFinishWeek(p: ClosableWindow): number {
  const committed = calculateFinishWeek(p.startWeek, p.weeksCommitted);
  const open = (p.breaks ?? []).filter((b) => b.toWeek === null);
  if (open.length === 0) return committed;
  return Math.min(committed, Math.min(...open.map((b) => b.fromWeek - 1)));
}

/**
 * The break to assume for a member closed BEFORE this table existed.
 *
 * `removeFromCycle`'s "keep their money records" choice has always written
 * `status: CLOSED, closedAtWeek: null` — correct at the time, because every
 * screen then filtered CLOSED members out entirely. It is not correct now:
 * this build puts closed members back INTO the series so their paid money
 * still counts, and no break at all would restore their full window and start
 * expecting money from them again. That is the exact bug this build exists to
 * remove, arriving through the back door.
 *
 * So a closed participation with no recorded stopping week is read as having
 * stopped after their LAST PAYMENT — the fact 2.18 preserves about them
 * anyway ("last payment week, amount, and the resulting balance"), derived
 * from the receipts rather than guessed. Never paid at all → they are counted
 * from nowhere, and nothing is ever expected from them.
 *
 * The migration backfills exactly this, so it runs once rather than on every
 * read; it stays here because a row written by an older deploy would otherwise
 * be silently re-expected.
 */
export function legacyBreak(p: {
  status: "ACTIVE" | "CLOSED";
  startWeek: number;
  closedAtWeek: number | null;
  /** Their latest week carrying money, from the receipts. */
  lastWeekWithMoney: number | null;
}): WindowBreak | null {
  if (p.status !== "CLOSED") return null;
  const lastCounted = p.closedAtWeek ?? p.lastWeekWithMoney ?? p.startWeek - 1;
  return { fromWeek: lastCounted + 1, toWeek: null };
}

/**
 * The breaks to use for a participation, whichever deploy wrote it.
 *
 * Rows carry their own; a row closed before the table existed falls back to
 * the derived one above. Never both — a backfilled row already has its break.
 */
export function windowBreaks(p: {
  status: "ACTIVE" | "CLOSED";
  startWeek: number;
  closedAtWeek: number | null;
  lastWeekWithMoney: number | null;
  breaks: readonly WindowBreak[];
}): WindowBreak[] {
  if (p.breaks.length > 0) return [...p.breaks];
  const legacy = legacyBreak(p);
  return legacy ? [legacy] : [];
}

/** Weeks that leave the expectation when they stop here. Never negative. */
export function weeksLeavingExpectation(p: {
  startWeek: number;
  weeksCommitted: number;
  closingAtWeek: number;
}): number {
  const committed = calculateFinishWeek(p.startWeek, p.weeksCommitted);
  return Math.max(0, committed - Math.min(committed, p.closingAtWeek));
}

// ————————————————— Refusals —————————————————

export type CloseCandidate = {
  memberName: string;
  cycleName: string;
  /** ACTIVE cycles only — a closed cycle's books are final (rule 14). */
  cycleStatus: "ACTIVE" | "CLOSED";
  participationStatus: "ACTIVE" | "CLOSED";
  /** A committed winner plan naming one of their numbers (2.3). */
  committedPlan: { weekNumber: number | null; numbers: number[] } | null;
  closingAtWeek: number;
  startWeek: number;
  weeksCommitted: number;
};

/**
 * Why this participation may not be closed — named, never a bare "cannot".
 *
 * THE WINNER-PLAN REFUSAL IS THE ONE THAT MATTERS. A committed plan is frozen
 * (2.3): the organizer has already promised that number a specific week. Taking
 * it out of the pool behind the plan's back would leave a locked plan pointing
 * at a number that can never be drawn, and the draw would then quietly fall
 * through to chance on a week that was supposed to be decided. So it is refused
 * and the plan is NAMED — the organizer can release it and come straight back.
 */
export function closeRefusal(c: CloseCandidate): string | null {
  if (c.cycleStatus === "CLOSED") {
    return (
      `${c.cycleName} is closed. Its books are final, and every carried balance ` +
      `in it was already worked out from these exact receipts.`
    );
  }
  if (c.participationStatus === "CLOSED") {
    return `${c.memberName} is already closed in ${c.cycleName}.`;
  }
  if (c.committedPlan) {
    const nums = c.committedPlan.numbers.map((n) => `#${n}`).join(", ");
    const where =
      c.committedPlan.weekNumber !== null
        ? `week ${c.committedPlan.weekNumber}`
        : "a week you have not dated yet";
    return (
      `${c.memberName} holds a committed winner plan for ${where} (${nums}). ` +
      `Closing would take ${c.committedPlan.numbers.length === 1 ? "that number" : "those numbers"} ` +
      `out of the pool while the plan still promises the win, and the draw would ` +
      `fall through to chance on a week you had already decided. Release the plan first.`
    );
  }
  if (c.closingAtWeek < c.startWeek) {
    return (
      `${c.memberName} starts at week ${c.startWeek}, so they cannot stop at ` +
      `week ${c.closingAtWeek}. Remove them from the cycle instead — they have no ` +
      `weeks to close.`
    );
  }
  return null;
}

/** Why a closed participation may not be reactivated. */
export function reactivateRefusal(c: {
  memberName: string;
  cycleName: string;
  cycleStatus: "ACTIVE" | "CLOSED";
  participationStatus: "ACTIVE" | "CLOSED";
}): string | null {
  if (c.cycleStatus === "CLOSED") {
    return (
      `${c.cycleName} is closed, so ${c.memberName}'s close is permanent. Its books ` +
      `are final and the carried balance is already on their record.`
    );
  }
  if (c.participationStatus === "ACTIVE") {
    return `${c.memberName} is already contributing in ${c.cycleName}.`;
  }
  return null;
}

// ————————————————— The plan: every consequence, in real figures —————————————————

export type ClosePlan = {
  memberName: string;
  cycleName: string;
  closingAtWeek: number;
  /** Weeks that stop being expected: closingAtWeek + 1 .. their finish week. */
  weeksLeaving: number;
  /** Cents that stop being expected. The money that will not arrive. */
  amountLeaving: number;
  /** Unpaid weeks UP TO the closing point — becomes a balance on the PERSON. */
  balanceToRecord: number;
  /** Lucky numbers leaving the pool (2.27). */
  numbersLeavingPool: number[];
  /** Net cents already handed over to them. 0 if they were never paid out. */
  alreadyPaidOut: number;
  /**
   * THE CASE THAT DECIDES THE ARITHMETIC.
   *
   * Paid out, then stopped: the organizer handed over the whole pot against a
   * promise of contributions that will not now arrive. That gap is HIS to
   * cover, and calling it "outstanding" would file it with money he is waiting
   * on. Nobody is going to pay it.
   *
   * Not paid out: the forward weeks simply leave the expectation. Their number
   * leaves the pool with them, so no pot is handed over against those weeks,
   * and there is nothing for him to cover.
   */
  shortfallToCover: number;
};

export function closePlan(input: {
  memberName: string;
  cycleName: string;
  startWeek: number;
  weeksCommitted: number;
  weeklyAmount: number;
  closingAtWeek: number;
  /** Their outstanding cents across weeks up to and including the closing week. */
  outstandingToDate: number;
  /** Every lucky number they hold that is not already drawn. */
  undrawnNumbers: readonly number[];
  /** Net cents of their COLLECTED payouts — money that has actually left. */
  alreadyPaidOut: number;
}): ClosePlan {
  const weeksLeaving = weeksLeavingExpectation(input);
  const amountLeaving = weeksLeaving * input.weeklyAmount;
  return {
    memberName: input.memberName,
    cycleName: input.cycleName,
    closingAtWeek: input.closingAtWeek,
    weeksLeaving,
    amountLeaving,
    balanceToRecord: Math.max(0, input.outstandingToDate),
    numbersLeavingPool: [...input.undrawnNumbers].sort((a, b) => a - b),
    alreadyPaidOut: input.alreadyPaidOut,
    // Only a payout that has actually been handed over creates a hole. A
    // PENDING payout has not left his hands, so there is nothing to cover.
    shortfallToCover: input.alreadyPaidOut > 0 ? amountLeaving : 0,
  };
}

// ————————————————— What it says, in plain English —————————————————

/**
 * The line the cycle position shows for a member who has stopped.
 *
 * The exact register of the rest of the money screens (UI_STANDARDS 8b): no
 * accounting words, no judgement about the person, and the figure named as
 * what it IS rather than filed under a category.
 *
 *   "Meheret was paid $19,600 and stopped at week 12. $8,000 of her
 *    contributions will not arrive — you would need to cover that."
 */
export function stoppedSentence(p: {
  memberName: string;
  closedAtWeek: number;
  amountLeaving: number;
  alreadyPaidOut: number;
  balanceRecorded: number;
}): string {
  const stopped =
    p.alreadyPaidOut > 0
      ? `${p.memberName} was paid ${formatMoney(p.alreadyPaidOut)} and stopped at week ${p.closedAtWeek}.`
      : `${p.memberName} stopped at week ${p.closedAtWeek}.`;

  if (p.alreadyPaidOut > 0 && p.amountLeaving > 0) {
    return (
      `${stopped} ${formatMoney(p.amountLeaving)} of their contributions will not ` +
      `arrive — you would need to cover that.`
    );
  }
  if (p.amountLeaving > 0) {
    return (
      `${stopped} ${formatMoney(p.amountLeaving)} of their contributions will not arrive. ` +
      `They were never paid out, so there is nothing for you to cover.`
    );
  }
  if (p.balanceRecorded > 0) {
    return (
      `${stopped} ${formatMoney(p.balanceRecorded)} they had not paid is now on their ` +
      `record. Nothing further was expected from them.`
    );
  }
  return `${stopped} Nothing further was expected from them.`;
}

/**
 * The confirmation, every consequence in real figures before he commits.
 *
 * One bullet per thing that changes. A confirmation that says "are you sure"
 * and nothing else asks him to trust the software with a decision he cannot
 * see — which is the opposite of 2.23.
 */
export function closeConsequences(plan: ClosePlan): string[] {
  const lines: string[] = [];

  lines.push(
    plan.weeksLeaving > 0
      ? `Weeks ${plan.closingAtWeek + 1} onward — ${plan.weeksLeaving} week${plan.weeksLeaving === 1 ? "" : "s"}, ` +
        `${formatMoney(plan.amountLeaving)} — stop being expected from ${plan.memberName}. ` +
        `They will no longer show as due, behind, or coming in.`
      : `${plan.memberName} has no weeks left to leave — week ${plan.closingAtWeek} is already their last.`,
  );

  lines.push(
    plan.balanceToRecord > 0
      ? `${formatMoney(plan.balanceToRecord)} they have not paid up to week ${plan.closingAtWeek} ` +
        `goes onto their own record, with where it came from. It stays there if this cycle is ` +
        `ever deleted.`
      : `They are paid up to week ${plan.closingAtWeek}, so nothing goes onto their record.`,
  );

  lines.push(
    plan.numbersLeavingPool.length > 0
      ? `${plan.numbersLeavingPool.map((n) => `#${n}`).join(", ")} leave${plan.numbersLeavingPool.length === 1 ? "s" : ""} ` +
        `the wheel. They cannot win a week they are no longer in.`
      : `They hold no undrawn numbers, so the wheel is unchanged.`,
  );

  if (plan.shortfallToCover > 0) {
    lines.push(
      `They were already paid ${formatMoney(plan.alreadyPaidOut)}. That money is gone, and ` +
        `${formatMoney(plan.shortfallToCover)} of contributions against it will not arrive — ` +
        `it becomes yours to cover, not money you are waiting on.`,
    );
  }

  lines.push(
    `Everything ${plan.memberName} paid stays exactly as recorded, and they keep their ` +
      `portal — read-only — showing where they stopped.`,
  );

  lines.push(
    `Reversible while ${plan.cycleName} is open. Reactivating restores their weeks from that ` +
      `point forward, never backwards.`,
  );

  return lines;
}

// ————————————————— Reactivation: forward only —————————————————

export type ReactivatePlan = {
  memberName: string;
  /** The week from which they are expected again. */
  fromWeek: number;
  /** Weeks returning to the expectation. */
  weeksReturning: number;
  /** Cents returning to the expectation. */
  amountReturning: number;
  /** Weeks between the close and the restart that stay closed. */
  weeksStayingClosed: number;
  numbersReturningToPool: number[];
};

/**
 * Restore a stopped member FROM HERE FORWARD, never retroactively.
 *
 * The weeks between the close and the restart are gone on purpose. They really
 * did pass with the member out of the group: nobody chased them, no expectation
 * was recorded against them, and the position was reported to the organizer
 * without them. Restoring those weeks would invent arrears that never existed
 * and would silently change a figure he has already acted on.
 *
 * The member's END is unchanged — they still finish where their commitment
 * said, so their finish week is not pushed out by the pause.
 */
export function reactivatePlan(input: {
  memberName: string;
  startWeek: number;
  weeksCommitted: number;
  weeklyAmount: number;
  closedAtWeek: number;
  /** The week they resume from — normally the current week. */
  fromWeek: number;
  /** Their numbers that are still undrawn. */
  undrawnNumbers: readonly number[];
}): ReactivatePlan {
  const committed = calculateFinishWeek(input.startWeek, input.weeksCommitted);
  // Never before the week they stopped, and never before their own start.
  const from = Math.max(input.fromWeek, input.closedAtWeek + 1, input.startWeek);
  const weeksReturning = Math.max(0, committed - from + 1);
  return {
    memberName: input.memberName,
    fromWeek: from,
    weeksReturning,
    amountReturning: weeksReturning * input.weeklyAmount,
    weeksStayingClosed: Math.max(0, from - input.closedAtWeek - 1),
    numbersReturningToPool: [...input.undrawnNumbers].sort((a, b) => a - b),
  };
}

export function reactivateConsequences(plan: ReactivatePlan): string[] {
  const lines: string[] = [];
  lines.push(
    plan.weeksReturning > 0
      ? `${plan.memberName} is expected again from week ${plan.fromWeek} — ${plan.weeksReturning} ` +
        `week${plan.weeksReturning === 1 ? "" : "s"}, ${formatMoney(plan.amountReturning)}.`
      : `${plan.memberName}'s commitment has already run out, so no weeks come back. Their record ` +
        `stays as it is.`,
  );
  if (plan.weeksStayingClosed > 0) {
    lines.push(
      `The ${plan.weeksStayingClosed} week${plan.weeksStayingClosed === 1 ? "" : "s"} they were ` +
        `away stay closed. Nothing was expected from them then, so nothing is owed for them now.`,
    );
  }
  lines.push(
    plan.numbersReturningToPool.length > 0
      ? `${plan.numbersReturningToPool.map((n) => `#${n}`).join(", ")} ` +
        `${plan.numbersReturningToPool.length === 1 ? "returns" : "return"} to the wheel.`
      : `They hold no undrawn numbers, so the wheel is unchanged.`,
  );
  lines.push(
    `The balance already recorded on their own record stays. It was real when it was written, ` +
      `and a balance belongs to the person (2.18).`,
  );
  return lines;
}
