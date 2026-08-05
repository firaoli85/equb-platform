// The winner's-week settlement as DATABASE facts (2.14): each deduction is
// a PaymentEvent (a receipt — the member effectively paid that week from
// their payout) allocated to the drawn week's row, plus a matching decrement
// of the payout's net. The event is PINNED to the drawn week (pinnedWeekId)
// so a later rebuild replays it onto that week only — it can never waterfall
// oldest-first off the week it settled — and it points at the payout that
// funded it (settlementPayoutId), so undoing a draw (or moving it) reverses
// EXACTLY what was written, even if the payout was edited in between.
//
// SECURITY (audit C6): identification is by those two COLUMNS, never by the
// idempotency key. The key is client-supplied on recordPayment, so a forged
// "draw-settle:…" value could otherwise make an ordinary receipt look like
// payout money — deletable by deletePayout, creditable onto a payout net by
// moveDraw, and countable as "already received" by the terms settlement.
// The key keeps its uniqueness role and nothing more.
//
// Runs inside the caller's serializable transaction — recordDraw, undoDraw,
// and moveDraw call these so a draw and its settlement can never exist
// without each other.

import { formatMoney } from "./format";
import { Prisma } from "./generated/prisma/client";
import { calculateFinishWeek } from "./money";
import { planWinnerWeekSettlement } from "./settlement";

/** Reserved: no client-supplied idempotency key may enter this namespace. */
export const SETTLEMENT_KEY_PREFIX = "draw-settle";

export function settlementKey(drawId: string, payoutId: string): string {
  return `${SETTLEMENT_KEY_PREFIX}:${drawId}:${payoutId}`;
}

/** True when a caller is trying to write into the reserved namespace. */
export function isReservedSettlementKey(idempotencyKey: string): boolean {
  return new RegExp(`^${SETTLEMENT_KEY_PREFIX}:`, "i").test(idempotencyKey.trim());
}

/**
 * A settlement receipt is one the engine PINNED to a week. Ordinary receipts
 * (whatever their key says) never satisfy this.
 */
export const SETTLEMENT_EVENT_WHERE = { pinnedWeekId: { not: null } } as const;

export type WinnerWeekSummary = {
  participationId: string;
  name: string;
  weekNumber: number;
  settled: number;
};

/**
 * Settle each winner's drawn week from their payout(s). Multiple winners in
 * one slot each settle their OWN week contribution independently. A week
 * that is skipped, deferred, outside the member's window, or already covered
 * settles nothing. Throws (rolling the draw back) if a member's contribution
 * exceeds what their payouts can absorb — never a partial silent write.
 */
