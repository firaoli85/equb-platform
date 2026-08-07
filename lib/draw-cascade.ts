// NEVER LEAVE A DRAW WITH ZERO PAYOUTS.
//
// THE REAL CASE. Week 6's only winner was moved to week 7. The payout moved,
// the slot membership moved, and the Draw stayed behind. Week 6 was then in a
// half-state: counted as drawn (so `@@unique([weekId])` refused a new draw and
// every picker labelled it "already drawn"), holding nothing (so the label had
// no money in it), and impossible to assign to. A live audit found the same
// shape on week 1, left behind by deleting the last payout.
//
// THE RULE. A Draw is the recorded fact that a slot WON a week. Once the last
// payout leaves it — by move, by remove, or by deleting the payout — no win is
// recorded any more, so the Draw must go with it. Deleting the Draw is what
// returns its slot members to the pool: drawn-ness is derived from
// `draw.slot.members` (lib/wheel.ts `eligibleNumbers`), never stored on the
// number, so a number is back in the pool the instant no Draw points at its
// slot.
//
// WHY THIS LIVES IN ONE PLACE. Four separate paths can empty a draw
// (removeWinnerFromWeek, movePayoutToWeek, deletePayout, removeParticipation).
// Three of them had no cleanup at all. A rule that has to be remembered in
// four places is a rule that will be forgotten in a fifth.

import { logAudit } from "./audit";
import { Prisma } from "./generated/prisma/client";

export type EmptyDrawCleanup = {
  /** The draw records a win that holds no money — it must be deleted. */
  deleteDraw: boolean;
  /** Numbers coming back to the wheel pool because the draw stops existing. */
  numbersReturning: number[];
  /** The slot holds nobody now and can be released for reuse. */
  deleteSlot: boolean;
  /** One plain sentence for the confirmation and the audit entry. */
  sentence: string;
};

const NOTHING: EmptyDrawCleanup = {
  deleteDraw: false,
  numbersReturning: [],
  deleteSlot: false,
  sentence: "",
};

/**
 * What must happen to a draw AFTER an edit has removed payouts from it.
 *
 * Pure, so the confirmation dialog and the transaction can never disagree
 * about whether a week is about to become undrawn.
 */
export function emptyDrawCleanup(input: {
  weekNumber: number;
  /** Payouts still attached to the draw after the edit. */
  payoutsRemaining: number;
  /** Numbers still sitting in the drawn slot after the edit. */
  slotNumbers: readonly number[];
}): EmptyDrawCleanup {
  if (input.payoutsRemaining > 0) return NOTHING;

  const returning = [...input.slotNumbers].sort((a, b) => a - b);
  const list = returning.map((n) => `#${n}`).join(", ");
  return {
    deleteDraw: true,
    numbersReturning: returning,
    deleteSlot: returning.length === 0,
    sentence:
      `Week ${input.weekNumber} holds no payout any more, so its draw is removed and the week ` +
      `becomes UNDRAWN — it can be drawn or assigned again` +
      (returning.length > 0
        ? `, and ${list} ${returning.length === 1 ? "returns" : "return"} to the wheel pool.`
        : "."),
  };
}

/** The short clause a caller appends to its own audit summary. */
export function freedWeekClause(cleanup: EmptyDrawCleanup, weekNumber: number): string {
  if (!cleanup.deleteDraw) return "";
  return (
    ` Week ${weekNumber} held no other payout, so its draw was removed and the week is UNDRAWN again` +
    (cleanup.numbersReturning.length > 0
      ? ` (${cleanup.numbersReturning.map((n) => `#${n}`).join(", ")} back in the pool)`
      : "") +
    "."
  );
}

export type DrawDeletionResult = EmptyDrawCleanup & {
  /** False when the draw still holds payouts and was left alone. */
  deleted: boolean;
  weekNumber: number;
  /** A plan this draw had fulfilled went back to PLANNED — intent survives. */
  planRestored: boolean;
};

