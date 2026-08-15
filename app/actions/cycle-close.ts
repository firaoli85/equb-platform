"use server";

// The September 27 flow (2.9): review everything unfinished → close in ONE
// transaction (ledger debts on people, 2.18) → the readable archive → the
// clean delete that never touches people, ledgers, or the archive.

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import {
  buildArchiveData,
  closeBlockers,
  cycleDeletePlan,
  finalBalanceEntries,
  type ArchiveData,
  type ArchiveWeek,
  type MemberFinal,
} from "@/lib/cycle-close";
import { closeTiming } from "@/lib/cycle-lock";
import { formatDateLongUTC, formatMoney } from "@/lib/format";
import { Prisma } from "@/lib/generated/prisma/client";
import { calculateFinishWeek, currentWeekNumber } from "@/lib/money";
import { PRESENTATION_HIDDEN } from "@/lib/presentation";
import { prisma, serializableTransaction } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";
import { computeStanding, pinnedMapFromEvents } from "@/lib/standing";

// ————————————————— Shared derivation —————————————————

async function loadCycleForClose(db: Prisma.TransactionClient | typeof prisma, cycleId?: string) {
  return db.cycle.findFirst({
    where: cycleId ? { id: cycleId } : { status: "ACTIVE" },
    include: {
      weeks: { orderBy: { weekNumber: "asc" }, include: { draws: true } },
      participations: {
        include: {
          person: true,
          payments: true,
          paymentEvents: { select: { amount: true, pinnedWeekId: true } },
          luckyNumbers: {
            include: {
              payouts: true,
              slotMembers: { include: { slot: { include: { draws: { include: { week: true } } } } } },
            },
          },
        },
      },
    },
  });
}

type LoadedCycle = NonNullable<Awaited<ReturnType<typeof loadCycleForClose>>>;

/** Every member's final position, derived the same way the rest of the app derives it. */
function memberFinals(cycle: LoadedCycle, today: Date): MemberFinal[] {
  const cycleWeek = currentWeekNumber(cycle.startDate, today);
  const weekNumberById = new Map(cycle.weeks.map((w) => [w.id, w.weekNumber]));

  return cycle.participations.map((p) => {
    const finishWeek = calculateFinishWeek(p.startWeek, p.weeksCommitted);
    const pinnedEvents = p.paymentEvents.filter((e) => e.pinnedWeekId !== null);
    const standing = computeStanding({
      weeklyAmount: p.weeklyAmount,
      startWeek: p.startWeek,
      weeksCommitted: p.weeksCommitted,
      cycleWeek,
      today,
      windowWeeks: cycle.weeks
        .filter((w) => w.weekNumber >= p.startWeek && w.weekNumber <= finishWeek)
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
        pinnedEvents.map((e) => ({
          amount: e.amount,
          weekNumber: e.pinnedWeekId ? (weekNumberById.get(e.pinnedWeekId) ?? null) : null,
        })),
      ),
    });

    const draw = p.luckyNumbers
      .flatMap((n) => n.slotMembers.flatMap((sm) => sm.slot.draws))
      .sort((a, b) => a.week.weekNumber - b.week.weekNumber)[0];
    // A settlement is a PINNED receipt (audit C6) — never one whose
    // client-supplied key merely looks like the engine's.
    const settledFromPayout = pinnedEvents.reduce((sum, e) => sum + e.amount, 0);

    return {
      participationId: p.id,
      personId: p.personId,
      name: p.person.nameEnglishFirst,
      nameAmharic: p.person.nameAmharic,
      weeklyAmount: p.weeklyAmount,
      weeksCommitted: p.weeksCommitted,
      weeksPaid: Math.min(standing.weeksCredited, p.weeksCommitted),
      // CLOSE IS WHERE A DEFERRED WEEK RESOLVES (D-42 / §2.29a, §3.5).
      //
      // `amountOutstanding` stops at what is owed RIGHT NOW, and a paused week
      // is deliberately not in it. At close that pause ends: the money either
      // was paid or carries into the person's balance, so the closing figure
      // has to be BOTH halves. Writing only the first would forgive every
      // deferred week the moment the cycle closed — the one thing §2.29a says
      // deferral never does.
      outstanding: standing.amountOutstanding + standing.amountDeferred,
      lastPaymentWeek: standing.lastPaymentWeek,
      drawnWeek: draw?.week.weekNumber ?? null,
      // COLLECTED only — this is money that actually left the group. A
      // PENDING payout has been awarded and not handed over, so it is still
      // held; folding it in here inflated the archive's "paid out" and
      // understated "still held" by the same figure, permanently.
      receivedNet: p.luckyNumbers.reduce(
        (sum, n) =>
          sum +
          n.payouts
            .filter((po) => po.status === "COLLECTED")
            .reduce((s, po) => s + po.netAmount, 0),
        0,
      ),
      awardedNet: p.luckyNumbers.reduce(
        (sum, n) => sum + n.payouts.reduce((s, po) => s + po.netAmount, 0),
        0,
      ),
      pendingNet: p.luckyNumbers.reduce(
        (sum, n) =>
          sum +
          n.payouts
            .filter((po) => po.status !== "COLLECTED")
            .reduce((s, po) => s + po.netAmount, 0),
        0,
      ),
      settledFromPayout,
      totalPaid: standing.totalPaid,
    };
  });
}