export async function settleWinnerWeeks(
  tx: Prisma.TransactionClient,
  drawId: string,
): Promise<WinnerWeekSummary[]> {
  const draw = await tx.draw.findUniqueOrThrow({
    where: { id: drawId },
    include: {
      week: true,
      payouts: { orderBy: { id: "asc" } },
      slot: {
        include: {
          members: {
            include: {
              luckyNumber: { include: { participation: { include: { person: true } } } },
            },
          },
        },
      },
    },
  });

  const numberById = new Map(draw.slot.members.map((m) => [m.luckyNumberId, m.luckyNumber]));
  const byParticipation = new Map<
    string,
    {
      participation: (typeof draw.slot.members)[number]["luckyNumber"]["participation"];
      payouts: (typeof draw.payouts)[number][];
    }
  >();
  for (const payout of draw.payouts) {
    const luckyNumber = numberById.get(payout.luckyNumberId);
    if (!luckyNumber) continue; // payout not from this slot (organizer surgery)
    const entry = byParticipation.get(luckyNumber.participationId);
    if (entry) entry.payouts.push(payout);
    else byParticipation.set(luckyNumber.participationId, { participation: luckyNumber.participation, payouts: [payout] });
  }

  const summaries: WinnerWeekSummary[] = [];
  for (const { participation, payouts } of byParticipation.values()) {
    const paymentRow = await tx.payment.findUnique({
      where: {
        weekId_participationId: { weekId: draw.weekId, participationId: participation.id },
      },
    });
    const weekNumber = draw.week.weekNumber;
    const finishWeek = calculateFinishWeek(participation.startWeek, participation.weeksCommitted);
    const inWindow = weekNumber >= participation.startWeek && weekNumber <= finishWeek;
    const excused = draw.week.isSkipped || (paymentRow?.isDeferred ?? false);
    const amountDue = inWindow && !excused ? participation.weeklyAmount : 0;

    const plan = planWinnerWeekSettlement({
      amountDue,
      alreadyPaidOnWeek: paymentRow?.amountPaid ?? 0,
      payouts: payouts.map((p) => ({ payoutId: p.id, netAmount: p.netAmount })),
    });
    if (plan.unabsorbed > 0) {
      throw new Error(
        `${participation.person.nameEnglishFirst}'s week-${weekNumber} contribution ` +
          `(${formatMoney(amountDue)}) exceeds their payout — record the week manually instead.`,
      );
    }
    if (plan.totalSettled === 0) continue;

    let paymentId = paymentRow?.id ?? null;
    for (const deduction of plan.perPayout) {
      const event = await tx.paymentEvent.create({
        data: {
          participationId: participation.id,
          amount: deduction.deduct,
          method: null,
          receivedAt: draw.drawnAt,
          notes: `Week ${weekNumber} contribution settled from the payout — the winner does not pay the week they win`,
          idempotencyKey: settlementKey(drawId, deduction.payoutId),
          pinnedWeekId: draw.weekId,
          settlementPayoutId: deduction.payoutId,
        },
      });
      if (paymentId) {
        await tx.payment.update({
          where: { id: paymentId },
          data: { amountPaid: { increment: deduction.deduct } },
        });
      } else {
        const created = await tx.payment.create({
          data: {
            weekId: draw.weekId,
            participationId: participation.id,
            amountPaid: deduction.deduct,
            paidAt: draw.drawnAt,
          },
        });
        paymentId = created.id;
      }
      await tx.paymentAllocation.create({
        data: { eventId: event.id, paymentId, amount: deduction.deduct },
      });
      await tx.payout.update({
        where: { id: deduction.payoutId },
        data: { netAmount: { decrement: deduction.deduct } },
      });
    }
    summaries.push({
      participationId: participation.id,
      name: participation.person.nameEnglishFirst,
      weekNumber,
      settled: plan.totalSettled,
    });
  }
  return summaries;
}

/**
 * Reverse every settlement this draw wrote: restore each payout's net by
 * exactly what was deducted from it, take the money back off the week rows,
 * and delete the settlement receipts. Safe when a payout was since deleted
 * (its restoration is skipped; the week still un-settles).
 */
export async function unsettleDraw(
  tx: Prisma.TransactionClient,
  drawId: string,
): Promise<{ reversed: number; count: number }> {
  // Every settlement funded by a payout of THIS draw — matched through the
  // FK, so no client-chosen string can enter this set.
  const events = await tx.paymentEvent.findMany({
    where: { ...SETTLEMENT_EVENT_WHERE, settlementPayout: { drawId } },
    include: { allocations: true },
  });
  let reversed = 0;
  for (const event of events) {
    const payoutId = event.settlementPayoutId;
    if (payoutId) {
      const payout = await tx.payout.findUnique({ where: { id: payoutId } });
      if (payout) {
        await tx.payout.update({
          where: { id: payoutId },
          data: { netAmount: { increment: event.amount } },
        });
      }
    }
    for (const allocation of event.allocations) {
      await tx.payment.update({
        where: { id: allocation.paymentId },
        data: { amountPaid: { decrement: allocation.amount } },
      });
    }
    await tx.paymentEvent.delete({ where: { id: event.id } });
    reversed += event.amount;
  }
  return { reversed, count: events.length };
}

/**
 * Reverse the settlement that funded ONE payout (used by "Delete payout":
 * the money record was wrong, so the week it settled becomes owed again —
 * while the DRAW STANDS and the number stays drawn).
 */
export async function unsettlePayout(
  tx: Prisma.TransactionClient,
  payoutId: string,
): Promise<{ reversed: number }> {
  // Scoped to THIS payout by foreign key — previously this scanned every
  // "draw-settle:"-keyed event in the database and filtered in JS, which is
  // what let a forged key delete an unrelated member's receipt (audit C6).
  const events = await tx.paymentEvent.findMany({
    where: { ...SETTLEMENT_EVENT_WHERE, settlementPayoutId: payoutId },
    include: { allocations: true },
  });
  let reversed = 0;
  for (const event of events) {
    for (const allocation of event.allocations) {
      await tx.payment.update({
        where: { id: allocation.paymentId },
        data: { amountPaid: { decrement: allocation.amount } },
      });
    }
    await tx.paymentEvent.delete({ where: { id: event.id } });
    reversed += event.amount;
  }
  return { reversed };
}
