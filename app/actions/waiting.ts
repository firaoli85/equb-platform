"use server";

// WHO IS WAITING — the money the group owes its members (2.1). Read-only:
// it derives both groups from the SAME records Collections and the wheel read,
// so a figure here can never disagree with one there.
//
// Presentation mode (2.4) hides it entirely — every row is a name attached to
// an amount.

import { errorMessage } from "@/lib/action-result";
import { requireAdmin } from "@/lib/auth";
import { SETTLEMENT_EVENT_WHERE } from "@/lib/draw-settlement";
import { calculateFinishWeek } from "@/lib/money";
import { PRESENTATION_HIDDEN } from "@/lib/presentation";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";
import { computeStanding, pinnedMapFromEvents } from "@/lib/standing";
import { currentWeekFromRows } from "@/lib/commitment";
import {
  daysBetween,
  isAtRisk,
  waitingTotals,
  type AwaitingPaymentRow,
  type AwaitingTurnRow,
} from "@/lib/waiting";
import { calculatePayout } from "@/lib/wheel";

export type WaitingData = {
  cycleName: string;
  currentWeek: number;
  awaitingPayment: AwaitingPaymentRow[];
  awaitingTurn: AwaitingTurnRow[];
  totals: ReturnType<typeof waitingTotals>;
};

export async function getWaiting(): Promise<
  { ok: true; data: WaitingData } | { ok: false; error: string }
