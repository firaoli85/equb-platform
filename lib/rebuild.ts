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
        markedLate: payment?.markedLateAt != null,
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

  // MONEY CLEARS THE ORGANIZER'S LATE MARK (2.14, 2.2).
  //
  // He marks week 15 late on Monday because a member said they could not pay;
  // on Wednesday they pay. The week is covered, so the mark has nothing left
  // to describe and must not sit in the record contradicting the receipts.
  //
  // HERE, at the end of the one rebuild, because this is the only place money
  // lands on weeks — the recording path, an edited receipt, a deleted one, a
  // changed commitment and a settlement all run through it. Clearing it in the
  // record action instead would leave every other route to fully-paid still
  // carrying a stale mark.
  //
  // `paymentStatus` puts PAID above the mark for the same reason, so a mark
  // that somehow survives still cannot show a covered week as late. This makes
  // the STORED fact agree with the derived one rather than relying on it.
  const covered = state
    .filter((s) => s.markedLate && s.paid >= participation.weeklyAmount && s.paymentId)
    .map((s) => s.paymentId!);
  if (covered.length > 0) {
    await tx.payment.updateMany({
      where: { id: { in: covered } },
      data: { markedLateAt: null, markedLateNote: null },
    });
  }

  // MONEY ENDS A PAUSE (Oli's ruling, 15 Aug 2026 — §2.29a, §3.0 rule 3).
  //
  // DEFERRED means "paused, outcome unknown". A payment answers the question
  // the pause was holding open: the member is active again. So when money
  // reaches a deferred week, EVERY deferred week of theirs returns to the
  // ordinary ladder — the filled one reads PAID, and one the money did not
  // reach is expected again and reads LATE or PARTIAL_LATE on its own money
  // and calendar.
  //
  // ALL OF THEM, not only the weeks the money touched. The pause was about the
  // MEMBER, not one week; once they have demonstrably paid, nothing of theirs
  // should still read "unknown". A week the money did not reach is not
  // mysterious any more — it is simply owed.
  //
  // A STORED CLEAR, NOT A DERIVED OVERRIDE, and that is the load-bearing
  // choice. Deriving it would break the organizer's half of the rule twice
  // over: he could never RE-DEFER (the stored flag never changed, so his mark
  // would have nothing to write), and a week he deliberately paused that
  // already held money would un-pause itself the instant he saved it. Clearing
  // the row at the moment money arrives leaves the stored fact true, so a
  // re-defer afterwards sticks.
  //
  // ONE WAY ONLY. The system un-defers, because money is a fact it can see; it
  // never re-defers, because that needs what he knows about the member (2.2).
  //
  // HERE for the same reason the mark is cleared here: this is the only place
  // money lands on weeks, so every route — a new receipt, an edit, a deletion,
  // a changed commitment, a settlement — passes through it.
  const reactivated = state.some((s) => s.isDeferred && !s.isSkipped && s.paid > 0);
  if (reactivated) {
    const paused = state.filter((s) => s.isDeferred && s.paymentId).map((s) => s.paymentId!);
    if (paused.length > 0) {
      await tx.payment.updateMany({
        where: { id: { in: paused } },
        data: { isDeferred: false },
      });
    }
  }
}
