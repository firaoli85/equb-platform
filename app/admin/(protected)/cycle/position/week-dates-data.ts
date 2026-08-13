import { requireAdmin } from "@/lib/auth";
import { receiptsByWeek } from "@/lib/dashboard";
import { toIsoDay } from "@/lib/date-bounds";
import { elapsedThroughWeek } from "@/lib/commitment";
import { windowBreaks } from "@/lib/participation-close";
import { PRESENTATION_HIDDEN } from "@/lib/presentation";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";
import { membersAffectedByWeekDate, type WeekDateRow } from "./week-dates";

// THE WEEK ROWS THEMSELVES, for the section that shows and corrects them.
//
// Separate from `getCyclePosition` on purpose: that action answers "where does
// this cycle stand", and every figure it returns is derived. This answers
// "what days are stored", which is the opposite kind of fact — the one thing
// on this page that IS stored and therefore the one thing that can be wrong
// (rule 7).
//
// ONE DERIVATION, still. `membersShort` is not counted here: it comes from
// `receiptsByWeek`, the same pure function the dashboard and the position
// figures use, built from the same window rules (`windowBreaks`). A second
// count of who is short for a week would be a second answer to one question,
// and two answers is the same defect as none (§5.10).
//
// IT CARRIES ITS OWN GATE. Today the page only reaches this after
// `getCyclePosition` has already refused for a non-admin or for presentation
// mode (2.4 withholds this screen entirely). Relying on that is exactly the
// hand-applied guard §5.9 watched drift to 9 of 19 mutations, so the check is
// here where it cannot be left off by a future caller.

export type WeekDatesResult =
  | { ok: true; data: { weeks: WeekDateRow[]; todayIso: string } }
  | { ok: false; error: string };

export async function getWeekDates(): Promise<WeekDatesResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (await getSetting("presentationMode")) {
    return { ok: false, error: PRESENTATION_HIDDEN };
  }

  const cycle = await prisma.cycle.findFirst({
    where: { status: "ACTIVE" },
    select: {
      weeks: {
        orderBy: { weekNumber: "asc" },
        select: { id: true, weekNumber: true, date: true, isSkipped: true, notes: true },
      },
      participations: {
        select: {
          id: true,
          weeklyAmount: true,
          startWeek: true,
          weeksCommitted: true,
          status: true,
          closedAtWeek: true,
          breaks: { orderBy: { fromWeek: "asc" }, select: { fromWeek: true, toWeek: true } },
          payments: {
            select: {
              amountPaid: true,
              isDeferred: true,
              markedLateAt: true,
              week: { select: { weekNumber: true, isSkipped: true } },
            },
          },
        },
      },
    },
  });
  if (!cycle) return { ok: false, error: "No active cycle." };

  const today = new Date();

  // The stretches a member was away (2.18), with the derived fallback for rows
  // written before the breaks table existed. Identical to the position
  // action's, because it must be: a week's "members short" here and the
  // shortfall there are the same members.
  const breaksOf = (p: (typeof cycle.participations)[number]) => {
    const paid = p.payments.filter((pm) => pm.amountPaid > 0).map((pm) => pm.week.weekNumber);
    return windowBreaks({
      status: p.status,
      startWeek: p.startWeek,
      closedAtWeek: p.closedAtWeek,
      lastWeekWithMoney: paid.length > 0 ? Math.max(...paid) : null,
      breaks: p.breaks,
    });
  };

  // ONE SHAPE OF THE ROWS, read by both counts below. Built once so the two
  // questions are asked of identical data — a second mapping here would be a
  // second place for them to drift apart, which is the whole risk of having
  // two counts at all.
  const dashboardParticipations = cycle.participations.map((p) => ({
    id: p.id,
    weeklyAmount: p.weeklyAmount,
    startWeek: p.startWeek,
    weeksCommitted: p.weeksCommitted,
    breaks: breaksOf(p),
  }));
  const dashboardPayments = cycle.participations.flatMap((p) =>
    p.payments.map((pm) => ({
      participationId: p.id,
      weekNumber: pm.week.weekNumber,
      amountPaid: pm.amountPaid,
      isDeferred: pm.isDeferred,
      markedLate: pm.markedLateAt != null,
      isSkipped: pm.week.isSkipped,
    })),
  );

  const series = receiptsByWeek({
    weeks: cycle.weeks.map((w) => ({ weekNumber: w.weekNumber, isSkipped: w.isSkipped })),
    participations: dashboardParticipations,
    payments: dashboardPayments,
    // From the stored rows, never projected off the editable start date.
    elapsedThroughWeek: elapsedThroughWeek(cycle.weeks, today),
  });
  const byWeek = new Map(series.map((w) => [w.weekNumber, w]));

  // WHOSE STANDING THE DATE ACTUALLY DECIDES — a DIFFERENT question from
  // "who is short", and answered by its own pure function so the difference
  // can be asserted rather than merely commented. See the note on
  // `membersAffectedByWeekDate`; `week-dates.test.ts` runs both over one
  // fixture and requires them to differ.
  //
  // Both are fed the SAME rows that go to `receiptsByWeek` above, so there is
  // no second shape of the data either.
  const affectedByWeek = new Map(
    cycle.weeks.map((w) => [
      w.weekNumber,
      membersAffectedByWeekDate({
        weekNumber: w.weekNumber,
        isSkipped: w.isSkipped,
        participations: dashboardParticipations,
        payments: dashboardPayments,
      }),
    ]),
  );

  return {
    ok: true,
    data: {
      weeks: cycle.weeks.map((w): WeekDateRow => {
        const receipts = byWeek.get(w.weekNumber);
        return {
          id: w.id,
          weekNumber: w.weekNumber,
          date: toIsoDay(w.date),
          notes: w.notes,
          membersExpected: receipts?.membersExpected ?? 0,
          membersShort: receipts
            ? Math.max(0, receipts.membersExpected - receipts.membersPaid)
            : 0,
          membersAffectedByDate: affectedByWeek.get(w.weekNumber) ?? 0,
        };
      }),
      // UTC day, because `weekHasElapsed` takes the UTC day of whatever Date
      // it is handed. Sending the local calendar day instead would put the
      // panel's clock several hours out of step with the arithmetic it is
      // describing, for part of every day.
      todayIso: toIsoDay(today),
    },
  };
}
