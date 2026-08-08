import { nextWeekDates } from "./commitment";
import { Prisma } from "./generated/prisma/client";
import { calculateFinishWeek, MAX_MONEY_CENTS, MAX_WEEKS, remainingWeeksInCycle } from "./money";

// Shared rules for creating AND editing participations, so the add flow and
// the D-32 edit flow can never disagree.

export type ParticipationFieldsInput = {
  /** Cents. */
  weeklyAmount: number;
  startWeek: number;
  weeksCommitted: number;
  /** 2.22 / D-31: extending past the planned end is an explicit decision. */
  extendPastPlannedEnd?: boolean;
};

export function validateParticipationFields(f: ParticipationFieldsInput): string | null {
  if (
    !Number.isSafeInteger(f.weeklyAmount) ||
    f.weeklyAmount < 1 ||
    f.weeklyAmount > MAX_MONEY_CENTS
  ) {
    return "Weekly contribution must be a positive amount.";
  }
  if (!Number.isSafeInteger(f.startWeek) || f.startWeek < 1) {
    return "Start week can never be before week 1.";
  }
  if (f.startWeek > MAX_WEEKS) {
    return `Start week must be at most ${MAX_WEEKS}.`;
  }
  if (!Number.isSafeInteger(f.weeksCommitted) || f.weeksCommitted < 1 || f.weeksCommitted > MAX_WEEKS) {
    return `Weeks committed must be between 1 and ${MAX_WEEKS}.`;
  }
  return null;
}

/**
 * 2.22 / D-31: without the organizer override, a commitment may not run past
 * the planned end — the member finishes with everyone else.
 */
export function validateCommitmentCap(
  cycle: { plannedWeeks: number },
  fields: ParticipationFieldsInput,
): string | null {
  if (fields.extendPastPlannedEnd) return null;
  const cap = remainingWeeksInCycle(cycle.plannedWeeks, fields.startWeek);
  if (fields.weeksCommitted > cap) {
    return cap === 0
      ? "The cycle's planned weeks are over — extending past the end requires the organizer override."
      : `Only ${cap} week${cap === 1 ? "" : "s"} remain in the cycle — they finish with everyone else. Use the override to extend past the planned end.`;
  }
  return null;
}

/**
 * Generate the week rows past the planned end that an override commitment
 * needs (2.22 / D-31). Dates continue the 7-day rhythm from the cycle start;
 * contiguous, so the grid never has holes.
 */
export async function ensureWeeksThrough(
  tx: Prisma.TransactionClient,
  cycle: { id: string; startDate: Date; plannedWeeks: number },
  finishWeek: number,
): Promise<void> {
  if (finishWeek <= cycle.plannedWeeks) return;
  // EVERY existing row, not just the ones past the planned end: the new weeks
  // continue the rhythm from the last day that actually happened (2.14). The
  // cycle start date is editable and existing rows are kept deliberately, so
  // projecting from it could date a later week BEFORE an earlier one.
  const existing = await tx.week.findMany({
    where: { cycleId: cycle.id },
    select: { weekNumber: true, date: true },
    orderBy: { weekNumber: "asc" },
  });
  const data = nextWeekDates({
    existing,
    fromWeek: cycle.plannedWeeks + 1,
    toWeek: finishWeek,
    cycleStartDate: cycle.startDate,
  }).map((w) => ({ cycleId: cycle.id, weekNumber: w.weekNumber, date: w.date }));
  if (data.length > 0) await tx.week.createMany({ data });
}

/**
 * Remove OVERRIDE weeks that nobody reaches any more.
 *
 * THE LEAK. `ensureWeeksThrough` creates weeks past the planned end when a
 * member is deliberately extended (2.22 / D-31). Nothing ever removed them:
 * shorten that member back, or remove them from the cycle entirely, and weeks
 * 21–25 stay. No product path could delete them — `updateCycle` only prunes
 * when `plannedWeeks` shrinks, and these sit ABOVE plannedWeeks by definition.
 *
 * What they cost: the cycle reads as longer than it is (2.7 tracks the ACTUAL
 * length, and these are not actual), they appear in every week picker, and
 * `elapsedThroughWeek` eventually counts them — so the cycle position would
 * report weeks that exist for nobody.
 *
 * WHAT IS NEVER PRUNED. Only weeks past the planned end, that no participation
 * still reaches, and that carry NO evidence of having happened: no money, no
 * deferral, no draw, no winner plan, no note. A week that anything at all
 * points to is history, and history stays (2.14).
 */
export async function pruneOrphanOverrideWeeks(
  tx: Prisma.TransactionClient,
  cycleId: string,
): Promise<{ pruned: number[] }> {
  const cycle = await tx.cycle.findUnique({
    where: { id: cycleId },
    select: { plannedWeeks: true },
  });
  if (!cycle) return { pruned: [] };

  const participations = await tx.participation.findMany({
    where: { cycleId },
    select: { startWeek: true, weeksCommitted: true },
  });
  const deepestFinish = participations.reduce(
    (max, p) => Math.max(max, calculateFinishWeek(p.startWeek, p.weeksCommitted)),
    0,
  );
  // The cycle genuinely runs to the later of its plan and its deepest
  // commitment. Anything past THAT belongs to nobody.
  const keepThrough = Math.max(cycle.plannedWeeks, deepestFinish);

  const candidates = await tx.week.findMany({
    where: {
      cycleId,
      weekNumber: { gt: keepThrough },
      // Every trace of the week having existed, checked at once.
      draws: { none: {} },
      winnerPlans: { none: {} },
      payments: { none: { OR: [{ amountPaid: { gt: 0 } }, { isDeferred: true }] } },
      pinnedEvents: { none: {} },
      notes: null,
    },
    select: { id: true, weekNumber: true },
    orderBy: { weekNumber: "asc" },
  });
  if (candidates.length === 0) return { pruned: [] };

  await tx.week.deleteMany({ where: { id: { in: candidates.map((w) => w.id) } } });
  return { pruned: candidates.map((w) => w.weekNumber) };
}
