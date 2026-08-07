import { calculateFinishWeek } from "./money";

// CHANGING SOMEONE'S WINDOW CAN STRAND THINGS OUTSIDE IT.
//
// `updateParticipation` validated the commitment cap, replayed the receipts,
// and opened a settlement step when a drawn member's entitlement moved. None
// of that looks at what the OLD window was carrying, so two things could be
// left outside the new one:
//
//   A PLANNED WINNER PLAN targeting a week the member no longer reaches.
//   Their numbers leave the pool the moment their window closes, so the
//   plan's slot is never eligible. At that week's draw `selectWinningSlot`
//   finds the plan, cannot find its numbers in an eligible slot, and throws —
//   and because that happens on the SHARED Zoom screen it surfaces as the
//   neutral "Something needs attention before this draw". Meanwhile the number
//   stays frozen on the setup page, labelled "committed to a winner plan —
//   cancel the plan to move it". The week cannot be drawn and nothing on
//   screen says why.
//
//   A DRAW AND PAYOUT on a week now outside the window. Moving a start week
//   from 1 to 15 does not change what anyone was ENTITLED to, so
//   `termsChanged` stays false and no settlement step opens. The draw and the
//   payout survive on week 12, which the member's own grid then renders as
//   "before you started" while /admin/cycle/draws still names them as that
//   week's winner. Two screens, two answers.
//
// WHY REFUSE RATHER THAN CLEAN UP. Both are the organizer's own decisions —
// a committed plan (2.3) and a recorded win with money attached. Silently
// cancelling either would be the system overruling him, which is the opposite
// of 2.23. The refusal names the thing and where to undo it, and he decides.

export type WindowConflict = {
  /** A plan committed to a week the new window does not reach. */
  plans: { weekNumber: number; numbers: number[] }[];
  /** A draw the member won on a week the new window does not reach. */
  draws: { weekNumber: number; numbers: number[] }[];
};

/** What the proposed window would strand. Empty when nothing is. */
export function windowConflicts(input: {
  startWeek: number;
  weeksCommitted: number;
  plans: readonly { weekNumber: number; numbers: number[] }[];
  drawnWeeks: readonly { weekNumber: number; numbers: number[] }[];
}): WindowConflict {
  const finish = calculateFinishWeek(input.startWeek, input.weeksCommitted);
  const outside = (w: number) => w < input.startWeek || w > finish;
  return {
    plans: input.plans.filter((p) => outside(p.weekNumber)),
    draws: input.drawnWeeks.filter((d) => outside(d.weekNumber)),
  };
}

const list = (numbers: readonly number[]) => numbers.map((n) => `#${n}`).join(", ");

/**
 * Why the proposed window cannot be saved, or null.
 *
 * Both halves name the week, the numbers, and the one place the organizer can
 * resolve it — a refusal that only says no is a refusal he has to guess at.
 */
export function windowChangeRefusal(input: {
  memberName: string;
  startWeek: number;
  weeksCommitted: number;
  plans: readonly { weekNumber: number; numbers: number[] }[];
  drawnWeeks: readonly { weekNumber: number; numbers: number[] }[];
}): string | null {
  const conflicts = windowConflicts(input);
  const finish = calculateFinishWeek(input.startWeek, input.weeksCommitted);
  const window = `weeks ${input.startWeek}–${finish}`;

  if (conflicts.draws.length > 0) {
    const d = conflicts.draws[0];
    return (
      `${input.memberName} already won week ${d.weekNumber} with ${list(d.numbers)}, and ` +
      `${window} does not include it. The payout would stay on a week they are no longer in — ` +
      `their own schedule would show week ${d.weekNumber} as before they started, while the ` +
      `draws page still names them as its winner. Undo that draw or move the winner to a week ` +
      `inside the new window first, on Collections.`
    );
  }

  if (conflicts.plans.length > 0) {
    const p = conflicts.plans[0];
    return (
      `${list(p.numbers)} ${p.numbers.length === 1 ? "is" : "are"} committed to win week ` +
      `${p.weekNumber}, and ${window} does not include it. Their numbers leave the wheel when ` +
      `their window closes, so that plan could never fire — and week ${p.weekNumber} could not ` +
      `be drawn at all while it stands. Cancel the plan on the wheel setup page first (2.3 — a ` +
      `locked plan is never overwritten silently).`
    );
  }

  return null;
}
