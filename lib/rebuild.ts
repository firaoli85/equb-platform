import { allocatePayment } from "./allocation";
import { allocatePinned } from "./settlement";
import { Prisma } from "./generated/prisma/client";
import { calculateFinishWeek } from "./money";

/**
 * Replay a participation's payment events through the ONE allocation engine
 * (2.19), rebuilding every week aggregate and the event→week audit trail.
 * Run inside the same transaction as any event edit/deletion, participation
 * window change, or week skip-toggle, so derived aggregates can never drift
 * from the receipts (2.14, D-32: immediate recalculation).
 *
 * Placement follows the LAW — oldest debt first — so events recorded against
 * hand-placed weeks in the old app re-derive to the lawful placement when
 * first edited. The ONE exception is a PINNED event: the winner's own week
 * is settled FROM the payout, so its settlement receipt allocates to that
 * week only and never waterfalls. Deferred flags and week-row receipt
 * metadata are preserved; only amounts and allocations are recomputed.
 *
 * Throws (rolling the transaction back) if an event no longer fits the
 * member's window — money is never silently dropped.
 */
export async function rebuildParticipationPayments(
  tx: Prisma.TransactionClient,
  participationId: string,
): Promise<void> {
  const participation = await tx.participation.findUniqueOrThrow({
    where: { id: participationId },
    include: {
      cycle: { include: { weeks: { orderBy: { weekNumber: "asc" } } } },
      payments: true,
      paymentEvents: { orderBy: [{ receivedAt: "asc" }, { createdAt: "asc" }] },
    },
  });
  const finishWeek = calculateFinishWeek(participation.startWeek, participation.weeksCommitted);
  const paymentByWeekId = new Map(participation.payments.map((p) => [p.weekId, p]));

  const state = participation.cycle.weeks
    .filter((w) => w.weekNumber >= participation.startWeek && w.weekNumber <= finishWeek)
    .map((week) => {
      const payment = paymentByWeekId.get(week.id) ?? null;
      return {
        week,
        paymentId: payment?.id ?? null,
        paid: 0,
        isDeferred: payment?.isDeferred ?? false,
        isSkipped: week.isSkipped,
      };
    });

  await tx.paymentAllocation.deleteMany({ where: { event: { participationId } } });
  await tx.payment.updateMany({ where: { participationId }, data: { amountPaid: 0 } });

  async function applyToWeek(
    s: (typeof state)[number],
    applied: number,
    event: (typeof participation.paymentEvents)[number],
  ) {
    s.paid += applied;
    if (s.paymentId) {
      await tx.payment.update({
        where: { id: s.paymentId },
        data: { amountPaid: { increment: applied } },
      });
    } else {
      const created = await tx.payment.create({
        data: {
          weekId: s.week.id,
          participationId,
          amountPaid: applied,
          method: event.method,
          paidAt: event.receivedAt,
        },
      });
      s.paymentId = created.id;
    }
    await tx.paymentAllocation.create({
      data: { eventId: event.id, paymentId: s.paymentId, amount: applied },
    });
  }

  for (const event of participation.paymentEvents) {
    if (event.pinnedWeekId !== null) {
      // A payout-settlement receipt: the win week only, never oldest-first.
      const s = state.find((x) => x.week.id === event.pinnedWeekId);
      const fit = s
        ? allocatePinned(event.amount, {
            amountDue: participation.weeklyAmount,
            amountAlreadyPaid: s.paid,
            isSkipped: s.isSkipped,
          })
        : null;
      if (!s || !fit || fit.unallocated > 0) {
        throw new Error(
          `Recalculation failed: the payout settlement of ${event.amount} cents ` +
            `no longer fits the week it settled${s ? ` (week ${s.week.weekNumber})` : " (now outside their window)"}. ` +
            `Undo the draw or adjust the terms first — nothing was changed.`,
        );
      }
      if (fit.applied > 0) await applyToWeek(s, fit.applied, event);
      continue;
    }

    const result = allocatePayment(
      event.amount,
      state.map((s) => ({
        weekNumber: s.week.weekNumber,
        amountDue: participation.weeklyAmount,
        amountAlreadyPaid: s.paid,
        isSkipped: s.isSkipped,
      })),
    );
    if (result.unallocated > 0) {
      throw new Error(
        `Recalculation failed: the receipt of ${event.amount} cents from ` +
          `${event.receivedAt.toISOString().slice(0, 10)} no longer fits this member's weeks. ` +
          `Adjust the receipts or the commitment first — nothing was changed.`,
      );
    }
    for (const a of result.allocations) {
      const s = state.find((x) => x.week.weekNumber === a.weekNumber)!;
      await applyToWeek(s, a.applied, event);
    }
  }
}