/**
 * Delete a draw IF the last payout has left it, and clean up behind it.
 *
 * Runs inside the caller's serializable transaction, after the payout removal,
 * so the whole edit either lands or rolls back as one. Safe to call
 * unconditionally: a draw that still holds payouts is untouched.
 *
 * The order matters and mirrors undoDraw in app/actions/wheel.ts:
 *   1. the fulfilled winner plan goes back to PLANNED (2.3 — undoing a draw
 *      never silently discards the organizer's locked intent)
 *   2. the draw is deleted, which is what returns its slot's numbers to the
 *      pool (drawn-ness is derived from the draw, not stored on the number)
 *   3. a slot left with nobody in it is released, so it stops occupying its
 *      `@@unique([cycleId, position])` seat forever — saveSlots deliberately
 *      refuses to delete a slot that has a draw, so this is the only moment it
 *      can be cleaned up.
 */
export async function deleteDrawIfEmpty(
  tx: Prisma.TransactionClient,
  drawId: string,
): Promise<DrawDeletionResult> {
  const draw = await tx.draw.findUnique({
    where: { id: drawId },
    include: {
      week: true,
      payouts: { select: { id: true } },
      slot: { include: { members: { include: { luckyNumber: { select: { number: true } } } } } },
    },
  });
  // Already gone (a caller deleted it) — nothing to do, and not an error.
  if (!draw) {
    return { ...NOTHING, deleted: false, weekNumber: 0, planRestored: false };
  }

  const cleanup = emptyDrawCleanup({
    weekNumber: draw.week.weekNumber,
    payoutsRemaining: draw.payouts.length,
    slotNumbers: draw.slot.members.map((m) => m.luckyNumber.number),
  });
  if (!cleanup.deleteDraw) {
    return { ...cleanup, deleted: false, weekNumber: draw.week.weekNumber, planRestored: false };
  }

  // Restored only when it still has numbers to plan with — see
  // restoreFulfilledPlan below for why an empty one is dangerous.
  const planResult = await restoreFulfilledPlan(tx, {
    cycleId: draw.week.cycleId,
    weekId: draw.weekId,
  });

  await tx.draw.delete({ where: { id: drawId } });
  if (cleanup.deleteSlot) {
    // members:none / draws:none re-checked at delete time — belt and braces
    // against a concurrent write having filled the slot.
    await tx.slot.deleteMany({
      where: { id: draw.slotId, members: { none: {} }, draws: { none: {} } },
    });
  }

  await logAudit(tx, {
    entity: "Draw",
    entityId: drawId,
    action: "delete",
    summary:
      `${cleanup.sentence} The draw was removed automatically because its last payout left — ` +
      `a week can never be counted as drawn while holding nothing` +
      (planResult.restored
        ? "; the fulfilled winner plan is PLANNED again"
        : planResult.purged
          ? "; its winner plan was NOT restored — it had no numbers left, and an empty plan decides the next draw by itself"
          : "") +
      (cleanup.deleteSlot ? "; the emptied wheel slot was released" : ""),
    before: {
      weekNumber: draw.week.weekNumber,
      slotId: draw.slotId,
      numbersReturned: cleanup.numbersReturning,
      assignedManually: draw.assignedManually,
    },
  });

  return {
    ...cleanup,
    deleted: true,
    weekNumber: draw.week.weekNumber,
    planRestored: planResult.restored,
  };
}

