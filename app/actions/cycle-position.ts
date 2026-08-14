"use server";

// THE CYCLE POSITION — "am I in negative, am I using someone else's money, or
// am I on track."
//
// ONE DERIVATION. Every figure here is built from the SAME loader and the SAME
// pure functions the dashboard uses: `receiptsByWeek` for the per-week
// expectations and receipts (already carrying `elapsed`, decided once by
// `elapsedThroughWeek` from each week's OWN stored date), `cashPosition` for
// received/paid-out/committed, and `computeStanding` for what a member owes.
// Nothing is recomputed alongside them, so this page and the dashboard cannot
// disagree.
//
// The ONE stored fact is the cash READING the organizer enters. Everything
// else is derived at read time (2.14).

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { currentWeekFromRows, elapsedThroughWeek } from "@/lib/commitment";
import {
  collectionPosition,
  collectionSentence,
  cashOnHand,
  feeEstimate,
  positionVerdict,
  type AheadMember,
  type OwingMember,
  type StoppedMember,
} from "@/lib/cycle-position";
import { cashPosition, receiptsByWeek } from "@/lib/dashboard";
import { formatMoney } from "@/lib/format";
import { calculateFinishWeek, MAX_MONEY_CENTS } from "@/lib/money";
import { PAGE_SIZES, pageInfo } from "@/lib/paging";
import {
  effectiveFinishWeek,
  windowBreaks,
  closeReasonText,
  isCloseReason,
  weeksLeavingExpectation,
} from "@/lib/participation-close";
import { feeOnReturn } from "@/lib/final-position";
import { PRESENTATION_HIDDEN } from "@/lib/presentation";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";
import { computeStanding, pinnedMapFromEvents } from "@/lib/standing";

/**
 * The whole-cycle money picture, plus the comparison against the most recent
 * cash reading.
 *
 * 2.4: this is the most sensitive screen in the platform — every member's
 * money, the organizer's own fee, and his actual bank balance on one page. It
 * is withheld entirely in presentation mode rather than redacted.
 */
