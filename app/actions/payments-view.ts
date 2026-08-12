"use server";

import { errorMessage } from "@/lib/action-result";
import { requireAdmin } from "@/lib/auth";
import {
  buildPaymentGrid,
  resolveTargetWeek,
  splitWeekRoster,
  type GridMemberInput,
  type RosterMember,
} from "@/lib/payments-view";
import { manualLateAdvice, PAYMENT_WINDOW_DAYS } from "@/lib/derived";
import { calculateFinishWeek, currentWeekNumber } from "@/lib/money";
import { numbersLabel, redactGrid, redactWeekBoard, PRESENTATION_HIDDEN } from "@/lib/presentation";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";
import { computeStanding, pinnedMapFromEvents, type Standing } from "@/lib/standing";

const MS_PER_DAY = 86_400_000;
function utcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

type LoadedCycle = NonNullable<Awaited<ReturnType<typeof loadActiveCycleWithPayments>>>;

async function loadActiveCycleWithPayments() {
  return prisma.cycle.findFirst({
    where: { status: "ACTIVE" },
    include: {
      weeks: { orderBy: { weekNumber: "asc" } },
      participations: {
        where: { status: "ACTIVE" },
        include: {
          person: true,
          luckyNumbers: { orderBy: { number: "asc" } },
          payments: { include: { week: { select: { id: true, weekNumber: true, isSkipped: true } } } },
          // Payout settlements stay pinned to their drawn week (never fungible).
          paymentEvents: {
            where: { pinnedWeekId: { not: null } },
            select: { amount: true, pinnedWeek: { select: { weekNumber: true } } },
          },
        },
      },
    },
  });
}

function standingFor(
  cycle: LoadedCycle,
  participation: LoadedCycle["participations"][number],
  cycleWeek: number,
  today: Date,
): { standing: Standing; finishWeek: number } {
  const finishWeek = calculateFinishWeek(participation.startWeek, participation.weeksCommitted);
  const standing = computeStanding({
    weeklyAmount: participation.weeklyAmount,
    startWeek: participation.startWeek,
    weeksCommitted: participation.weeksCommitted,
    cycleWeek,
    today,
    windowWeeks: cycle.weeks
      .filter((w) => w.weekNumber >= participation.startWeek && w.weekNumber <= finishWeek)
      .map((w) => {
        const payment = participation.payments.find((p) => p.weekId === w.id) ?? null;
        return {
          weekNumber: w.weekNumber,
          date: w.date,
          amountDue: participation.weeklyAmount,
          storedPaid: payment?.amountPaid ?? 0,
          isDeferred: payment?.isDeferred ?? false,
          markedLate: payment?.markedLateAt != null,
          isSkipped: w.isSkipped,
        };
      }),
    totalPaid: participation.payments.reduce((sum, p) => sum + p.amountPaid, 0),
    pinnedByWeek: pinnedMapFromEvents(
      participation.paymentEvents.map((e) => ({
        amount: e.amount,
        weekNumber: e.pinnedWeek?.weekNumber ?? null,
      })),
    ),
  });
  return { standing, finishWeek };
}

// getWeekBoard (the retired "Record week" view) was removed with that view:
// recording for one week is now done by clicking any week in the Members list
// or any cell in the Grid, both of which open the shared per-week panel. Its
// pure helpers (resolveTargetWeek, splitWeekRoster, redactWeekBoard) remain in
// lib/ with their tests.

/**
 * The grid — the map (2.15): every member, every week, derived status per
 * cell. Reads only; clicking a cell leads into the same one engine.
 */
export async function getPaymentsGrid() {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const cycle = await loadActiveCycleWithPayments();
    if (!cycle) return { ok: false as const, error: "No active cycle." };

    const today = new Date();
    const cycleWeek = currentWeekNumber(cycle.startDate, today);

    const members: GridMemberInput[] = cycle.participations.map((participation) => {
      const { standing, finishWeek } = standingFor(cycle, participation, cycleWeek, today);
      return {
        participationId: participation.id,
        name: `${participation.person.nameAmharic} — ${participation.person.nameEnglishFirst}`,
        numbersLabel: participation.luckyNumbers.map((n) => `#${n.number}`).join(", "),
        startWeek: participation.startWeek,
        finishWeek,
        weeksCredited: standing.weeksCredited,
        outstanding: standing.amountOutstanding,
        // 2.1/2.14: the savings figure — the sum of what they actually paid.
        totalContributed: standing.totalPaid,
        weeks: standing.weeks.map((w) => ({
          weekNumber: w.weekNumber,
          status: w.status,
          storedPaid: w.amountPaid,
          amountDue: w.amountDue,
        })),
      };
    });

    const grid = buildPaymentGrid({
      weeks: cycle.weeks.map((w) => ({
        weekNumber: w.weekNumber,
        date: w.date,
        isSkipped: w.isSkipped,
      })),
      members,
    });

    const full = {
      presentation: false as const,
      cycleName: cycle.name,
      currentCycleWeek: cycleWeek,
      grid,
      // For the click-through into the action: each member's remaining due
      // per week so the allocation entry can be prefilled.
      memberWeekly: Object.fromEntries(
        cycle.participations.map((p) => [p.id, p.weeklyAmount]),
      ) as Record<string, number>,
    };

    // Presentation mode (2.4): columns become lucky numbers, statuses stay,
    // money is not sent.
    if (await getSetting("presentationMode")) {
      return { ok: true as const, data: redactGrid(full) };
    }
    return { ok: true as const, data: full };
  } catch (e) {
    console.error("getPaymentsGrid failed:", e);
    return { ok: false as const, error: `Could not load the grid. ${errorMessage(e)}` };
  }
}

