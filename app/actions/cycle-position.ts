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

import { recoverableForUndrawn } from "@/lib/final-position";
import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { currentWeekFromRows, elapsedThroughWeek } from "@/lib/commitment";
import { frozenCycleRefusal } from "@/lib/cycle-close";
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
import { endOfCycle, endOfCycleSentence } from "@/lib/end-of-cycle";
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
import { PRESENTATION_HIDDEN } from "@/lib/presentation";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";
import { computeStanding, pinnedMapFromEvents } from "@/lib/standing";
import { calculatePayout } from "@/lib/wheel";

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
            // Their numbers and whether each has been drawn — the end-of-cycle
            // projection needs what is still to go OUT, and that is one payout
            // per number that has none yet.
            luckyNumbers: {
              select: { id: true, amount: true, payouts: { select: { id: true } } },
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
        // drawn paid in, LESS THE FEE (§2.30 / D-41).
        //
        // THE FEE IS TAKEN WHETHER OR NOT THEY WERE DRAWN. It is the
        // organizer's charge for holding their reserved place in the cycle,
        // and the place was held for them whether or not the wheel reached
        // them. Recoverable is `paid in − fee`, floored at zero. Section 4 of
        // the agreement every member signs says the same thing: "It is fixed
        // by what I committed to, not by how many weeks I end up paying. If I
        // stop early the fee does not shrink."
        //
        // THE COMMENT THAT USED TO SIT HERE SAID THE OPPOSITE — "a fee is only
        // ever taken from a payout and they never had one" — and it was
        // simply out of date, written before §2.30 and never revisited. It was
        // believed over the code, the subtraction was deleted, and for one
        // commit this screen told the organizer he owed a stopped member her
        // whole paid-in while her own portal told her `paid in − fee`. Two
        // screens, two answers, about money a real person is owed.
        //
        // Through the shared rule now, so they cannot drift again.
        owedBack:
          alreadyPaidOut > 0
            ? 0
            : recoverableForUndrawn({
                paidIn: paidInByThem,
                weeklyAmount: p.weeklyAmount,
                weeksCommitted: p.weeksCommitted,
                unitAmount: cycle.unitAmount,
                feePercent: cycle.feePercent,
              }).amount,

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

    // ————————————— WHERE THE CYCLE FINISHES (lib/end-of-cycle.ts) —————————————
    //
    // A DIFFERENT QUESTION FROM THE ONE ABOVE, and the reason this exists: the
    // organizer worked it out on paper every week, got about $875 short, and
    // the screen said $6,325. Both were right. The cash position looks
    // backward at money that has already moved; this looks forward over money
    // that has not. Nothing on the page said they were different questions.
    //
    // Every figure below is READ from a derivation that already exists. This
    // adds and subtracts; it decides nothing.
    const futureWeeks = series.filter((w) => w.weekNumber > currentWeek);
    const futureContributions = futureWeeks.reduce(
      // Less what is already in: money paid early for a future week is not
      // still to come, and counting it again would flatter the projection.
      (s, w) => s + Math.max(0, w.expected - w.received),
      0,
    );
    const arrears = series
      .filter((w) => w.elapsed)
      .reduce((s, w) => s + Math.max(0, w.expected - w.received), 0);

    // WHAT IS STILL TO GO OUT, through `calculatePayout` — the same arithmetic
    // the draw, the portal and the archive use. The pot is the NUMBER's amount
    // times that member's OWN weeks, never a fixed twenty: Henok is a ten-week
    // member and Alex a fifteen-week one.
    //
    // A CLOSED member's undrawn number is NOT awaiting a turn. It has left the
    // wheel (2.27) and what they get is a refund, counted separately below.
    // Including it here would both overstate what goes out and double-count
    // the same person.
    let payoutsStillToGoOut = 0;
    let feeStillToEarn = 0;
    for (const p of active) {
      for (const n of p.luckyNumbers) {
        if (n.payouts.length > 0) continue;
        const due = calculatePayout({
          luckyNumber: { id: n.id, amount: n.amount },
          participation: { weeksCommitted: p.weeksCommitted },
          cycle: { feePercent: cycle.feePercent },
        });
        payoutsStillToGoOut += due.net;
        feeStillToEarn += due.fee;
      }
    }

    // WHO HE OWES, each carrying his own answer about whether it belongs in
    // the sum. `owedBack` is already `paid in − fee` through the shared §2.30
    // rule, so this reads it rather than recomputing it.
    const refunds = stoppedBy
      .filter((s) => s.owedBack > 0)
      .map((s) => {
        const p = stopped.find((x) => x.id === s.participationId);
        return {
          participationId: s.participationId,
          name: s.name,
          amount: s.owedBack,
          counted: p?.refundCountedInProjection ?? true,
        };
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

    const projection = endOfCycle({
      futureContributions,
      arrears,
      payoutsStillToGoOut,
      feeStillToEarn,
      refunds,
      inHand: latest?.totalAmount ?? 0,
    });


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
        // WHERE THE CYCLE FINISHES — the other question, answered beside the
        // first one so he stops working it out on paper.
        projection,
        projectionSentence: endOfCycleSentence(projection, formatMoney, latest !== null),
        // The verdict only exists once he has told the system what he holds.
        verdict: latest
          ? positionVerdict({
              cash: holding,
              actual: latest.totalAmount,
              // ONLY `soFar` — the fee on payouts already handed over. It is
              // settled, not a projection, and it is the single biggest thing
              // in a gap that is not actually missing money: he hands over a
              // payout less his fee, so the fee never leaves the tin and the
              // books count it as held right up until he takes it.
              // `ifRemainingPayoutsComplete` is deliberately NOT passed — that
              // half depends on how the cycle finishes.
              feeSoFar: fee.soFar,
              formatMoney,
            })
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

/**
 * COUNT WHAT HE OWES THIS PERSON IN THE PROJECTION, OR NOT.
 *
 * The only choice on this page, and it is deliberately narrow: it moves one
 * figure in one sum. It cannot forgive a debt, change what is owed, or take a
 * name off a list.
 *
 * REFUSED FOR THE OTHER DIRECTION. A member who took the pot and then stopped
 * owes HIM, and that is not a choice — it is a hole he has to cover whatever
 * he would prefer. Only a member he owes can be toggled, and this checks it
 * against the receipts rather than trusting the caller.
 */
export async function setRefundCountedInProjection(input: {
  participationId: string;
  counted: boolean;
}) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const p = await prisma.participation.findUnique({
      where: { id: input.participationId },
      include: {
        person: true,
        cycle: true,
        payments: true,
        luckyNumbers: { select: { payouts: { select: { netAmount: true, status: true } } } },
      },
    });
    if (!p) return { ok: false as const, error: "That member is not in this cycle." };

    // THE SHARED FREEZE CHECK (rule 14). A closed cycle's books are final: its
    // carried balances are already written from these very receipts, and a
    // projection of where it "finishes" is a question about a cycle that has
    // finished. The guard in lib/cycle-lock.test.ts caught this missing.
    const frozen = frozenCycleRefusal(p.cycle);
    if (frozen) return { ok: false as const, error: frozen };

    if (p.status !== "CLOSED") {
      return {
        ok: false as const,
        error: `${p.person.nameEnglishFirst} is still in the cycle, so nothing is owed back yet.`,
      };
    }
    // THE DIRECTION IS A FACT, NOT AN INPUT. Drawn means they owe him.
    const paidOut = p.luckyNumbers
      .flatMap((n) => n.payouts)
      .filter((po) => po.status === "COLLECTED")
      .reduce((s, po) => s + po.netAmount, 0);
    if (paidOut > 0) {
      return {
        ok: false as const,
        error:
          `${p.person.nameEnglishFirst} was already paid out, so this is money owed TO the cycle, ` +
          `not back to them. That has to be covered either way and cannot be set aside here.`,
      };
    }

    const paidIn = p.payments.reduce((s, pm) => s + pm.amountPaid, 0);
    const { amount } = recoverableForUndrawn({
      paidIn,
      weeklyAmount: p.weeklyAmount,
      weeksCommitted: p.weeksCommitted,
      unitAmount: p.cycle.unitAmount,
      feePercent: p.cycle.feePercent,
    });
    if (amount <= 0) {
      return {
        ok: false as const,
        error: `Nothing is owed back to ${p.person.nameEnglishFirst}.`,
      };
    }

    await prisma.$transaction(async (tx) => {
      await tx.participation.update({
        where: { id: p.id },
        data: { refundCountedInProjection: input.counted },
      });
      await logAudit(tx, {
        entity: "Participation",
        entityId: p.id,
        action: "update",
        summary: input.counted
          ? `${formatMoney(amount)} owed to ${p.person.nameEnglishFirst} is counted in the cash projection.`
          : `${formatMoney(amount)} owed to ${p.person.nameEnglishFirst} is handled by hand and left out of ` +
            `the cash projection. It is still owed and still on their record.`,
        before: { refundCountedInProjection: p.refundCountedInProjection },
        after: { refundCountedInProjection: input.counted, amount },
      });
    });

    revalidatePath("/admin/cash");
    revalidatePath("/admin/cycle/position");
    revalidatePath(`/admin/people/${p.personId}`);
    return { ok: true as const, data: { counted: input.counted, amount } };
  } catch (e) {
    console.error("setRefundCountedInProjection failed:", e);
    return { ok: false as const, error: `Could not save that choice. ${errorMessage(e)}` };
  }
}