/**
 * Put a FULFILLED winner plan back to PLANNED — but only if it still has
 * numbers to plan with.
 *
 * THIS IS WHERE THE ZERO-NUMBER PLAN IS BORN. Undoing a draw resurrects the
 * plan it fulfilled, so the organizer's locked intent survives (2.3). Four
 * paths do it — `undoDraw`, `deleteDrawIfEmpty`, the manual-payout replace,
 * and the week-winner edits through `deleteDrawIfEmpty` — and every one of
 * them did `update({ status: "PLANNED" })` unconditionally.
 *
 * `WinnerPlanNumber` cascades when a `LuckyNumber` is deleted, so a plan can be
 * hollowed out without the organizer touching it: remove two members who
 * shared a TOGETHER plan and it is left FULFILLED with zero rows. Then someone
 * clicks Undo, and it comes back as PLANNED with nothing in it.
 *
 * `selectWinningSlot` matches a plan with `plan.luckyNumberIds.every(...)`, and
 * **`[].every(...)` is vacuously TRUE** — so that plan matches the FIRST
 * eligible slot and silently decides the next draw, recorded in the audit log
 * as an intentional "planned" win rather than a spin. This was found live on
 * week 11 of Cycle 1.
 *
 * `purgeEmptyWinnerPlans` could never catch it: it matches `status: "PLANNED"`,
 * and an emptied plan sits at FULFILLED until the moment it is resurrected.
 * The check has to happen at the resurrection, which is here.
 */
export async function restoreFulfilledPlan(
  tx: Prisma.TransactionClient,
  args: { cycleId: string; weekId: string },
): Promise<{ restored: boolean; purged: boolean }> {
  const plan = await tx.winnerPlan.findFirst({
    where: { cycleId: args.cycleId, weekId: args.weekId, status: "FULFILLED" },
    include: { numbers: { select: { id: true } }, week: { select: { weekNumber: true } } },
  });
  if (!plan) return { restored: false, purged: false };

  if (plan.numbers.length === 0) {
    await tx.winnerPlan.delete({ where: { id: plan.id } });
    await logAudit(tx, {
      entity: "WinnerPlan",
      entityId: plan.id,
      action: "delete",
      summary:
        `The winner plan for week ${plan.week?.weekNumber ?? "?"} was NOT restored when its ` +
        `draw was undone: its numbers are gone, so there is nothing left to plan. An empty ` +
        `plan matches the FIRST eligible slot (an empty .every() is true) and would silently ` +
        `decide that week's draw while the audit log called it intentional.`,
      before: { mode: plan.mode, weekNumber: plan.week?.weekNumber ?? null, numbers: 0 },
    });
    return { restored: false, purged: true };
  }

  await tx.winnerPlan.update({ where: { id: plan.id }, data: { status: "PLANNED" } });
  return { restored: true, purged: false };
}

/**
 * Delete winner plans left with ZERO numbers, and say how many went.
 *
 * THE TRAP THIS CLOSES (found live, on week 11). `WinnerPlanNumber` cascades
 * when a LuckyNumber is deleted, so removing a member or deleting a number can
 * empty a PLANNED plan without touching the plan row. `selectWinningSlot`
 * matches a plan with `plan.luckyNumberIds.every(...)`, and `[].every(...)` is
 * VACUOUSLY TRUE — an emptied plan therefore matches the FIRST eligible slot
 * and silently decides the next draw, audited as an intentional "planned" win
 * rather than a spin. There is no honest reading of a plan with no numbers, so
 * it is deleted rather than left to fire.
 */
export async function purgeEmptyWinnerPlans(
  tx: Prisma.TransactionClient,
  cycleId: string,
): Promise<{ purged: number; weeks: (number | null)[] }> {
  const empty = await tx.winnerPlan.findMany({
    where: { cycleId, status: "PLANNED", numbers: { none: {} } },
    include: { week: { select: { weekNumber: true } } },
  });
  if (empty.length === 0) return { purged: 0, weeks: [] };

  await tx.winnerPlan.deleteMany({ where: { id: { in: empty.map((p) => p.id) } } });
  for (const plan of empty) {
    await logAudit(tx, {
      entity: "WinnerPlan",
      entityId: plan.id,
      action: "delete",
      summary:
        `Winner plan for ${plan.week ? `week ${plan.week.weekNumber}` : "an unassigned week"} ` +
        `deleted: its last number is gone. An empty plan matches the FIRST eligible slot ` +
        `(an empty .every() is true) and would silently rig the next draw.`,
      before: { mode: plan.mode, weekNumber: plan.week?.weekNumber ?? null },
    });
  }
  return { purged: empty.length, weeks: empty.map((p) => p.week?.weekNumber ?? null) };
}
