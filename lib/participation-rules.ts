import { Prisma } from "./generated/prisma/client";
import { MAX_MONEY_CENTS, MAX_WEEKS, remainingWeeksInCycle } from "./money";

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
  const existing = await tx.week.findMany({
    where: { cycleId: cycle.id, weekNumber: { gt: cycle.plannedWeeks } },
    select: { weekNumber: true },
  });
  const have = new Set(existing.map((w) => w.weekNumber));
  const data = [];
  for (let n = cycle.plannedWeeks + 1; n <= finishWeek; n++) {
    if (have.has(n)) continue;
    data.push({
      cycleId: cycle.id,
      weekNumber: n,
      date: new Date(cycle.startDate.getTime() + (n - 1) * 7 * 86_400_000),
    });
  }
  if (data.length > 0) await tx.week.createMany({ data });
}
