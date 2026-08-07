import Link from "next/link";
import { PresentationHidden } from "@/components/presentation-hidden";
import { StatCard } from "@/components/ui/stat-card";
import { SETTLEMENT_EVENT_WHERE } from "@/lib/draw-settlement";
import { calculateFinishWeek, currentWeekNumber } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";
import { computeStanding, pinnedMapFromEvents } from "@/lib/standing";
import { undoDrawConsequences } from "@/lib/undo-draw";
import { CollectionsView, type WeekGroup } from "./collections-view";

export const dynamic = "force-dynamic";

// COLLECTIONS — winners collecting their payouts (money going OUT).
// READ-FIRST (2.25): clean rows, one obvious action per state. Recording
// money coming in lives at /admin/payments. If a winner owes money, the
// deduction is OFFERED and never automatic (2.18 / D-23). Every destructive
// consequence below is COMPUTED from the actual records (2.23).
export default async function CollectionsPage() {
  // Payouts are names and money (2.4) — nothing is loaded, nothing is sent.
  if (await getSetting("presentationMode")) return <PresentationHidden what="Collections" />;
  // Weeks carry their OWN live state — draws (even empty ones) and planned
  // winners. Groups are built from the DRAWS below, never from the payout
  // list: a draw holding no payouts produced no group at all, which is how
  // weeks 1 and 6 became invisible here while every picker still called them
  // "already drawn".
  const cycle = await prisma.cycle.findFirst({
    where: { status: "ACTIVE" },
    include: {
      weeks: {
        orderBy: { weekNumber: "asc" },
        include: {
          draws: {
            select: {
              id: true,
              assignedManually: true,
              slot: { select: { members: { select: { luckyNumber: { select: { number: true } } } } } },
              payouts: { select: { id: true, netAmount: true } },
            },
          },
          winnerPlans: { where: { status: "PLANNED" }, select: { id: true } },
        },
      },
    },
  });
  const payouts = await prisma.payout.findMany({
    where: { luckyNumber: { cycle: { status: "ACTIVE" } } },
    include: {
      luckyNumber: {
        include: { participation: { include: { person: true, payments: true } } },
      },
      draw: {
        include: {
          week: true,
          slot: { include: { members: { include: { luckyNumber: true } } } },
        },
      },
    },
    orderBy: [{ id: "asc" }],
  });

  // Week contributions settled from each payout. Identified by the PINNED
  // column and attributed through the payout FK (audit C6) — never by
  // parsing the client-supplied idempotency key.
  const settlementEvents = await prisma.paymentEvent.findMany({
    where: SETTLEMENT_EVENT_WHERE,
    select: {
      settlementPayoutId: true,
      amount: true,
      participationId: true,
      pinnedWeek: { select: { weekNumber: true } },
    },
  });
  const settlementByPayout = new Map<string, number>();
  const pinnedByParticipation = new Map<string, { amount: number; weekNumber: number | null }[]>();
  for (const event of settlementEvents) {
    if (event.settlementPayoutId) {
      settlementByPayout.set(
        event.settlementPayoutId,
        (settlementByPayout.get(event.settlementPayoutId) ?? 0) + event.amount,
      );
    }
    const list = pinnedByParticipation.get(event.participationId) ?? [];
    list.push({ amount: event.amount, weekNumber: event.pinnedWeek?.weekNumber ?? null });
    pinnedByParticipation.set(event.participationId, list);
  }

  // The winner's outstanding balance, derived fresh (2.14) — for the OFFER.
  const today = new Date();
  const cycleWeek = cycle ? currentWeekNumber(cycle.startDate, today) : 0;
  const outstandingFor = new Map<string, number>();
  if (cycle) {
    for (const p of payouts) {
      const participation = p.luckyNumber.participation;
      if (outstandingFor.has(participation.id)) continue;
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
            const payment = participation.payments.find((pm) => pm.weekId === w.id) ?? null;
            return {
              weekNumber: w.weekNumber,
              date: w.date,
              amountDue: participation.weeklyAmount,
              storedPaid: payment?.amountPaid ?? 0,
              isDeferred: payment?.isDeferred ?? false,
              isSkipped: w.isSkipped,
            };
          }),
        totalPaid: participation.payments.reduce((sum, pm) => sum + pm.amountPaid, 0),
        pinnedByWeek: pinnedMapFromEvents(pinnedByParticipation.get(participation.id) ?? []),
      });
      outstandingFor.set(participation.id, standing.amountOutstanding);
    }
  }

  // Group by DRAW, newest week first. Every draw of the cycle gets a group —
  // including one holding no payouts, so a half-state week is visible and can
  // be undone from here instead of being silently missing. Payouts without a
  // linked draw go last.
  const groupByDraw = new Map<string, typeof payouts>();
  for (const week of cycle?.weeks ?? []) {
    for (const draw of week.draws) groupByDraw.set(draw.id, []);
  }
  const unlinked: typeof payouts = [];
  for (const p of payouts) {
    if (p.draw) {
      const list = groupByDraw.get(p.draw.id) ?? [];
      list.push(p);
      groupByDraw.set(p.draw.id, list);
    } else unlinked.push(p);
  }
  const drawContext = new Map(
    (cycle?.weeks ?? []).flatMap((w) =>
      w.draws.map((d) => [d.id, { week: w, draw: d }] as const),
    ),
  );

  const toRow = (p: (typeof payouts)[number]) => ({
    id: p.id,
    number: p.luckyNumber.number,
    who: p.luckyNumber.participation.person.nameEnglishFirst,
    whoAmharic: p.luckyNumber.participation.person.nameAmharic,
    grossAmount: p.grossAmount,
    feeAmount: p.feeAmount,
    netAmount: p.netAmount,
    settlementAmount: settlementByPayout.get(p.id) ?? 0,
    status: p.status,
    method: p.method,
    paidAt: p.paidAt?.toISOString().slice(0, 10) ?? null,
    notes: p.notes,
    outstanding: outstandingFor.get(p.luckyNumber.participationId) ?? 0,
  });

  const groups: WeekGroup[] = [...groupByDraw.entries()]
    .map(([drawId, list]) => {
      // The week/draw come from the CYCLE's own rows, so a draw with zero
      // payouts still produces a group (list[0] does not exist for it).
      const context = drawContext.get(drawId)!;
      const week = context.week;
      const slotNumbers = context.draw.slot.members.map((m) => m.luckyNumber.number);
      return {
        drawId,
        weekId: week.id,
        weekNumber: week.weekNumber,
        weekDate: week.date.toISOString(),
        isSkipped: week.isSkipped,
        assignedManually: context.draw.assignedManually,
        payouts: list.map(toRow),
        undo: undoDrawConsequences({
          weekNumber: week.weekNumber,
          slotNumbers,
          payouts: list.map((p) => ({
            payoutId: p.id,
            number: p.luckyNumber.number,
            netAmount: p.netAmount,
            status: p.status,
            settlementAmount: settlementByPayout.get(p.id) ?? 0,
          })),
        }),
      };
    })
    .sort((a, b) => (b.weekNumber ?? 0) - (a.weekNumber ?? 0));
  if (unlinked.length > 0) {
    groups.push({
      drawId: null,
      weekId: null,
      weekNumber: null,
      weekDate: null,
      isSkipped: false,
      assignedManually: false,
      payouts: unlinked.map(toRow),
      undo: null,
    });
  }

  // EVERY week of the cycle, with its live state — the single source the move
  // picker builds from. Previously the picker was derived from the payout
  // groups above, so a free week was never offered and a week the organizer
  // had just emptied stayed listed as a destination.
  const weekOptions = (cycle?.weeks ?? []).map((w) => {
    const draw = w.draws[0] ?? null;
    return {
      weekId: w.id,
      weekNumber: w.weekNumber,
      hasDraw: draw !== null,
      isSkipped: w.isSkipped,
      planned: w.winnerPlans.length > 0,
      payoutCount: draw?.payouts.length ?? 0,
      totalNet: draw?.payouts.reduce((s, p) => s + p.netAmount, 0) ?? 0,
    };
  });

  const collected = payouts.filter((p) => p.status === "COLLECTED");
  const pending = payouts.filter((p) => p.status === "PENDING");
  const collectedTotal = collected.reduce((sum, p) => sum + p.netAmount, 0);
  const pendingTotal = pending.reduce((sum, p) => sum + p.netAmount, 0);

  return (
    <main className="space-y-6">
      <header className="animate-fade-in-up">
        <p className="mb-1 text-sm">
          <Link href="/admin/cycle" className="text-gray-600 dark:text-gray-400 hover:underline">
            ← Cycle
          </Link>
        </p>
        <h1 className="text-2xl font-black text-gray-900 dark:text-white">Collections</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Winners collecting their payouts — money going out. The winner does not pay the week
          they win: that contribution is already settled from the payout.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 animate-fade-in-up-1">
        <StatCard
          label="Collected"
          cents={collectedTotal}
          sub={`${collected.length} payout${collected.length === 1 ? "" : "s"} handed over`}
        />
        <StatCard
          label="Still owed"
          cents={pendingTotal}
          sub={
            pending.length === 0
              ? "nobody is waiting to be paid"
              : `${pending.length} payout${pending.length === 1 ? "" : "s"} drawn and waiting`
          }
          href="/admin/waiting"
          emphasis={pendingTotal > 0}
          delayClass="animate-fade-in-up-1"
        />
        <StatCard
          label="Gone out in total"
          cents={collectedTotal + pendingTotal}
          sub="collected plus committed — what this cycle owes its winners"
          delayClass="animate-fade-in-up-2"
        />
      </div>

      <div className="animate-fade-in-up-2">
        <CollectionsView groups={groups} weeks={weekOptions} cycleName={cycle?.name ?? ""} />
      </div>
    </main>
  );
}