export async function getCyclePosition(input?: { readingsPage?: number; readingsPageSize?: number }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    if (await getSetting("presentationMode")) {
      return { ok: false as const, error: PRESENTATION_HIDDEN };
    }

    const cycle = await prisma.cycle.findFirst({
      where: { status: "ACTIVE" },
      include: {
        weeks: { orderBy: { weekNumber: "asc" } },
        participations: {
          include: {
            person: true,
            // The stretches they were away (2.18) — the whole close feature
            // reaches every derived figure through these.
            breaks: { orderBy: { fromWeek: "asc" } },
            payments: { include: { week: true } },
            paymentEvents: {
              select: { amount: true, pinnedWeekId: true, pinnedWeek: { select: { weekNumber: true } } },
            },
          },
        },
      },
    });
    if (!cycle) return { ok: false as const, error: "No active cycle." };

    const payouts = await prisma.payout.findMany({
      where: { luckyNumber: { cycleId: cycle.id } },
      select: {
        netAmount: true,
        feeAmount: true,
        status: true,
        // Whose payout it is — a member who STOPPED after being paid out is
        // the case that decides the arithmetic below.
        luckyNumber: { select: { participationId: true } },
      },
    });

    const today = new Date();
    // The clock comes from the stored week ROWS, never from a projection off
    // the cycle's start date. This page decides what is OWED, the start date
    // is editable, and correcting it must never move anyone's arrears —
    // lib/week-date-authority.test.ts guards exactly this, by scanning for the
    // projected-clock helper in any money path.
    const currentWeek = currentWeekFromRows({
      weeks: cycle.weeks,
      today,
      cycleStartDate: cycle.startDate,
    });
    const active = cycle.participations.filter((p) => p.status === "ACTIVE");
    const stopped = cycle.participations.filter((p) => p.status === "CLOSED");
    // EVERY participation goes into the series, closed ones included, each
    // carrying the week it stopped. Filtering closed members out entirely
    // would take their PAID money out of "actually collected" too, and what
    // they paid stays exactly as recorded (2.18) — only the expectation ends.
    // `effectiveFinishWeek` does the rest: their weeks after the closing point
    // stop being expected, everywhere, without any screen knowing why.
    // Their breaks, with the derived fallback for rows written before the
    // table existed (see windowBreaks / legacyBreak).
    const breaksOf = (p: {
      status: "ACTIVE" | "CLOSED";
      startWeek: number;
      closedAtWeek: number | null;
      breaks: { fromWeek: number; toWeek: number | null }[];
      payments: { amountPaid: number; week: { weekNumber: number } }[];
    }) => {
      const paid = p.payments.filter((pm) => pm.amountPaid > 0).map((pm) => pm.week.weekNumber);
      return windowBreaks({
        status: p.status,
        startWeek: p.startWeek,
        closedAtWeek: p.closedAtWeek,
        lastWeekWithMoney: paid.length > 0 ? Math.max(...paid) : null,
        breaks: p.breaks,
      });
    };
    const counted = cycle.participations.map((p) => ({
      id: p.id,
      weeklyAmount: p.weeklyAmount,
      startWeek: p.startWeek,
      weeksCommitted: p.weeksCommitted,
      breaks: breaksOf(p),
    }));
    // 2.14: the boundary is each week's OWN stored date, never a projection
    // off an editable start date. Decided once, here, and passed everywhere.
    const elapsed = elapsedThroughWeek(cycle.weeks, today);

    const flatPayments = cycle.participations.flatMap((p) =>
      p.payments.map((payment) => ({
        participationId: p.id,
        weekNumber: payment.week.weekNumber,
        amountPaid: payment.amountPaid,
        isDeferred: payment.isDeferred,
        markedLate: payment.markedLateAt != null,
        isSkipped: payment.week.isSkipped,
      })),
    );

    // THE SHARED SERIES — the dashboard's own per-week figures.
    const series = receiptsByWeek({
      weeks: cycle.weeks.map((w) => ({ weekNumber: w.weekNumber, isSkipped: w.isSkipped })),
      participations: counted,
      payments: flatPayments,
      elapsedThroughWeek: elapsed,
    });

    // Who makes up the shortfall, and who paid ahead — both derived per member
    // through the SAME standing engine the member's own page uses.
    // ONE standing derivation, used for members still in and members who
    // stopped. The only difference is where the window ENDS: a stopped
    // member's stops at the week they stopped, so what comes back is their
    // unpaid weeks up to that point and nothing beyond it.
    const standingFor = (p: (typeof cycle.participations)[number], throughWeek: number) =>
      computeStanding({
        weeklyAmount: p.weeklyAmount,
        startWeek: p.startWeek,
        weeksCommitted: p.weeksCommitted,
        cycleWeek: currentWeek,
        today,
        windowWeeks: cycle.weeks
          .filter((w) => w.weekNumber >= p.startWeek && w.weekNumber <= throughWeek)
          .map((w) => {
            const payment = p.payments.find((pm) => pm.weekId === w.id) ?? null;
            return {
              weekNumber: w.weekNumber,
              date: w.date,
              amountDue: p.weeklyAmount,
              storedPaid: payment?.amountPaid ?? 0,
              isDeferred: payment?.isDeferred ?? false,
              markedLate: payment?.markedLateAt != null,
              isSkipped: w.isSkipped,
            };
          }),
        totalPaid: p.payments.reduce((sum, pm) => sum + pm.amountPaid, 0),
        pinnedByWeek: pinnedMapFromEvents(
          p.paymentEvents
            .filter((e) => e.pinnedWeekId !== null)
            .map((e) => ({ amount: e.amount, weekNumber: e.pinnedWeek?.weekNumber ?? null })),
        ),
      });

    const owedBy: OwingMember[] = [];
    const aheadBy: AheadMember[] = [];
    for (const p of active) {
      const finishWeek = calculateFinishWeek(p.startWeek, p.weeksCommitted);
      const standing = standingFor(p, finishWeek);
      const name = p.person.nameEnglishFirst;
      if (standing.amountOutstanding > 0) {
        owedBy.push({ participationId: p.id, name, amount: standing.amountOutstanding });
      }
      // PAID AHEAD, per member: money on weeks AFTER the current one.
      //
      // This compared against `elapsed` — the last week whose payment WINDOW
      // had closed — so for the five days between a week arriving and its
      // window shutting, every ordinary on-time payment counted as paid ahead.
      // On the live cycle mid-week 13 that was 13 members and $12,925, of
      // which $9,375 was simply that week's money.
      const ahead = p.payments.filter(
        (pm) => pm.week.weekNumber > currentWeek && pm.amountPaid > 0,
      );
      if (ahead.length > 0) {
        aheadBy.push({
          participationId: p.id,
          name,
          amount: ahead.reduce((s, pm) => s + pm.amountPaid, 0),
          weeks: ahead.length,
        });
      }
    }

    // MEMBERS WHO HAVE STOPPED — reported apart from members who are behind.
    // One will pay and one will not; a screen that shows them together tells
    // the organizer he is waiting on money nobody is going to send.
    const paidOutTo = new Map<string, number>();
    for (const p of payouts) {
      if (p.status !== "COLLECTED" || !p.luckyNumber) continue;
      const id = p.luckyNumber.participationId;
      paidOutTo.set(id, (paidOutTo.get(id) ?? 0) + p.netAmount);
    }
    const stoppedBy: StoppedMember[] = stopped.map((p) => {
      // The last week they were counted: the week before their OPEN break.
      const closedAtWeek = effectiveFinishWeek({
        startWeek: p.startWeek,
        weeksCommitted: p.weeksCommitted,
        breaks: breaksOf(p),
      });
      const alreadyPaidOut = paidOutTo.get(p.id) ?? 0;
      const paidInByThem = p.payments.reduce((sum, pm) => sum + pm.amountPaid, 0);
      const amountLeaving =
        weeksLeavingExpectation({
          startWeek: p.startWeek,
          weeksCommitted: p.weeksCommitted,
          closingAtWeek: closedAtWeek,
        }) * p.weeklyAmount;
      return {
        participationId: p.id,
        name: p.person.nameEnglishFirst,
        closedAtWeek,
        // Derived, never read back from the ledger entry written at close
        // time (2.14). If they later pay one of those weeks, this figure
        // drops on its own and no stored number has to be corrected.
        balanceRecorded: standingFor(p, closedAtWeek).amountOutstanding,
        amountLeaving,
        alreadyPaidOut,
        // Only money already HANDED OVER leaves a hole. A PENDING payout has
        // not left his hands, so there is nothing yet to cover.
        shortfallToCover: alreadyPaidOut > 0 ? amountLeaving : 0,
        // Money he is HOLDING that is theirs: what a member who was never
        // drawn paid in. No fee is withheld — a fee is only ever taken from a
        // payout and they never had one (lib/final-position.ts).
        owedBack:
          alreadyPaidOut > 0
            ? 0
            : Math.max(
                0,
                paidInByThem -
                  feeOnReturn({
                    weeklyAmount: p.weeklyAmount,
                    weeksCommitted: p.weeksCommitted,
                    unitAmount: cycle.unitAmount,
                    feePercent: cycle.feePercent,
                  }),
              ),

        reason: closeReasonText(
          isCloseReason(p.closeReason) ? p.closeReason : "OTHER",
          p.closeNote,
        ),
      };
    });

    const collection = collectionPosition({ series, owedBy, aheadBy, stoppedBy, currentWeek });
    const cash = cashPosition({
      payments: flatPayments.map((p) => ({ amountPaid: p.amountPaid })),
      payouts: payouts.map((p) => ({ netAmount: p.netAmount, status: p.status })),
    });
    // THE CASH POSITION — facts only.
    //
    // handedOut counts COLLECTED payouts and nothing else: a payout that is
    // drawn but not handed over is still cash in his hand, so it is REPORTED
    // below rather than subtracted here.
    const holding = cashOnHand({
      collected: cash.totalReceived,
      handedOut: cash.totalPaidOut,
      drawnNotHandedOut: cash.committedPending,
      paidEarly: collection.paidAhead,
      // 2.18: money owed back to a stopped member who was never drawn is in
      // his hands and is not his.
      owedToStopped: collection.owedBackToStopped,
    });
    // The fee, kept OUT of the position above. It is what he might keep if the
    // cycle finishes as planned, which is a projection — and a projection
    // inside a cash position makes the whole figure less believable.
    const fee = feeEstimate({
      onHandedOut: payouts
        .filter((p) => p.status === "COLLECTED")
        .reduce((s, p) => s + p.feeAmount, 0),
      onDrawn: payouts
        .filter((p) => p.status === "PENDING")
        .reduce((s, p) => s + p.feeAmount, 0),
    });

    // A SILENT `take: 24` WAS A LIE WAITING TO HAPPEN.
    //
    // The history exists so drift across the cycle is visible. Cutting it at
    // 24 with nothing on screen saying so means that in a long cycle the
    // earliest readings simply vanish, and the organizer scrolling for what he
    // held in week 8 concludes he never recorded it. Paged, with the count
    // always stated (lib/paging.ts).
    const readingTotal = await prisma.cashReading.count();
    const readingInfo = pageInfo(readingTotal, input?.readingsPage ?? 1, input?.readingsPageSize ?? PAGE_SIZES.cashReadings);
    const readings = await prisma.cashReading.findMany({
      orderBy: { readAt: "desc" },
      skip: readingInfo.skip,
      take: readingInfo.take,
    });
    // The LATEST reading is what the verdict compares against, and it must be
    // the newest overall — not the newest on whichever page is being read.
    const latest =
      readingInfo.page === 1
        ? (readings[0] ?? null)
        : await prisma.cashReading.findFirst({ orderBy: { readAt: "desc" } });

    return {
      ok: true as const,
      data: {
        cycleName: cycle.name,
        currentWeek,
        plannedWeeks: cycle.plannedWeeks,
        collection,
        collectionSentence: collectionSentence(collection, formatMoney),
        holding,
        fee,
        cash,
        // The verdict only exists once he has told the system what he holds.
        verdict: latest
          ? positionVerdict({ cash: holding, actual: latest.totalAmount, formatMoney })
          : null,
        latestReading: latest,
        // History, each with the difference AT THAT MOMENT against today's
        // expected position — enough to see drift, honest about being a
        // comparison rather than a re-derivation of that week's books.
        readings: readings.map((r) => ({
          id: r.id,
          readAt: r.readAt,
          totalAmount: r.totalAmount,
          bankAmount: r.bankAmount,
          cashAmount: r.cashAmount,
          note: r.note,
          differenceVsExpectedToday: r.totalAmount - holding.shouldBeHolding,
        })),
        readingInfo,
      },
    };
  } catch (e) {
    console.error("getCyclePosition failed:", e);
    return { ok: false as const, error: `Could not load the cycle position. ${errorMessage(e)}` };
  }
}

