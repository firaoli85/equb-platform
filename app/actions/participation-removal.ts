"use server";

import { reverseCarryDeduction } from "@/lib/carry-reversal";
import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { frozenCycleRefusal } from "@/lib/cycle-close";
import { deleteDrawIfEmpty, purgeEmptyWinnerPlans } from "@/lib/draw-cascade";
import { unsettlePayout } from "@/lib/draw-settlement";
import { formatMoney } from "@/lib/format";
import { nameConfirmed } from "@/lib/settlement";
import { prisma, serializableTransaction } from "@/lib/prisma";
import {
  feeAttributable,
  removalConsequences,
  removalRefusal,
  type ParticipationAttachments,
  type RemovalChoice,
} from "@/lib/participation-removal";

// REMOVING SOMEONE FROM A CYCLE (2.23) — with everything attached computed
// first, and the orphans swept after.
//
// The previous action was a bare `participation.delete()`. A schema dependency
// map found it left four things behind, each of which breaks something:
//
//   DRAW        survives with an empty slot; the week stays permanently marked
//               drawn and can never be redrawn.
//   SLOT        survives with zero members, permanently holding its position
//               (saveSlots refuses to delete a slot that has a Draw).
//   WINNER PLAN survives with zero numbers — and `[].every()` is VACUOUSLY
//               TRUE, so it matches the first eligible slot and silently rigs
//               the next draw, audited as an intentional "planned" win.
//   PAYOUT      is cascade-deleted with no settlement reversal, so money that
//               actually left the group vanishes with no audit entry.
//
// Both cascades below run in ONE serializable transaction with ONE audit entry
// naming the choice and every consequence.

class RemovalError extends Error {}
const refuse = (m: string): never => {
  throw new RemovalError(m);
};

async function loadAttachments(
  tx: Parameters<typeof unsettlePayout>[0],
  participationId: string,
) {
  const p = await tx.participation.findUniqueOrThrow({
    where: { id: participationId },
    include: {
      person: true,
      cycle: true,
      payments: true,
      paymentEvents: true,
      luckyNumbers: {
        include: {
          payouts: true,
          slotMembers: { include: { slot: { include: { draws: { include: { week: true } }, members: true } } } },
          planNumbers: { include: { plan: { include: { week: true, numbers: true } } } },
        },
      },
    },
  });
  return p;
}

/** Turn the loaded rows into the pure shape the consequence module speaks. */
function toAttachments(
  p: Awaited<ReturnType<typeof loadAttachments>>,
  settlementByPayout: Map<string, number>,
): ParticipationAttachments {
  const mine = new Set(p.luckyNumbers.map((n) => n.id));

  // A draw is left EMPTY only when every remaining member of its slot belongs
  // to this participation. A shared week keeps its other winner untouched.
  const drawsLeftEmpty: { weekNumber: number }[] = [];
  const seenDraw = new Set<string>();
  for (const n of p.luckyNumbers) {
    for (const sm of n.slotMembers) {
      const draw = sm.slot.draws[0] ?? null;
      if (!draw || seenDraw.has(draw.id)) continue;
      seenDraw.add(draw.id);
      const survivors = sm.slot.members.filter((m) => !mine.has(m.luckyNumberId));
      if (survivors.length === 0) drawsLeftEmpty.push({ weekNumber: draw.week.weekNumber });
    }
  }

  // Same test for winner plans — an empty plan is the vacuous-every hazard.
  const plansLeftEmpty: { weekNumber: number | null }[] = [];
  const seenPlan = new Set<string>();
  for (const n of p.luckyNumbers) {
    for (const pn of n.planNumbers) {
      if (seenPlan.has(pn.plan.id)) continue;
      seenPlan.add(pn.plan.id);
      const survivors = pn.plan.numbers.filter((x) => !mine.has(x.luckyNumberId));
      if (survivors.length === 0) {
        plansLeftEmpty.push({ weekNumber: pn.plan.week?.weekNumber ?? null });
      }
    }
  }

  return {
    personName: p.person.nameEnglishFirst,
    cycleName: p.cycle.name,
    weeklyAmount: p.weeklyAmount,
    weeksCommitted: p.weeksCommitted,
    receiptCount: p.paymentEvents.length,
    receiptTotal: p.paymentEvents.reduce((s, e) => s + e.amount, 0),
    weeksWithMoney: p.payments.filter((pm) => pm.amountPaid > 0).length,
    numbers: p.luckyNumbers.map((n) => ({
      number: n.number,
      drawn: n.slotMembers.some((sm) => sm.slot.draws.length > 0),
    })),
    payouts: p.luckyNumbers.flatMap((n) =>
      n.payouts.map((po) => ({
        number: n.number,
        net: po.netAmount,
        status: po.status as "PENDING" | "COLLECTED",
        settlement: settlementByPayout.get(po.id) ?? 0,
      })),
    ),
    drawsLeftEmpty,
    plansLeftEmpty,
    feePercent: p.cycle.feePercent,
  };
}

