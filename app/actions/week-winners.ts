"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { deleteDrawIfEmpty, freedWeekClause } from "@/lib/draw-cascade";
import { settleWinnerWeeks, unsettlePayout } from "@/lib/draw-settlement";
import { formatMoney } from "@/lib/format";
import { frozenCycleRefusal } from "@/lib/cycle-close";
import { prisma, serializableTransaction } from "@/lib/prisma";
import { calculatePayout } from "@/lib/wheel";
import {
  addWinnerRefusal,
  movePayoutRefusal,
  removeWinnerRefusal,
  type WeekWinners,
  type WinnerCandidate,
  type WinnerPayout,
} from "@/lib/week-winners";

// EDITING A WEEK'S WINNERS (2.23).
//
// Week 6 recorded Hana (#19) alone at $4,900 — she contributes $250/week and
// was clearly paired with someone. The structure already supported two
// payouts on a week (weeks 8 and 9 have them); only editing was missing, so
// the only "fix" was to undo the whole draw and redraw it.
//
// NO SECOND MONEY ROUTE. Every action here reuses the existing paths:
//   calculatePayout      the same arithmetic a spun draw uses
//   settleWinnerWeeks    the same settlement recordDraw runs
//   unsettlePayout       the same reversal undoDraw runs, scoped to one payout
//
// A WEEK'S WINNERS ARE ITS DRAW SLOT'S MEMBERS. `drawnNumberIds` is built from
// slot.members, and settleWinnerWeeks skips a payout whose number is not in
// slot.members. So the SlotMember and the Payout move TOGETHER, always —
// splitting them would create money nobody owes and a number that never
// leaves the wheel.

class WinnerEditError extends Error {}

const refuse = (message: string): never => {
  throw new WinnerEditError(message);
};

async function loadDrawContext(tx: Parameters<typeof settleWinnerWeeks>[0], weekId: string) {
  const week = await tx.week.findUniqueOrThrow({
    where: { id: weekId },
    include: {
      cycle: true,
      draws: {
        include: {
          slot: { include: { members: true } },
          payouts: {
            include: {
              luckyNumber: { include: { participation: { include: { person: true } } } },
            },
          },
        },
      },
    },
  });
  // At most one draw per week (Draw.@@unique([weekId])) — flatten it so
  // every caller reads  rather than repeating draws[0].
  return { ...week, draw: week.draws[0] ?? null };
}

/** Every number already drawn in this cycle — the 2.27 pool check. */
async function drawnNumberIds(
  tx: Parameters<typeof settleWinnerWeeks>[0],
  cycleId: string,
): Promise<Set<string>> {
  const draws = await tx.draw.findMany({
    where: { week: { cycleId } },
    include: { slot: { include: { members: { select: { luckyNumberId: true } } } } },
  });
  return new Set(draws.flatMap((d) => d.slot.members.map((m) => m.luckyNumberId)));
}

function toWeekWinners(
  week: Awaited<ReturnType<typeof loadDrawContext>>,
  planned = false,
): WeekWinners {
  return {
    weekId: week.id,
    weekNumber: week.weekNumber,
    undrawn: week.draw === null,
    isSkipped: week.isSkipped,
    planned,
    payouts: (week.draw?.payouts ?? []).map(
      (p): WinnerPayout => ({
        payoutId: p.id,
        luckyNumberId: p.luckyNumberId,
        number: p.luckyNumber.number,
        participationId: p.luckyNumber.participationId,
        memberName: p.luckyNumber.participation.person.nameEnglishFirst,
        gross: p.grossAmount,
        fee: p.feeAmount,
        net: p.netAmount,
        settlement: 0, // filled by the caller from the settlement events
        status: p.status,
      }),
    ),
  };
}

/**
 * ADD A WINNER to an existing week.
 *
 * The number joins the draw's slot (so it leaves the wheel pool) and gets its
 * own payout with its own gross/fee/net. Their own-week contribution then
 * settles from that payout, exactly as a spun draw would do it.
 */