/** Record what he actually holds, right now. The only stored fact here. */
export async function recordCashReading(input: {
  totalAmount: number;
  bankAmount?: number | null;
  cashAmount?: number | null;
  readAt: string;
  note?: string;
}) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    if (await getSetting("presentationMode")) {
      return { ok: false as const, error: PRESENTATION_HIDDEN };
    }
    const valid = (v: number) => Number.isSafeInteger(v) && v >= 0 && v <= MAX_MONEY_CENTS;
    if (!valid(input.totalAmount)) {
      return { ok: false as const, error: "The total must be a whole amount of money." };
    }
    for (const [label, v] of [
      ["Bank", input.bankAmount],
      ["Cash on hand", input.cashAmount],
    ] as const) {
      if (v !== undefined && v !== null && !valid(v)) {
        return { ok: false as const, error: `${label} must be a whole amount of money.` };
      }
    }
    // If he gave both lines, they must be the total — otherwise the record
    // would disagree with itself and there would be no way to know which half
    // was right.
    const bank = input.bankAmount ?? null;
    const onHand = input.cashAmount ?? null;
    if (bank !== null && onHand !== null && bank + onHand !== input.totalAmount) {
      return {
        ok: false as const,
        error:
          `Bank (${formatMoney(bank)}) plus cash on hand (${formatMoney(onHand)}) is ` +
          `${formatMoney(bank + onHand)}, not ${formatMoney(input.totalAmount)}. ` +
          `Correct one of them — nothing was saved.`,
      };
    }
    const readAt = new Date(input.readAt);
    if (Number.isNaN(readAt.getTime())) {
      return { ok: false as const, error: "The reading date must be valid." };
    }

    const cycle = await prisma.cycle.findFirst({
      where: { status: "ACTIVE" },
      select: { id: true },
    });
    const reading = await prisma.$transaction(async (tx) => {
      const created = await tx.cashReading.create({
        data: {
          cycleId: cycle?.id ?? null,
          totalAmount: input.totalAmount,
          bankAmount: bank,
          cashAmount: onHand,
          readAt,
          note: input.note?.trim() || null,
        },
      });
      await logAudit(tx, {
        entity: "CashReading",
        entityId: created.id,
        action: "create",
        summary:
          `Cash reading recorded: ${formatMoney(created.totalAmount)} held on ` +
          `${readAt.toISOString().slice(0, 10)}` +
          (bank !== null || onHand !== null
            ? ` (${bank !== null ? `bank ${formatMoney(bank)}` : ""}${bank !== null && onHand !== null ? ", " : ""}${onHand !== null ? `cash on hand ${formatMoney(onHand)}` : ""})`
            : "") +
          (created.note ? `. Note: "${created.note}"` : ""),
        after: { totalAmount: created.totalAmount, bankAmount: bank, cashAmount: onHand, readAt },
      });
      return created;
    });

    revalidatePath("/admin/cycle/position");
    revalidatePath("/admin");
    return { ok: true as const, data: reading };
  } catch (e) {
    console.error("recordCashReading failed:", e);
    return { ok: false as const, error: `Could not save the reading. ${errorMessage(e)}` };
  }
}

/** Remove a reading recorded in error (2.23 — anything creatable is removable). */
export async function deleteCashReading(input: { id: string }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    await prisma.$transaction(async (tx) => {
      const target = await tx.cashReading.findUniqueOrThrow({ where: { id: input.id } });
      await tx.cashReading.delete({ where: { id: input.id } });
      await logAudit(tx, {
        entity: "CashReading",
        entityId: input.id,
        action: "delete",
        summary:
          `Cash reading deleted: ${formatMoney(target.totalAmount)} held on ` +
          `${target.readAt.toISOString().slice(0, 10)}`,
        before: { totalAmount: target.totalAmount, readAt: target.readAt },
      });
    });
    revalidatePath("/admin/cycle/position");
    return { ok: true as const, data: { deleted: true } };
  } catch (e) {
    console.error("deleteCashReading failed:", e);
    return { ok: false as const, error: `Could not delete the reading. ${errorMessage(e)}` };
  }
}