/** READ-ONLY: everything attached, and what each choice would do. */
export async function participationRemovalPreview(input: { participationId: string }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const p = await loadAttachments(prisma, input.participationId);
    const payoutIds = p.luckyNumbers.flatMap((n) => n.payouts.map((po) => po.id));
    const events = await prisma.paymentEvent.findMany({
      where: { settlementPayoutId: { in: payoutIds } },
      select: { settlementPayoutId: true, amount: true },
    });
    const settlementByPayout = new Map<string, number>();
    for (const e of events) {
      if (!e.settlementPayoutId) continue;
      settlementByPayout.set(
        e.settlementPayoutId,
        (settlementByPayout.get(e.settlementPayoutId) ?? 0) + e.amount,
      );
    }
    const attachments = toAttachments(p, settlementByPayout);
    return {
      ok: true as const,
      data: {
        attachments,
        feeAttributable: feeAttributable(attachments),
        alreadyClosed: p.status === "CLOSED",
        cycleStatus: p.cycle.status,
        removeCompletely: removalConsequences(attachments, "remove-completely"),
        keepMoneyRecords: removalConsequences(attachments, "keep-money-records"),
      },
    };
  } catch (e) {
    console.error("participationRemovalPreview failed:", e);
    return { ok: false as const, error: `Could not load what is attached. ${errorMessage(e)}` };
  }
}

/**
 * Apply one of the two removals. `typedName` must match the member — a
 * mis-clicked choice here destroys real money.
 */
