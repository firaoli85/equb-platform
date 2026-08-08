import type { Prisma } from "./generated/prisma/client";
import { closedParticipationRefusal, frozenCycleRefusal } from "./cycle-close";

// ONE LINE TO FREEZE A CLOSED CYCLE.
//
// `frozenCycleRefusal` is pure and needs the cycle, so every action that
// wanted it first had to load the cycle by whatever id it happened to hold —
// a week, a payout, a lucky number, a slot. That friction is why the guard was
// missing from 14 of them: it was three lines of plumbing per action, so it
// got skipped.
//
// This resolves the cycle from ANY cycle-scoped id and throws the standard
// refusal. One call, no plumbing, no reason to skip it.
//
// It THROWS rather than returning, because every caller is already inside a
// transaction whose whole point is to roll back — and a returned value here
// would be one more thing to forget to check.

export type CycleRef = {
  cycleId?: string;
  weekId?: string;
  participationId?: string;
  luckyNumberId?: string;
  payoutId?: string;
  drawId?: string;
  slotId?: string;
  winnerPlanId?: string;
  paymentId?: string;
  paymentEventId?: string;
  personId?: never; // a person is not cycle-scoped — 2.5
};

/**
 * Refuse the operation when the cycle behind `ref` is CLOSED.
 *
 * Resolves through the shortest relation available. An id that resolves to
 * nothing is left alone: the action's own findUniqueOrThrow will produce a
 * better error than a guard complaining about a missing row.
 */
export async function refuseIfCycleClosed(
  tx: Prisma.TransactionClient,
  ref: CycleRef,
): Promise<void> {
  const cycle = await resolveCycle(tx, ref);
  if (!cycle) return;
  const refusal = frozenCycleRefusal(cycle);
  if (refusal) throw new Error(refusal);
}

/**
 * Refuse the operation when this PARTICIPATION is closed, even though its
 * cycle is not. Same shape as `refuseIfCycleClosed` and for the same reason:
 * a guard that costs three lines of plumbing per action is a guard that gets
 * skipped.
 */
export async function refuseIfParticipationClosed(
  tx: Prisma.TransactionClient,
  participationId: string,
): Promise<void> {
  const p = await tx.participation.findUnique({
    where: { id: participationId },
    select: {
      status: true,
      cycle: { select: { name: true } },
      person: { select: { nameEnglishFirst: true } },
    },
  });
  // Missing id: the action's own lookup gives a better error than a guard
  // complaining about a row that was never there.
  if (!p) return;
  const refusal = closedParticipationRefusal({
    status: p.status,
    memberName: p.person.nameEnglishFirst,
    cycleName: p.cycle.name,
  });
  if (refusal) throw new Error(refusal);
}

type MinimalCycle = { name: string; status: "DRAFT" | "ACTIVE" | "CLOSED" };

async function resolveCycle(
  tx: Prisma.TransactionClient,
  ref: CycleRef,
): Promise<MinimalCycle | null> {
  const select = { name: true, status: true } as const;

  if (ref.cycleId) {
    return tx.cycle.findUnique({ where: { id: ref.cycleId }, select });
  }
  if (ref.weekId) {
    const w = await tx.week.findUnique({
      where: { id: ref.weekId },
      select: { cycle: { select } },
    });
    return w?.cycle ?? null;
  }
  if (ref.participationId) {
    const p = await tx.participation.findUnique({
      where: { id: ref.participationId },
      select: { cycle: { select } },
    });
    return p?.cycle ?? null;
  }
  if (ref.luckyNumberId) {
    const n = await tx.luckyNumber.findUnique({
      where: { id: ref.luckyNumberId },
      select: { cycle: { select } },
    });
    return n?.cycle ?? null;
  }
  if (ref.payoutId) {
    const po = await tx.payout.findUnique({
      where: { id: ref.payoutId },
      select: { luckyNumber: { select: { cycle: { select } } } },
    });
    return po?.luckyNumber.cycle ?? null;
  }
  if (ref.drawId) {
    const d = await tx.draw.findUnique({
      where: { id: ref.drawId },
      select: { week: { select: { cycle: { select } } } },
    });
    return d?.week.cycle ?? null;
  }
  if (ref.slotId) {
    const s = await tx.slot.findUnique({
      where: { id: ref.slotId },
      select: { cycle: { select } },
    });
    return s?.cycle ?? null;
  }
  if (ref.winnerPlanId) {
    const p = await tx.winnerPlan.findUnique({
      where: { id: ref.winnerPlanId },
      select: { cycle: { select } },
    });
    return p?.cycle ?? null;
  }
  if (ref.paymentId) {
    const pm = await tx.payment.findUnique({
      where: { id: ref.paymentId },
      select: { week: { select: { cycle: { select } } } },
    });
    return pm?.week.cycle ?? null;
  }
  if (ref.paymentEventId) {
    const ev = await tx.paymentEvent.findUnique({
      where: { id: ref.paymentEventId },
      select: { participation: { select: { cycle: { select } } } },
    });
    return ev?.participation.cycle ?? null;
  }
  return null;
}