export async function addWinnerToWeek(input: { weekId: string; luckyNumberId: string }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const data = await serializableTransaction(async (tx) => {
      const week = await loadDrawContext(tx, input.weekId);
      const frozen = frozenCycleRefusal(week.cycle);
      if (frozen) refuse(frozen);
      if (!week.draw) {
        refuse(
          `Week ${week.weekNumber} has no draw yet — spin it on the wheel, or use "Assign payout" ` +
            `on the member's page to record the first winner. More winners can be added here after that.`,
        );
      }

      const luckyNumber = await tx.luckyNumber.findUniqueOrThrow({
        where: { id: input.luckyNumberId },
        include: { participation: { include: { person: true } } },
      });
      if (luckyNumber.cycleId !== week.cycleId) refuse("That number belongs to another cycle.");

      const candidate: WinnerCandidate = {
        luckyNumberId: luckyNumber.id,
        number: luckyNumber.number,
        amount: luckyNumber.amount,
        participationId: luckyNumber.participationId,
        memberName: luckyNumber.participation.person.nameEnglishFirst,
        weeksCommitted: luckyNumber.participation.weeksCommitted,
        startWeek: luckyNumber.participation.startWeek,
        weeklyAmount: luckyNumber.participation.weeklyAmount,
      };
      const refusal = addWinnerRefusal({
        week: toWeekWinners(week),
        candidate,
        drawnNumberIds: await drawnNumberIds(tx, week.cycleId),
      });
      if (refusal) refuse(refusal);

      // The pair, together: the SlotMember makes the number DRAWN and makes
      // the settlement see this payout; the Payout is the money.
      await tx.slotMember.create({
        data: { slotId: week.draw!.slotId, luckyNumberId: luckyNumber.id },
      });
      const amounts = calculatePayout({
        luckyNumber: { id: luckyNumber.id, amount: luckyNumber.amount },
        participation: { weeksCommitted: luckyNumber.participation.weeksCommitted },
        cycle: { feePercent: week.cycle.feePercent },
      });
      const payout = await tx.payout.create({
        data: {
          luckyNumberId: luckyNumber.id,
          drawId: week.draw!.id,
          grossAmount: amounts.gross,
          feeAmount: amounts.fee,
          netAmount: amounts.net,
          status: "PENDING",
        },
      });

      // The SAME settlement recordDraw runs. It is safe to re-run: a week
      // already covered settles nothing further.
      const settlements = await settleWinnerWeeks(tx, week.draw!.id);
      const mine = settlements.find((s) => s.participationId === luckyNumber.participationId);

      const after = await tx.payout.findUniqueOrThrow({ where: { id: payout.id } });
      await logAudit(tx, {
        entity: "Draw",
        entityId: week.draw!.id,
        action: "update",
        summary:
          `Week ${week.weekNumber}: added #${luckyNumber.number} ` +
          `(${candidate.memberName}) as a winner — payout ${formatMoney(after.netAmount)} net` +
          (mine ? `, week ${week.weekNumber} contribution ${formatMoney(mine.settled)} settled from it` : "") +
          `. The number leaves the wheel pool.`,
        after: {
          payoutId: payout.id,
          number: luckyNumber.number,
          gross: amounts.gross,
          fee: amounts.fee,
          net: after.netAmount,
        },
      });

      return {
        weekNumber: week.weekNumber,
        number: luckyNumber.number,
        memberName: candidate.memberName,
        net: after.netAmount,
        settled: mine?.settled ?? 0,
      };
    });

    revalidateAll();
    return { ok: true as const, data };
  } catch (e) {
    if (e instanceof WinnerEditError) return { ok: false as const, error: e.message };
    console.error("addWinnerToWeek failed:", e);
    return { ok: false as const, error: `Could not add the winner. ${errorMessage(e)}` };
  }
}

/**
 * REMOVE ONE WINNER from a week — and RETURN THEIR NUMBER TO THE WHEEL.
 *
 * Distinct from deleting a payout, which keeps the number drawn. That
 * difference has already misled the organizer once, so it is stated in the
 * audit entry as well as in the confirmation.
 */