function archiveWeeks(cycle: LoadedCycle): ArchiveWeek[] {
  const byNumber = new Map<number, { who: string; number: number }[]>();
  const payoutRows = new Map<
    number,
    { number: number; who: string; net: number; status: string; paidAt: string | null }[]
  >();
  for (const p of cycle.participations) {
    for (const n of p.luckyNumbers) {
      for (const sm of n.slotMembers) {
        for (const d of sm.slot.draws) {
          const list = byNumber.get(d.week.weekNumber) ?? [];
          list.push({ who: p.person.nameEnglishFirst, number: n.number });
          byNumber.set(d.week.weekNumber, list);
        }
      }
      for (const po of n.payouts) {
        const weekNumber = po.drawId
          ? (cycle.weeks.find((w) => w.draws.some((d) => d.id === po.drawId))?.weekNumber ?? 0)
          : 0;
        const list = payoutRows.get(weekNumber) ?? [];
        list.push({
          number: n.number,
          who: p.person.nameEnglishFirst,
          net: po.netAmount,
          status: po.status,
          paidAt: po.paidAt?.toISOString().slice(0, 10) ?? null,
        });
        payoutRows.set(weekNumber, list);
      }
    }
  }

  return cycle.weeks.map((w) => {
    const drawn = byNumber.get(w.weekNumber);
    return {
      weekNumber: w.weekNumber,
      date: w.date.toISOString().slice(0, 10),
      isSkipped: w.isSkipped,
      received: cycle.participations.reduce(
        (sum, p) => sum + (p.payments.find((pm) => pm.weekId === w.id)?.amountPaid ?? 0),
        0,
      ),
      draw: drawn
        ? {
            numbers: drawn.map((d) => d.number).sort((a, b) => a - b),
            winners: [...new Set(drawn.map((d) => d.who))],
            payouts: payoutRows.get(w.weekNumber) ?? [],
          }
        : null,
    };
  });
}

/**
 * How long since this cycle's final week, against the configured wait.
 *
 * The final week is the LAST STORED WEEK ROW — the day that actually happened
 * — with the projection off the start date used only when a cycle somehow has
 * no week rows at all. Shared by the review (which explains the wait) and the
 * close itself (which enforces it), so the two can never disagree.
 */
async function cycleCloseTiming(cycle: LoadedCycle, today: Date) {
  const waitDays = await getSetting("closingWaitDays");
  const finalWeek = cycle.weeks[cycle.weeks.length - 1] ?? null;
  const finalWeekDate =
    finalWeek?.date ??
    new Date(cycle.startDate.getTime() + (cycle.plannedWeeks - 1) * 7 * 86_400_000);
  return closeTiming({
    finalWeekDate,
    today,
    waitDays,
    finalWeekLabel: formatDateLongUTC(finalWeekDate),
    cycleNameForReason: cycle.name,
  });
}

// ————————————————— STEP 1: the pre-close review —————————————————

