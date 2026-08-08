"use server";

import { errorMessage } from "@/lib/action-result";
import { requireAdmin } from "@/lib/auth";
import {
  cashPosition,
  cashSeries,
  receivedByMember,
  receiptsByWeek,
  memberAttention,
  weekMemberStatus,
  type DashboardPayment,
} from "@/lib/dashboard";
import { PAYMENT_WINDOW_DAYS } from "@/lib/derived";
import { elapsedThroughWeek } from "@/lib/commitment";
import { currentWeekNumber } from "@/lib/money";
import { redactDashboard } from "@/lib/presentation";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";
import { undrawnWindowWarnings } from "@/lib/wheel";

const MS_PER_DAY = 86_400_000;
function utcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * The complete financial picture (2.1), computed fresh on every call (2.14 —
 * no cached totals). Three queries total; nothing per-member.
 */
/**
 * The dashboard, and the per-week drill-down behind it.
 *
 * `weekNumber` chooses which week the breakdown describes. It defaults to the
 * current week, so every existing caller is unaffected — and the /admin/this-week
 * selector passes a chosen one. It is the SAME `weekMemberStatus` derivation
 * either way (the function was always week-agnostic; only the caller was
 * hardcoded to today), so a past week's page can never disagree with what that
 * week looked like on the day.
 */