export async function removeWinnerFromWeek(input: { payoutId: string }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const data = await serializableTransaction(async (tx) => {
      const payout = await tx.payout.findUniqueOrThrow({
        where: { id: input.payoutId },
        include: {
          luckyNumber: { include: { participation: { include: { person: true } } } },
          draw: { include: { week: { include: { cycle: true } } } },
        },
      });
      if (!payout.draw) refuse("That payout is not attached to a draw.");
      const week = payout.draw!.week;
      const frozen = frozenCycleRefusal(week.cycle);
      if (frozen) refuse(frozen);

      const full = await loadDrawContext(tx, week.id);
      const refusal = removeWinnerRefusal({
        week: toWeekWinners(full),
        payout: {
          payoutId: payout.id,
          luckyNumberId: payout.luckyNumberId,
          number: payout.luckyNumber.number,
          participationId: payout.luckyNumber.participationId,
          memberName: payout.luckyNumber.participation.person.nameEnglishFirst,
          gross: payout.grossAmount,
          fee: payout.feeAmount,
          net: payout.netAmount,
          settlement: 0,
          status: payout.status,
        },
      });
      if (refusal) refuse(refusal);

      // Reverse THIS payout's settlement only — that week becomes owed again
      // for this member, and nobody else is touched.
      const { reversed } = await unsettlePayout(tx, payout.id);
      await tx.payout.delete({ where: { id: payout.id } });
      // The SlotMember is what makes the number drawn. Removing it is what
      // returns the number to the pool.
      await tx.slotMember.deleteMany({
        where: { slotId: payout.draw!.slotId, luckyNumberId: payout.luckyNumberId },
      });

      // THE CASCADE. If that was the week's LAST winner, the draw records a
      // win that holds nothing — it goes, and the week is undrawn again.
      const freed = await deleteDrawIfEmpty(tx, payout.draw!.id);

      await logAudit(tx, {
        entity: "Draw",
        entityId: payout.draw!.id,
        action: "update",
        summary:
          `Week ${week.weekNumber}: removed #${payout.luckyNumber.number} ` +
          `(${payout.luckyNumber.participation.person.nameEnglishFirst}) as a winner. ` +
          `Their payout of ${formatMoney(payout.netAmount)} is gone and ` +
          `#${payout.luckyNumber.number} RETURNS TO THE WHEEL POOL` +
          (reversed > 0
            ? `; their week-${week.weekNumber} contribution of ${formatMoney(reversed)} is owed again`
            : "") +
          (freed.deleted
            ? `.${freedWeekClause(freed, week.weekNumber)}`
            : `. The week's other winners are unchanged.`),
        before: {
          payoutId: payout.id,
          number: payout.luckyNumber.number,
          net: payout.netAmount,
          settlementReversed: reversed,
        },
      });

      return {
        weekNumber: week.weekNumber,
        number: payout.luckyNumber.number,
        memberName: payout.luckyNumber.participation.person.nameEnglishFirst,
        reversed,
        weekFreed: freed.deleted,
        numbersReturned: freed.numbersReturning,
      };
    });

    revalidateAll();
    return { ok: true as const, data };
  } catch (e) {
    if (e instanceof WinnerEditError) return { ok: false as const, error: e.message };
    console.error("removeWinnerFromWeek failed:", e);
    return { ok: false as const, error: `Could not remove the winner. ${errorMessage(e)}` };
  }
}