export async function getCloseReview() {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    // The review is every member's money by name (2.4).
    if (await getSetting("presentationMode")) {
      return { ok: false as const, error: PRESENTATION_HIDDEN };
    }
    const cycle = await loadCycleForClose(prisma);
    if (!cycle || cycle.status !== "ACTIVE") {
      return { ok: false as const, error: "No active cycle to close." };
    }

    const today = new Date();

    // 2.6 / 2.9 — HOW LONG SINCE THE LAST WEEK. Measured from the final
    // week's own STORED date, because a cycle that ran long finishes when its
    // last week actually happened, not when a projection off the start date
    // says it should have (2.14, 2.7).
    const timing = await cycleCloseTiming(cycle, today);

    const finals = memberFinals(cycle, today);
    const undrawn = finals
      .filter((m) => m.drawnWeek === null)
      .map((m) => ({
        name: m.name,
        numbers: cycle.participations
          .find((p) => p.id === m.participationId)!
          .luckyNumbers.map((n) => n.number)
          .sort((a, b) => a - b),
      }));
    const pendingPayouts = cycle.participations.flatMap((p) =>
      p.luckyNumbers.flatMap((n) =>
        n.payouts
          .filter((po) => po.status === "PENDING")
          .map((po) => ({ number: n.number, who: p.person.nameEnglishFirst, net: po.netAmount })),
      ),
    );
    const openWeeks = cycle.weeks
      .filter((w) => !w.isSkipped && w.draws.length === 0)
      .map((w) => w.weekNumber);

    const received = finals.reduce((sum, m) => sum + m.totalPaid, 0);
    const paidOut = cycle.participations.reduce(
      (sum, p) =>
        sum +
        p.luckyNumbers.reduce(
          (s, n) =>
            s + n.payouts.filter((po) => po.status === "COLLECTED").reduce((x, po) => x + po.netAmount, 0),
          0,
        ),
      0,
    );

    // Closing statements ride the messaging engine (2.20/2.21) and must go
    // out BEFORE the status flips — count who has one already.
    const statementsSent = await prisma.messageLog.count({
      where: {
        templateKey: "CYCLE_CLOSING_STATEMENT",
        status: "SENT",
        createdAt: { gte: cycle.startDate },
        personId: { in: cycle.participations.map((p) => p.personId) },
      },
    });

    return {
      ok: true as const,
      data: {
        cycleId: cycle.id,
        cycleName: cycle.name,
        plannedWeeks: cycle.plannedWeeks,
        members: finals,
        undrawn,
        pendingPayouts,
        openWeeks,
        cash: { received, paidOut, stillHeld: received - paidOut },
        totalOutstanding: finals.reduce((sum, m) => sum + m.outstanding, 0),
        membersShort: finals.filter((m) => m.outstanding > 0).length,
        statementsSent,
        memberCount: finals.length,
        timing: {
          state: timing.state,
          reason: timing.reason,
          daysRemaining: timing.state === "too-soon" ? timing.daysRemaining : 0,
          availableOn:
            timing.state === "too-soon" ? timing.availableOn.toISOString().slice(0, 10) : null,
        },
      },
    };
  } catch (e) {
    console.error("getCloseReview failed:", e);
    return { ok: false as const, error: `Could not build the review. ${errorMessage(e)}` };
  }
}

// ————————————————— STEP 2: the close —————————————————

export async function closeCycle(input: { cycleId: string; typedName: string; acknowledgeUndrawn?: string }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    if (await getSetting("presentationMode")) {
      return { ok: false as const, error: PRESENTATION_HIDDEN };
    }
    const outcome = await serializableTransaction(async (tx) => {
      const cycle = await loadCycleForClose(tx, input.cycleId);
      if (!cycle) return { error: "Cycle not found." };
      if (cycle.status !== "ACTIVE") return { error: "Only an ACTIVE cycle can be closed." };
      if (input.typedName.trim() !== cycle.name) {
        return { error: `Type the cycle name exactly (“${cycle.name}”) to close it.` };
      }

      const now = new Date();

      // THE WAIT IS A RULE, NOT A DISABLED BUTTON. Re-checked here, inside
      // the transaction, so it holds for any caller — and it names the day
      // rather than just refusing.
      const timing = await cycleCloseTiming(cycle, now);
      if (timing.state === "too-soon") return { error: timing.reason };

      const finals = memberFinals(cycle, now);

      // 2.27 backstop — re-checked inside the transaction, not just the UI.
      const undrawn = finals
        .filter((m) => m.drawnWeek === null)
        .map((m) => ({ name: m.name, numbers: [] as number[] }));
      const blockCheck = closeBlockers({ undrawn, acknowledgeReason: input.acknowledgeUndrawn });
      if (blockCheck.blocked) return { error: blockCheck.reasons[0] };

      // 2.18 — the short land on the PERSON, with the story written out.
      const debts = finalBalanceEntries(finals, cycle.name);
      for (const d of debts) {
        await tx.ledgerEntry.create({
          data: { personId: d.personId, type: "DEBT", amount: d.amount, description: d.description },
        });
      }

      // 2.9 — the readable record, frozen at close.
      const archive: ArchiveData = buildArchiveData({
        cycleName: cycle.name,
        startDate: cycle.startDate.toISOString().slice(0, 10),
        closedAt: now.toISOString(),
        plannedWeeks: cycle.plannedWeeks,
        feePercent: cycle.feePercent,
        members: finals,
        weeks: archiveWeeks(cycle),
      });
      await tx.cycleArchive.create({
        data: {
          cycleId: cycle.id,
          cycleName: cycle.name,
          closedAt: now,
          data: JSON.stringify(archive),
        },
      });

      await tx.cycle.update({
        where: { id: cycle.id },
        data: { status: "CLOSED", closedAt: now },
      });

      await logAudit(tx, {
        entity: "Cycle",
        entityId: cycle.id,
        action: "update",
        summary:
          `Cycle "${cycle.name}" CLOSED: ${finals.length} members, ` +
          `${debts.length} carried debt${debts.length === 1 ? "" : "s"} written (${formatMoney(debts.reduce((s, d) => s + d.amount, 0))} total)` +
          (input.acknowledgeUndrawn?.trim()
            ? `; ${undrawn.length} undrawn member(s) acknowledged: "${input.acknowledgeUndrawn.trim()}"`
            : "") +
          `; archive written`,
      });
      return { closed: true as const, debts: debts.length };
    });
    if ("error" in outcome && outcome.error) return { ok: false as const, error: outcome.error };

    revalidatePath("/admin/cycle");
    revalidatePath("/admin/cycle/close");
    revalidatePath("/admin");
    return { ok: true as const, data: { debts: (outcome as { debts: number }).debts } };
  } catch (e) {
    console.error("closeCycle failed:", e);
    return { ok: false as const, error: `Could not close the cycle. ${errorMessage(e)}` };
  }
}