/**
 * One grid cell's detail for the action menu: the receipts allocated to
 * this member's week (each undoable), the note, and the deferral state.
 * Read-only.
 */
export async function getCellDetail(input: { participationId: string; weekNumber: number }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    // Receipts are money with a name attached — nothing is sent (2.4).
    if (await getSetting("presentationMode")) {
      return { ok: false as const, error: PRESENTATION_HIDDEN };
    }
    const participation = await prisma.participation.findUnique({
      where: { id: input.participationId },
      include: { person: true, cycle: { select: { id: true } } },
    });
    if (!participation) return { ok: false as const, error: "Participation not found." };
    const week = await prisma.week.findUnique({
      where: {
        cycleId_weekNumber: { cycleId: participation.cycle.id, weekNumber: input.weekNumber },
      },
    });
    if (!week) return { ok: false as const, error: "Week not found." };

    const payment = await prisma.payment.findUnique({
      where: { weekId_participationId: { weekId: week.id, participationId: input.participationId } },
      include: {
        allocations: {
          include: { event: { select: { id: true, amount: true, method: true, receivedAt: true } } },
          orderBy: { event: { receivedAt: "asc" } },
        },
      },
    });

    return {
      ok: true as const,
      data: {
        memberName: participation.person.nameEnglishFirst,
        weekNumber: input.weekNumber,
        isDeferred: payment?.isDeferred ?? false,
        markedLate: payment?.markedLateAt != null,
        markedLateNote: payment?.markedLateNote ?? "",
        // WHAT MARKING THIS WEEK LATE WOULD MEAN, decided on the SERVER'S
        // clock — the same one `setWeekLate` refuses with. Computed here so a
        // laptop whose date is wrong cannot offer a control the action will
        // then reject, or hide one it would have accepted.
        lateAdvice: manualLateAdvice({
          weekDate: week.date,
          today: new Date(),
          weekNumber: input.weekNumber,
          isDeferred: payment?.isDeferred ?? false,
        }),
        weekIsSkipped: week.isSkipped,
        note: payment?.notes ?? "",
        receipts: (payment?.allocations ?? []).map((a) => ({
          eventId: a.event.id,
          appliedHere: a.amount,
          eventAmount: a.event.amount,
          method: a.event.method,
          receivedAt: a.event.receivedAt.toISOString(),
        })),
      },
    };
  } catch (e) {
    console.error("getCellDetail failed:", e);
    return { ok: false as const, error: `Could not load the cell. ${errorMessage(e)}` };
  }
}

/**
 * A member's weeks for the bulk catch-up picker, with what each week still
 * owes. Read-only; the recording itself runs through the one engine.
 */
export async function getCatchUpWeeks(participationId: string) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    // A member's owed-per-week list is money with a name attached (2.4).
    if (await getSetting("presentationMode")) {
      return { ok: false as const, error: PRESENTATION_HIDDEN };
    }
    const participation = await prisma.participation.findUnique({
      where: { id: participationId },
      include: {
        person: true,
        payments: true,
        cycle: { include: { weeks: { orderBy: { weekNumber: "asc" } } } },
      },
    });
    if (!participation) return { ok: false as const, error: "Participation not found." };

    const finishWeek = calculateFinishWeek(participation.startWeek, participation.weeksCommitted);
    const weeks = participation.cycle.weeks
      .filter((w) => w.weekNumber >= participation.startWeek && w.weekNumber <= finishWeek)
      .map((w) => {
        const payment = participation.payments.find((p) => p.weekId === w.id) ?? null;
        return {
          weekNumber: w.weekNumber,
          date: w.date,
          amountDue: participation.weeklyAmount,
          amountAlreadyPaid: payment?.amountPaid ?? 0,
          isDeferred: payment?.isDeferred ?? false,
          markedLate: payment?.markedLateAt != null,
          isSkipped: w.isSkipped,
        };
      });

    return {
      ok: true as const,
      data: { name: participation.person.nameEnglishFirst, weeks },
    };
  } catch (e) {
    console.error("getCatchUpWeeks failed:", e);
    return { ok: false as const, error: `Could not load the weeks. ${errorMessage(e)}` };
  }
}