/**
 * MOVE ONE WINNER from week A to week B — for merging two people into the
 * week they actually shared, or for putting a winner on the week they
 * actually belong to.
 *
 * The settlement FOLLOWS the payout: week A becomes owed again and week B
 * settles, because the winner does not pay the week they win. Both draws are
 * re-settled through the same helper recordDraw uses.
 *
 * B MAY BE UNDRAWN. The organizer decides where a winner belongs (2.2), so a
 * destination with no draw is something to CREATE rather than a reason to
 * refuse: a fresh slot holds the moved number and a Draw is recorded on the
 * week, flagged assignedManually because it was a decision, not a spin — the
 * same shape assignPayoutManually builds, so there is no second money route.
 *
 * And if A is left with no winner at all, A's draw is deleted and A becomes
 * UNDRAWN and selectable again (lib/draw-cascade). Leaving it behind is what
 * stranded week 6.
 */
export async function movePayoutToWeek(input: { payoutId: string; targetWeekId: string }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const data = await serializableTransaction(async (tx) => {
      const payout = await tx.payout.findUniqueOrThrow({
        where: { id: input.payoutId },
        include: {
          luckyNumber: { include: { participation: { include: { person: true } } } },
          draw: { include: { week: { include: { cycle: true } } } },
        },
      });
      if (!payout.draw) refuse("That payout is not attached to a draw.");
      const fromWeek = await loadDrawContext(tx, payout.draw!.weekId);
      const toWeek = await loadDrawContext(tx, input.targetWeekId);

      for (const w of [fromWeek, toWeek]) {
        const frozen = frozenCycleRefusal(w.cycle);
        if (frozen) refuse(frozen);
      }
      if (fromWeek.cycleId !== toWeek.cycleId) refuse("Those weeks are in different cycles.");

      const winner: WinnerPayout = {
        payoutId: payout.id,
        luckyNumberId: payout.luckyNumberId,
        number: payout.luckyNumber.number,
        participationId: payout.luckyNumber.participationId,
        memberName: payout.luckyNumber.participation.person.nameEnglishFirst,
        gross: payout.grossAmount,
        fee: payout.feeAmount,
        net: payout.netAmount,
        settlement: 0,
        status: payout.status,
      };
      // A plan committed to the destination is the organizer's locked intent
      // (2.3) — read live, inside the transaction, never from the client.
      const targetPlanned =
        (await tx.winnerPlan.count({
          where: { cycleId: toWeek.cycleId, weekId: toWeek.id, status: "PLANNED" },
        })) > 0;
      const refusal = movePayoutRefusal({
        from: toWeekWinners(fromWeek),
        to: toWeekWinners(toWeek, targetPlanned),
        payout: winner,
      });
      if (refusal) refuse(refusal);

      // 1. Give the old week its contribution back.
      const { reversed } = await unsettlePayout(tx, payout.id);

      // 2. The destination needs a draw to join. An undrawn week gets one
      //    built here — a fresh slot (a slot wins at most once per cycle, so
      //    it can never be an existing one) and a Draw recorded as an
      //    organizer decision rather than a spin.
      let targetDraw = toWeek.draw;
      let createdDraw = false;
      if (!targetDraw) {
        const maxPosition =
          (await tx.slot.aggregate({ where: { cycleId: toWeek.cycleId }, _max: { position: true } }))
            ._max.position ?? 0;
        const slot = await tx.slot.create({
          data: { cycleId: toWeek.cycleId, position: maxPosition + 1 },
        });
        targetDraw = (await tx.draw.create({
          data: {
            weekId: toWeek.id,
            slotId: slot.id,
            assignedManually: true,
            notes: `Created by moving #${payout.luckyNumber.number} from week ${fromWeek.weekNumber}`,
          },
          include: {
            slot: { include: { members: true } },
            payouts: {
              include: {
                luckyNumber: { include: { participation: { include: { person: true } } } },
              },
            },
          },
        })) as typeof targetDraw;
        createdDraw = true;
      }

      // 3. Move the PAIR — payout and slot membership — to the new week.
      await tx.payout.update({
        where: { id: payout.id },
        // netAmount is restored to gross-minus-fee; the new week's settlement
        // decrements it again below.
        data: { drawId: targetDraw!.id, netAmount: payout.grossAmount - payout.feeAmount },
      });
      await tx.slotMember.deleteMany({
        where: { slotId: fromWeek.draw!.slotId, luckyNumberId: payout.luckyNumberId },
      });
      await tx.slotMember.create({
        data: { slotId: targetDraw!.slotId, luckyNumberId: payout.luckyNumberId },
      });
      // 4. Settle the new week from it.
      const settlements = await settleWinnerWeeks(tx, targetDraw!.id);
      const mine = settlements.find(
        (s) => s.participationId === payout.luckyNumber.participationId,
      );

      // 5. THE CASCADE. If that winner was week A's last, A's draw records a
      //    win holding nothing — it goes, and A is undrawn and selectable.
      const freed = await deleteDrawIfEmpty(tx, fromWeek.draw!.id);

      const after = await tx.payout.findUniqueOrThrow({ where: { id: payout.id } });
      await logAudit(tx, {
        entity: "Payout",
        entityId: payout.id,
        action: "update",
        summary:
          `#${payout.luckyNumber.number} (${winner.memberName}) moved from week ` +
          `${fromWeek.weekNumber} to week ${toWeek.weekNumber}. ` +
          (createdDraw
            ? `Week ${toWeek.weekNumber} had no draw, so one was created for it (assigned, not spun); `
            : "") +
          (reversed > 0
            ? `Week ${fromWeek.weekNumber}'s contribution of ${formatMoney(reversed)} is owed again; `
            : "") +
          (mine
            ? `week ${toWeek.weekNumber}'s contribution of ${formatMoney(mine.settled)} settles from the payout; `
            : "") +
          `payout now ${formatMoney(after.netAmount)} net. The number stays drawn throughout.` +
          freedWeekClause(freed, fromWeek.weekNumber),
        before: { weekNumber: fromWeek.weekNumber, net: payout.netAmount },
        after: { weekNumber: toWeek.weekNumber, net: after.netAmount, createdDraw },
      });

      return {
        number: payout.luckyNumber.number,
        memberName: winner.memberName,
        fromWeek: fromWeek.weekNumber,
        toWeek: toWeek.weekNumber,
        net: after.netAmount,
        createdDraw,
        weekFreed: freed.deleted,
        numbersReturned: freed.numbersReturning,
      };
    });

    revalidateAll();
    return { ok: true as const, data };
  } catch (e) {
    if (e instanceof WinnerEditError) return { ok: false as const, error: e.message };
    console.error("movePayoutToWeek failed:", e);
    return { ok: false as const, error: `Could not move the payout. ${errorMessage(e)}` };
  }
}