> {
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
          where: { status: "ACTIVE" },
          include: {
            person: true,
            payments: true,
            luckyNumbers: { orderBy: { number: "asc" } },
          },
        },
      },
    });
    if (!cycle) {
      return {
        ok: true as const,
        data: {
          cycleName: "",
          currentWeek: 0,
          awaitingPayment: [],
          awaitingTurn: [],
          totals: waitingTotals({ awaitingPayment: [], awaitingTurn: [] }),
        },
      };
    }

    const today = new Date();
    // 2.14: the stored rows are the clock — the 2.27 safeguard must not move
    // because a start date was corrected.
    const currentWeek = currentWeekFromRows({
      weeks: cycle.weeks,
      today,
      cycleStartDate: cycle.startDate,
    });

    // ————— Group 1: drawn, payout still PENDING — owed NOW —————
    const pending = await prisma.payout.findMany({
      where: { status: "PENDING", luckyNumber: { cycleId: cycle.id } },
      include: {
        luckyNumber: { include: { participation: { include: { person: true } } } },
        draw: { include: { week: true } },
      },
    });

    // What each pending payout already settled onto the winner's own week —
    // attributed through the payout FK (audit C6), never by parsing a key.
    const settlementEvents = await prisma.paymentEvent.findMany({
      where: {
        ...SETTLEMENT_EVENT_WHERE,
        settlementPayoutId: { in: pending.map((p) => p.id) },
      },
      select: { settlementPayoutId: true, amount: true },
    });
    const settledByPayout = new Map<string, number>();
    for (const e of settlementEvents) {
      if (!e.settlementPayoutId) continue;
      settledByPayout.set(
        e.settlementPayoutId,
        (settledByPayout.get(e.settlementPayoutId) ?? 0) + e.amount,
      );
    }

    const awaitingPayment: AwaitingPaymentRow[] = pending.map((p) => ({
      kind: "awaiting-payment" as const,
      payoutId: p.id,
      participationId: p.luckyNumber.participationId,
      personId: p.luckyNumber.participation.personId,
      name: p.luckyNumber.participation.person.nameEnglishFirst,
      nameAmharic: p.luckyNumber.participation.person.nameAmharic,
      number: p.luckyNumber.number,
      weekNumber: p.draw?.week.weekNumber ?? null,
      drawnAt: p.draw?.drawnAt.toISOString() ?? null,
      grossAmount: p.grossAmount,
      feeAmount: p.feeAmount,
      netAmount: p.netAmount,
      settlementAmount: settledByPayout.get(p.id) ?? 0,
      method: p.method,
      daysWaiting: p.draw ? daysBetween(p.draw.drawnAt, today) : null,
    }));

    // ————— Group 2: never drawn — awaiting their turn —————
    //
    // Drawn-ness is SLOT MEMBERSHIP, exactly as the wheel derives it, so this
    // list and the wheel pool can never disagree.
    const draws = await prisma.draw.findMany({
      where: { week: { cycleId: cycle.id } },
      include: { slot: { include: { members: { select: { luckyNumberId: true } } } } },
    });
    const drawnNumberIds = new Set(
      draws.flatMap((d) => d.slot.members.map((m) => m.luckyNumberId)),
    );

    // Pinned settlements per participation, so weeksPaid agrees with the
    // member page (2.14 — one derivation, read everywhere).
    const allPinned = await prisma.paymentEvent.findMany({
      where: { ...SETTLEMENT_EVENT_WHERE, participation: { cycleId: cycle.id } },
      select: {
        participationId: true,
        amount: true,
        pinnedWeek: { select: { weekNumber: true } },
      },
    });
    const pinnedByParticipation = new Map<string, { amount: number; weekNumber: number | null }[]>();
    for (const e of allPinned) {
      const list = pinnedByParticipation.get(e.participationId) ?? [];
      list.push({ amount: e.amount, weekNumber: e.pinnedWeek?.weekNumber ?? null });
      pinnedByParticipation.set(e.participationId, list);
    }

    const awaitingTurn: AwaitingTurnRow[] = [];
    for (const p of cycle.participations) {
      const undrawn = p.luckyNumbers.filter((n) => !drawnNumberIds.has(n.id));
      if (undrawn.length === 0) continue;

      const finishWeek = calculateFinishWeek(p.startWeek, p.weeksCommitted);
      const paymentByWeekId = new Map(p.payments.map((pm) => [pm.weekId, pm]));
      const standing = computeStanding({
        weeklyAmount: p.weeklyAmount,
        startWeek: p.startWeek,
        weeksCommitted: p.weeksCommitted,
        cycleWeek: currentWeek,
        today,
        windowWeeks: cycle.weeks
          .filter((w) => w.weekNumber >= p.startWeek && w.weekNumber <= finishWeek)
          .map((w) => {
            const payment = paymentByWeekId.get(w.id) ?? null;
            return {
              weekNumber: w.weekNumber,
              date: w.date,
              amountDue: p.weeklyAmount,
              storedPaid: payment?.amountPaid ?? 0,
              isDeferred: payment?.isDeferred ?? false,
              isSkipped: w.isSkipped,
            };
          }),
        totalPaid: p.payments.reduce((s, pm) => s + pm.amountPaid, 0),
        pinnedByWeek: pinnedMapFromEvents(pinnedByParticipation.get(p.id) ?? []),
      });

      const money = undrawn.reduce(
        (acc, n) => {
          const payout = calculatePayout({
            luckyNumber: { id: n.id, amount: n.amount },
            participation: { weeksCommitted: p.weeksCommitted },
            cycle: { feePercent: cycle.feePercent },
          });
          return {
            gross: acc.gross + payout.gross,
            fee: acc.fee + payout.fee,
            net: acc.net + payout.net,
          };
        },
        { gross: 0, fee: 0, net: 0 },
      );

      const weeksLeft = finishWeek - currentWeek;
      awaitingTurn.push({
        kind: "awaiting-turn" as const,
        participationId: p.id,
        personId: p.personId,
        name: p.person.nameEnglishFirst,
        nameAmharic: p.person.nameAmharic,
        numbers: undrawn.map((n) => n.number),
        netAmount: money.net,
        grossAmount: money.gross,
        feeAmount: money.fee,
        weeksPaid: Math.min(standing.weeksCredited, p.weeksCommitted),
        weeksCommitted: p.weeksCommitted,
        startWeek: p.startWeek,
        finishWeek,
        weeksLeft,
        atRisk: isAtRisk({ weeksLeft }),
      });
    }

    return {
      ok: true as const,
      data: {
        cycleName: cycle.name,
        currentWeek,
        awaitingPayment,
        awaitingTurn,
        totals: waitingTotals({ awaitingPayment, awaitingTurn }),
      },
    };
  } catch (e) {
    console.error("getWaiting failed:", e);
    return { ok: false as const, error: `Could not load who is waiting. ${errorMessage(e)}` };
  }
}