// ————————————————— STEP 5: the clean delete —————————————————

export async function getDeleteReview(cycleId: string) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    if (await getSetting("presentationMode")) {
      return { ok: false as const, error: PRESENTATION_HIDDEN };
    }
    const cycle = await prisma.cycle.findUnique({
      where: { id: cycleId },
      include: {
        _count: {
          select: { participations: true, weeks: true, slots: true, winnerPlans: true, luckyNumbers: true },
        },
      },
    });
    if (!cycle) return { ok: false as const, error: "Cycle not found." };
    const archive = await prisma.cycleArchive.findUnique({ where: { cycleId } });
    const receipts = await prisma.paymentEvent.count({
      where: { participation: { cycleId } },
    });
    const draws = await prisma.draw.count({ where: { week: { cycleId } } });
    const payouts = await prisma.payout.count({ where: { luckyNumber: { cycleId } } });

    return {
      ok: true as const,
      data: {
        cycleName: cycle.name,
        status: cycle.status,
        archived: archive !== null,
        plan: cycleDeletePlan({
          participations: cycle._count.participations,
          weeks: cycle._count.weeks,
          receipts,
          draws,
          payouts,
          luckyNumbers: cycle._count.luckyNumbers,
          slots: cycle._count.slots,
          plans: cycle._count.winnerPlans,
        }),
      },
    };
  } catch (e) {
    console.error("getDeleteReview failed:", e);
    return { ok: false as const, error: `Could not build the delete review. ${errorMessage(e)}` };
  }
}

export async function deleteClosedCycle(input: { cycleId: string; typedName: string }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    if (await getSetting("presentationMode")) {
      return { ok: false as const, error: PRESENTATION_HIDDEN };
    }
    const outcome = await serializableTransaction(async (tx) => {
      const cycle = await tx.cycle.findUnique({
        where: { id: input.cycleId },
        include: { _count: { select: { participations: true, weeks: true } } },
      });
      if (!cycle) return { error: "Cycle not found." };
      if (cycle.status !== "CLOSED") {
        return { error: "Only a CLOSED cycle can be deleted — close it first (2.9)." };
      }
      const archive = await tx.cycleArchive.findUnique({ where: { cycleId: input.cycleId } });
      if (!archive) {
        return { error: "This cycle has no archive — closing writes one; do not delete without it (2.9)." };
      }
      if (input.typedName.trim() !== cycle.name) {
        return { error: `Type the cycle name exactly (“${cycle.name}”) to delete it.` };
      }

      // Audit FIRST — the entry outlives the rows it describes.
      await logAudit(tx, {
        entity: "Cycle",
        entityId: cycle.id,
        action: "delete",
        summary:
          `Cycle "${cycle.name}" DELETED after archiving: ${cycle._count.participations} participations and ` +
          `${cycle._count.weeks} weeks wiped. People, carried ledgers, the archive, and this log are untouched (2.9).`,
      });
      // One delete — participations, weeks, slots, plans, lucky numbers,
      // payments, receipts, draws, and payouts all cascade from the cycle.
      // People, ledger entries, message logs, and the archive have no
      // cascading relation to it, by design.
      await tx.cycle.delete({ where: { id: cycle.id } });
      // The per-cycle numbering choice is a Setting row keyed by cycle id
      // (createCycle writes it). Setting has no relation to Cycle, so nothing
      // cascades it away — deleted here or it outlives the cycle forever.
      await tx.setting.deleteMany({ where: { key: `numberingMode:${cycle.id}` } });
      return { deleted: true as const, name: cycle.name };
    });
    if ("error" in outcome && outcome.error) return { ok: false as const, error: outcome.error };

    revalidatePath("/admin");
    revalidatePath("/admin/cycle");
    revalidatePath("/admin/cycle/close");
    return { ok: true as const, data: { name: (outcome as { name: string }).name } };
  } catch (e) {
    console.error("deleteClosedCycle failed:", e);
    return { ok: false as const, error: `Could not delete the cycle. ${errorMessage(e)}` };
  }
}