export async function removeFromCycle(input: {
  participationId: string;
  choice: RemovalChoice;
  typedName: string;
}) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const data = await serializableTransaction(async (tx) => {
      const p = await loadAttachments(tx, input.participationId);

      const frozen = frozenCycleRefusal(p.cycle);
      if (frozen) refuse(frozen);
      const refusal = removalRefusal({
        cycleStatus: p.cycle.status,
        choice: input.choice,
        alreadyClosed: p.status === "CLOSED",
      });
      if (refusal) refuse(refusal);

      if (!nameConfirmed(input.typedName, p.person)) {
        refuse(`Type ${p.person.nameEnglishFirst} exactly to confirm.`);
      }

      const payoutIds = p.luckyNumbers.flatMap((n) => n.payouts.map((po) => po.id));
      const events = await tx.paymentEvent.findMany({
        where: { settlementPayoutId: { in: payoutIds } },
        select: { settlementPayoutId: true, amount: true },
      });
      const settlementByPayout = new Map<string, number>();
      for (const e of events) {
        if (!e.settlementPayoutId) continue;
        settlementByPayout.set(
          e.settlementPayoutId,
          (settlementByPayout.get(e.settlementPayoutId) ?? 0) + e.amount,
        );
      }
      const attachments = toAttachments(p, settlementByPayout);
      const consequences = removalConsequences(attachments, input.choice);

      if (input.choice === "keep-money-records") {
        // NOT a delete. The participation row is the parent of every receipt,
        // week row and lucky number, so deleting it takes the money with it
        // whatever the intent. CLOSED is what every ACTIVE filter respects.
        await tx.participation.update({
          where: { id: p.id },
          data: { status: "CLOSED", closedAtWeek: null },
        });
      } else {
        // ————— REMOVE COMPLETELY, in the order that leaves nothing behind —————
        const mine = new Set(p.luckyNumbers.map((n) => n.id));

        // 1. Reverse every settlement FIRST, so the drawn weeks stop being
        //    credited from a payout that is about to disappear.
        for (const id of payoutIds) {
          await unsettlePayout(tx, id);
          await reverseCarryDeduction(tx, id, "they were removed from the cycle");
        }

        // 2. Delete the payouts explicitly rather than by cascade, so the
        //    money leaving the books is a deliberate act.
        await tx.payout.deleteMany({ where: { luckyNumberId: { in: [...mine] } } });

        // 3. Sweep the DRAWS left holding no payout.
        //
        //    THE TEST HERE WAS THE WRONG ONE. It asked whether any SLOT MEMBER
        //    survived, not whether any PAYOUT did — and step 2 has just deleted
        //    every payout this member had. Slot S = {#5 mine, #9 someone
        //    else's}, drawn on week 7. If #9's payout was deleted earlier (a
        //    supported action: the number stays drawn, and deleteDrawIfEmpty
        //    left the draw alone because #5's payout still held it), then
        //    removing #5's owner deletes the last payout while survivors=[#9]
        //    says "leave the draw". Week 7 is then permanently drawn holding
        //    nothing, cannot be redrawn or assigned to, and #9 is frozen out of
        //    the pool forever with no payout recording the win.
        //
        //    That is exactly the week-6 shape this whole audit came from —
        //    reachable through the very action written to prevent it. The right
        //    test is the one lib/draw-cascade.ts already owns: payoutsRemaining.
        const touchedDrawIds = new Set<string>();
        const touchedSlotIds = new Set<string>();
        for (const n of p.luckyNumbers) {
          for (const sm of n.slotMembers) {
            touchedSlotIds.add(sm.slotId);
            const draw = sm.slot.draws[0] ?? null;
            if (draw) touchedDrawIds.add(draw.id);
          }
        }
        for (const drawId of touchedDrawIds) {
          await deleteDrawIfEmpty(tx, drawId);
        }

        // 3b. An UNDRAWN slot holding only this member's numbers is released
        //     too. `if (!draw) continue` skipped those entirely, so the slot
        //     survived with zero members after the cascade — the very orphan
        //     this module's own header promises to prevent.
        for (const slotId of touchedSlotIds) {
          await tx.slotMember.deleteMany({
            where: { slotId, luckyNumberId: { in: [...mine] } },
          });
          await tx.slot.deleteMany({
            where: { id: slotId, members: { none: {} }, draws: { none: {} } },
          });
        }

        // 4. Sweep WINNER PLANS left with zero numbers. `[].every()` is
        //    vacuously true, so an empty plan would match the first eligible
        //    slot and rig the next draw while auditing it as "planned".
        //
        //    Through the shared sweep, for two reasons the hand-rolled version
        //    got wrong: it deleted plans of ANY status, destroying the FULFILLED
        //    record that a win had been planned; and it only reached plans
        //    containing THIS member's numbers, so plans already hollowed out by
        //    an earlier edit — the two found live on week 11 — were left behind.
        await purgeEmptyWinnerPlans(tx, p.cycleId);

        // 5. The participation itself — receipts, week rows, allocations and
        //    lucky numbers all cascade from here.
        await tx.participation.delete({ where: { id: p.id } });
      }

      await logAudit(tx, {
        entity: "Participation",
        entityId: p.id,
        action: input.choice === "remove-completely" ? "delete" : "update",
        summary:
          `${p.person.nameEnglishFirst} removed from ${p.cycle.name} — ` +
          `${input.choice === "remove-completely" ? "REMOVED COMPLETELY" : "removed but money records KEPT"}. ` +
          consequences.lines.join(" ") +
          (consequences.cleanup.length > 0 ? " " + consequences.cleanup.join(" ") : "") +
          ` Cash position moves by ${formatMoney(consequences.cashPositionDelta)}.`,
        before: {
          weeklyAmount: p.weeklyAmount,
          startWeek: p.startWeek,
          weeksCommitted: p.weeksCommitted,
          receiptCount: attachments.receiptCount,
          receiptTotal: attachments.receiptTotal,
          payouts: attachments.payouts.length,
          numbers: attachments.numbers.map((n) => n.number),
        },
        after: { choice: input.choice },
      });

      return {
        name: p.person.nameEnglishFirst,
        cycle: p.cycle.name,
        choice: input.choice,
        cashPositionDelta: consequences.cashPositionDelta,
        numbersReturning: consequences.numbersReturning,
      };
    });

    for (const path of [
      "/admin",
      "/admin/cycle",
      "/admin/people",
      "/admin/payments",
      "/admin/collections",
      "/admin/wheel",
      "/admin/wheel/setup",
    ]) {
      revalidatePath(path);
    }
    return { ok: true as const, data };
  } catch (e) {
    if (e instanceof RemovalError) return { ok: false as const, error: e.message };
    console.error("removeFromCycle failed:", e);
    return { ok: false as const, error: `Could not remove them. ${errorMessage(e)}` };
  }
}