function revalidateAll() {
  revalidatePath("/admin/collections");
  revalidatePath("/admin/cycle/draws");
  revalidatePath("/admin/wheel");
  revalidatePath("/admin/wheel/setup");
  revalidatePath("/admin/payments");
  revalidatePath("/admin");
}

/** Candidates for "add a winner": every number still in the pool. */
export async function poolCandidates(input: { weekId: string }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const week = await prisma.week.findUniqueOrThrow({
      where: { id: input.weekId },
      include: { cycle: true },
    });
    const drawn = await drawnNumberIds(prisma, week.cycleId);
    const numbers = await prisma.luckyNumber.findMany({
      where: { cycleId: week.cycleId },
      include: { participation: { include: { person: true } } },
      orderBy: { number: "asc" },
    });

    const candidates: WinnerCandidate[] = numbers
      .filter((n) => !drawn.has(n.id) && n.participation.status === "ACTIVE")
      .map((n) => ({
        luckyNumberId: n.id,
        number: n.number,
        amount: n.amount,
        participationId: n.participationId,
        memberName: n.participation.person.nameEnglishFirst,
        weeksCommitted: n.participation.weeksCommitted,
        startWeek: n.participation.startWeek,
        weeklyAmount: n.participation.weeklyAmount,
      }));

    return { ok: true as const, data: { candidates, feePercent: week.cycle.feePercent } };
  } catch (e) {
    console.error("poolCandidates failed:", e);
    return { ok: false as const, error: `Could not load the pool. ${errorMessage(e)}` };
  }
}