export async function getDashboard(input?: { weekNumber?: number }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const cycle = await prisma.cycle.findFirst({
      where: { status: "ACTIVE" },
      include: {
        weeks: { orderBy: { weekNumber: "asc" } },
        participations: {
          include: {
            person: true,
            payments: { include: { week: { select: { weekNumber: true, isSkipped: true } } } },
          },
        },
      },
    });
    if (!cycle) return { ok: false as const, error: "No active cycle." };

    const [payouts, drawsCount, luckyNumbers, drawnMembers] = await Promise.all([
      prisma.payout.findMany({
        where: { luckyNumber: { cycleId: cycle.id } },
        include: {
          luckyNumber: { include: { participation: { include: { person: true } } } },
          draw: { include: { week: { select: { weekNumber: true } } } },
        },
      }),
      prisma.draw.count({ where: { week: { cycleId: cycle.id } } }),
      prisma.luckyNumber.findMany({
        where: { cycleId: cycle.id },
        select: { id: true, number: true, amount: true, participationId: true },
      }),
      prisma.slotMember.findMany({
        where: { slot: { cycleId: cycle.id, draws: { some: {} } } },
        select: { luckyNumberId: true },
      }),
    ]);

    const today = new Date();
    const currentWeek = currentWeekNumber(cycle.startDate, today);
    // The week the breakdown describes. Defaults to the current one, and only
    // a week that actually EXISTS is honoured — a hand-typed ?week=999 falls
    // back rather than rendering an empty page that looks like a real answer.
    const requested = input?.weekNumber;
    const selectedWeek =
      requested !== undefined && cycle.weeks.some((w) => w.weekNumber === requested)
        ? requested
        : currentWeek;
    const active = cycle.participations.filter((p) => p.status === "ACTIVE");

    const flatPayments: DashboardPayment[] = cycle.participations.flatMap((participation) =>
      participation.payments.map((payment) => ({
        participationId: participation.id,
        weekNumber: payment.week.weekNumber,
        amountPaid: payment.amountPaid,
        isDeferred: payment.isDeferred,
        isSkipped: payment.week.isSkipped,
      })),
    );

    const position = cashPosition({
      payments: flatPayments.map((p) => ({ amountPaid: p.amountPaid })),
      payouts: payouts.map((p) => ({ netAmount: p.netAmount, status: p.status })),
    });

    // The position OVER TIME (ADMIN_IA §5.2). Attributed by the week the
    // money is FOR, so every point can be checked against a week row.
    const cash = cashSeries({
      weeks: cycle.weeks.map((w) => ({ weekNumber: w.weekNumber })),
      payments: flatPayments.map((p) => ({
        weekNumber: p.weekNumber,
        amountPaid: p.amountPaid,
      })),
      payouts: payouts.map((p) => ({
        weekNumber: p.draw?.week.weekNumber ?? null,
        netAmount: p.netAmount,
        status: p.status,
      })),
      elapsedThroughWeek: elapsedThroughWeek(cycle.weeks, today),
    });

    const series = receiptsByWeek({
      weeks: cycle.weeks.map((w) => ({ weekNumber: w.weekNumber, isSkipped: w.isSkipped })),
      participations: active,
      payments: flatPayments,
      // Same boundary the cash series uses — 2.14: each week's OWN stored date.
      elapsedThroughWeek: elapsedThroughWeek(cycle.weeks, today),
    });

    const activeNamed = active.map((p) => ({
      id: p.id,
      name: `${p.person.nameAmharic} — ${p.person.nameEnglishFirst}`,
      weeklyAmount: p.weeklyAmount,
      startWeek: p.startWeek,
      weeksCommitted: p.weeksCommitted,
    }));
    const attention = memberAttention({
      participations: activeNamed,
      payments: flatPayments,
      // 2.14: the money boundary is each week's OWN stored date, never the
      // week number projected off an editable cycle start date.
      elapsedThroughWeek: elapsedThroughWeek(cycle.weeks, today),
    });

    // Weeks whose payment window has CLOSED with money still outstanding
    // (late is derived from the calendar — 2.14/2.16).
    const closedShortfalls = series
      .filter((w) => {
        const week = cycle.weeks.find((cw) => cw.weekNumber === w.weekNumber)!;
        const closed = utcDay(today) >= utcDay(week.date) + PAYMENT_WINDOW_DAYS * MS_PER_DAY;
        return closed && !week.isSkipped && w.shortfall > 0;
      })
      .map((w) => ({ weekNumber: w.weekNumber, shortfall: w.shortfall }));

    // The current week's payment window state.
    const currentWeekRow = cycle.weeks.find((w) => w.weekNumber === currentWeek) ?? null;
    let window: { lastOpenDayName: string; daysLeft: number } | null = null;
    if (currentWeekRow) {
      const lastOpenDay = new Date(
        utcDay(currentWeekRow.date) + (PAYMENT_WINDOW_DAYS - 1) * MS_PER_DAY,
      );
      const daysLeft = Math.floor(
        (utcDay(currentWeekRow.date) + PAYMENT_WINDOW_DAYS * MS_PER_DAY - utcDay(today)) /
          MS_PER_DAY,
      );
      window = {
        lastOpenDayName: lastOpenDay.toLocaleDateString("en-US", {
          weekday: "long",
          timeZone: "UTC",
        }),
        daysLeft,
      };
    }

    const full = {
      presentation: false as const,
      cycle: { id: cycle.id, name: cycle.name, plannedWeeks: cycle.plannedWeeks },
        currentWeek,
        weeksRemaining: Math.max(0, cycle.plannedWeeks - currentWeek),
        memberCount: active.length,
        window,
        position,
        drawsCount,
        paidOutCount: payouts.filter((p) => p.status === "COLLECTED").length,
        thisWeek: series.find((w) => w.weekNumber === currentWeek) ?? null,
        series,
        cash,
        attention,
        pendingPayouts: payouts
          .filter((p) => p.status === "PENDING")
          .map((p) => ({
            id: p.id,
            who: `#${p.luckyNumber.number} ${p.luckyNumber.participation.person.nameEnglishFirst}`,
            netAmount: p.netAmount,
            weekNumber: p.draw?.week.weekNumber ?? null,
          })),
        closedShortfalls,
        // Drill-downs (2.1: no dead figures — every number explains itself)
        receivedByMember: receivedByMember({
          participations: activeNamed,
          payments: flatPayments,
        }),
        paidOutDetail: payouts
          .filter((p) => p.status === "COLLECTED")
          .map((p) => ({
            id: p.id,
            who: `#${p.luckyNumber.number} ${p.luckyNumber.participation.person.nameEnglishFirst}`,
            netAmount: p.netAmount,
            paidAt: p.paidAt,
            weekNumber: p.draw?.week.weekNumber ?? null,
          })),
        thisWeekMembers: weekMemberStatus({
          weekNumber: currentWeek,
          participations: activeNamed,
          payments: flatPayments,
          isSkipped: cycle.weeks.find((w) => w.weekNumber === currentWeek)?.isSkipped ?? false,
        }),
        // ————— The per-week drill-down (/admin/this-week's selector) —————
        // Every week the cycle actually has, so the dropdown offers exactly
        // what exists rather than counting to plannedWeeks (2.7: a cycle can
        // run long, and the week rows are the truth).
        selectableWeeks: cycle.weeks.map((w) => ({
          weekNumber: w.weekNumber,
          date: w.date,
        })),
        selectedWeek,
        selectedWeekTotals: series.find((w) => w.weekNumber === selectedWeek) ?? null,
        selectedWeekMembers: weekMemberStatus({
          weekNumber: selectedWeek,
          participations: activeNamed,
          payments: flatPayments,
          isSkipped: cycle.weeks.find((w) => w.weekNumber === selectedWeek)?.isSkipped ?? false,
        }),
      // 2.23: locked-out members surface HERE — the organizer must never
      // have to hunt for who is stuck. Derived from rows already loaded;
      // dropped entirely by the presentation-mode redaction (names).
      lockedMembers: active
        .filter((p) => p.person.pinLockedUntil !== null && p.person.pinLockedUntil > today)
        .map((p) => ({
          personId: p.person.id,
          name: `${p.person.nameAmharic} — ${p.person.nameEnglishFirst}`,
          minutesLeft: Math.max(
            1,
            Math.ceil((p.person.pinLockedUntil!.getTime() - today.getTime()) / 60_000),
          ),
        })),
      // 2.27: the undrawn-window safeguard belongs on the dashboard.
      undrawnWarnings: undrawnWindowWarnings({
        luckyNumbers,
        participations: activeNamed.map((p) => ({ ...p, status: "ACTIVE" as const })),
        drawnNumberIds: new Set(drawnMembers.map((m) => m.luckyNumberId)),
        currentWeek,
        weeksAhead: 3,
      }),
    };

    // Presentation mode (2.4/D-6): the redaction happens HERE, server-side —
    // names, money, and payout details are never sent to the browser.
    if (await getSetting("presentationMode")) {
      return { ok: true as const, data: redactDashboard(full) };
    }
    return { ok: true as const, data: full };
  } catch (e) {
    console.error("getDashboard failed:", e);
    return { ok: false as const, error: `Could not load the dashboard. ${errorMessage(e)}` };
  }
}

export type Dashboard = Extract<Awaited<ReturnType<typeof getDashboard>>, { ok: true }>["data"];
