"use server";

import { reverseCarryDeduction } from "@/lib/carry-reversal";
import { resolvePlanForNewDraw } from "@/lib/draw-cascade";
// MANUAL PAYOUT (2.2 organizer discretion): the organizer decides to pay a
// member out — an emergency, an agreement — with no spin.
//
// This is NOT a second money route (2.19). It builds exactly what a draw
// builds: a Slot holding the chosen numbers, a Draw on the week, a Payout per
// lucky number computed by the same calculatePayout, and the same
// settleWinnerWeeks. So undo, move, delete, Collections, the cash position
// and the wheel's pool all behave identically. The only recorded difference
// is Draw.assignedManually — the record should show it was a decision.

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { frozenCycleRefusal } from "@/lib/cycle-close";
import { settleWinnerWeeks } from "@/lib/draw-settlement";
import { formatMoney } from "@/lib/format";
import { Prisma } from "@/lib/generated/prisma/client";
import { numbersRefusal, weekChoice, weekChoices } from "@/lib/manual-payout";
import { nameConfirmed } from "@/lib/settlement";
import { unsettleDraw } from "@/lib/draw-settlement";
import { SETTLEMENT_EVENT_WHERE } from "@/lib/draw-settlement";
import { PRESENTATION_HIDDEN } from "@/lib/presentation";
import { prisma, serializableTransaction } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";
import { calculatePayout } from "@/lib/wheel";

/**
 * The choices the "Assign payout" step needs: which weeks are available (and
 * WHY the others are not), and which of this member's numbers can still be
 * paid out, each with its computed gross/fee/net. Read-only.
 */
export async function getManualPayoutOptions(participationId: string) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    // Names, numbers and money (2.4).
    if (await getSetting("presentationMode")) {
      return { ok: false as const, error: PRESENTATION_HIDDEN };
    }
    const participation = await prisma.participation.findUnique({
      where: { id: participationId },
      include: {
        person: true,
        luckyNumbers: { orderBy: { number: "asc" } },
        cycle: {
          include: {
            weeks: {
              orderBy: { weekNumber: "asc" },
              include: {
                draws: {
                  select: {
                    id: true,
                    assignedManually: true,
                    slot: { select: { members: { select: { luckyNumber: { select: { number: true } } } } } },
                    payouts: {
                      select: {
                        id: true,
                        netAmount: true,
                        status: true,
                        luckyNumber: { select: { number: true } },
                      },
                    },
                  },
                },
                winnerPlans: { where: { status: "PLANNED" }, select: { id: true } },
              },
            },
          },
        },
      },
    });
    if (!participation) return { ok: false as const, error: "Participation not found." };

    const frozen = frozenCycleRefusal(participation.cycle);
    if (frozen) return { ok: false as const, error: frozen };

    const draws = await prisma.draw.findMany({
      where: { week: { cycleId: participation.cycleId } },
      include: { slot: { include: { members: { select: { luckyNumberId: true } } } } },
    });
    const drawnIds = new Set(draws.flatMap((d) => d.slot.members.map((m) => m.luckyNumberId)));
    // Which numbers a PLANNED plan has reserved, and for which week — so the
    // picker can say it BEFORE the organizer presses assign (2.10).
    const plannedForPicker = await prisma.winnerPlan.findMany({
      where: { cycleId: participation.cycleId, status: "PLANNED", weekId: { not: null } },
      include: {
        numbers: { select: { luckyNumberId: true } },
        week: { select: { weekNumber: true } },
      },
    });
    const committedWeekForPicker = new Map<string, number>();
    for (const plan of plannedForPicker) {
      if (!plan.week) continue;
      for (const n of plan.numbers) committedWeekForPicker.set(n.luckyNumberId, plan.week.weekNumber);
    }

    // Settlement amounts per payout, so the consequence sentence quotes what
    // would actually reopen rather than guessing (2.23: computed, never
    // assumed). Empty when nothing on this cycle was settled from a payout.
    const settlementEvents = await prisma.paymentEvent.findMany({
      where: {
        ...SETTLEMENT_EVENT_WHERE,
        participation: { cycleId: participation.cycleId },
      },
      select: { amount: true, settlementPayoutId: true },
    });
    const settledByPayout = new Map<string, number>();
    for (const e of settlementEvents) {
      if (!e.settlementPayoutId) continue;
      settledByPayout.set(
        e.settlementPayoutId,
        (settledByPayout.get(e.settlementPayoutId) ?? 0) + e.amount,
      );
    }

    const choices = weekChoices(
      participation.cycle.weeks.map((w) => {
        const draw = w.draws[0] ?? null;
        return {
          weekNumber: w.weekNumber,
          hasDraw: draw !== null,
          drawnManually: draw?.assignedManually ?? false,
          planned: w.winnerPlans.length > 0,
          drawnNumbers: draw?.slot.members.map((m) => m.luckyNumber.number) ?? [],
          payouts:
            draw?.payouts.map((p) => ({
              number: p.luckyNumber.number,
              netAmount: p.netAmount,
              status: p.status as "PENDING" | "COLLECTED",
              settlementAmount: settledByPayout.get(p.id) ?? 0,
            })) ?? [],
          isSkipped: w.isSkipped,
        };
      }),
    ).map((choice) => {
      const week = participation.cycle.weeks.find((w) => w.weekNumber === choice.weekNumber)!;
      return { ...choice, weekId: week.id, drawId: week.draws[0]?.id ?? null };
    });

    return {
      ok: true as const,
      data: {
        memberName: participation.person.nameEnglishFirst,
        /** What must be typed to confirm a replacement (2.23 high stakes). */
        confirmPhrase: participation.person.nameEnglishFirst,
        cycleName: participation.cycle.name,
        weeks: choices,
        numbers: participation.luckyNumbers.map((n) => {
          const payout = calculatePayout({
            luckyNumber: { id: n.id, amount: n.amount },
            participation: { weeksCommitted: participation.weeksCommitted },
            cycle: { feePercent: participation.cycle.feePercent },
          });
          return {
            id: n.id,
            number: n.number,
            amount: n.amount,
            alreadyDrawn: drawnIds.has(n.id),
            // The picker offered a committed number cheerfully and the refusal
            // arrived only after pressing assign — even though this action
            // already knew how to compute the set, twenty lines away in the
            // write path.
            committedToWeek: committedWeekForPicker.get(n.id) ?? null,
            gross: payout.gross,
            fee: payout.fee,
            net: payout.net,
          };
        }),
      },
    };
  } catch (e) {
    console.error("getManualPayoutOptions failed:", e);
    return { ok: false as const, error: `Could not load the options. ${errorMessage(e)}` };
  }
}

export async function assignPayoutManually(input: {
  participationId: string;
  weekId: string;
  luckyNumberIds: string[];
  notes?: string;
  /**
   * The member's name, typed by the organizer, when the chosen week already
   * has a draw. Undoing destroys payout records, so 2.23 demands a deliberate
   * confirmation — and the SAME transaction does the undo and the assignment,
   * so a week can never be left with neither.
   */
  replaceConfirmation?: string;
}) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    if (await getSetting("presentationMode")) {
      return { ok: false as const, error: PRESENTATION_HIDDEN };
    }
    const outcome = await serializableTransaction(async (tx) => {
      const week = await tx.week.findUniqueOrThrow({
        where: { id: input.weekId },
        include: {
          cycle: true,
          draws: {
            include: {
              slot: { include: { members: { include: { luckyNumber: true } } } },
              payouts: { include: { luckyNumber: true } },
            },
          },
          winnerPlans: { where: { status: "PLANNED" }, select: { id: true } },
        },
      });
      // A CLOSED cycle's weeks are final, and settleWinnerWeeks writes money.
      const frozen = frozenCycleRefusal(week.cycle);
      if (frozen) return { error: frozen };

      const participation = await tx.participation.findUniqueOrThrow({
        where: { id: input.participationId },
        include: { person: true },
      });
      if (participation.cycleId !== week.cycleId) {
        return { error: "That week belongs to a different cycle." };
      }

      const existing = week.draws[0] ?? null;
      const settledByPayout = new Map<string, number>();
      if (existing) {
        const events = await tx.paymentEvent.findMany({
          where: { ...SETTLEMENT_EVENT_WHERE, settlementPayout: { drawId: existing.id } },
          select: { amount: true, settlementPayoutId: true },
        });
        for (const e of events) {
          if (!e.settlementPayoutId) continue;
          settledByPayout.set(
            e.settlementPayoutId,
            (settledByPayout.get(e.settlementPayoutId) ?? 0) + e.amount,
          );
        }
      }

      // Recomputed inside the transaction, from the rows just read — the UI's
      // copy of the consequence can be stale, this one cannot.
      const choice = weekChoice({
        weekNumber: week.weekNumber,
        hasDraw: existing !== null,
        drawnManually: existing?.assignedManually ?? false,
        planned: week.winnerPlans.length > 0,
        drawnNumbers: existing?.slot.members.map((m) => m.luckyNumber.number) ?? [],
        payouts:
          existing?.payouts.map((p) => ({
            number: p.luckyNumber.number,
            netAmount: p.netAmount,
            status: p.status as "PENDING" | "COLLECTED",
            settlementAmount: settledByPayout.get(p.id) ?? 0,
          })) ?? [],
        isSkipped: week.isSkipped,
      });
      if (choice.kind === "blocked") return { error: choice.reason };
      if (choice.kind === "replaces" && choice.payoutCount > 0) {
        // Destroying a payout record needs the deliberate act, not a click.
        // An EMPTY draw holds no money record, so there is nothing to destroy
        // and nothing to type — demanding a name there would be friction
        // guarding an absence.
        if (!nameConfirmed(input.replaceConfirmation ?? "", participation.person)) {
          return {
            error:
              `${choice.consequence} To go ahead, type ${participation.person.nameEnglishFirst}'s ` +
              `name to confirm — nothing has been changed.`,
          };
        }
      }

      // THE UNDO — same transaction, before anything else looks at the week,
      // so every check below sees a genuinely free week and a failure anywhere
      // downstream rolls the undo back with it. Identical to undoDraw in
      // app/actions/wheel.ts: settlements reversed, payouts removed, draw
      // deleted, numbers back in the pool, a fulfilled plan PLANNED again.
      let undone: {
        payoutCount: number;
        totalNet: number;
        collectedCount: number;
        numbersReturned: number[];
        reversed: number;
        planRestored: boolean;
      } | null = null;
      if (existing) {
        const { reversed } = await unsettleDraw(tx, existing.id);
        // A carried-balance deduction taken out of one of these payouts has to
        // come back too. LedgerEntry.payoutId is the link that makes that
        // possible; without it the member's balance stayed permanently reduced
        // by money that came out of a payout that no longer exists — and that
        // she never received either, because the payout is gone.
        let carryRestored = 0;
        for (const p of existing.payouts) {
          const back = await reverseCarryDeduction(
            tx,
            p.id,
            "the week's draw was replaced by a manual assignment",
          );
          carryRestored += back.restored;
        }
        await tx.payout.deleteMany({ where: { drawId: existing.id } });
        await tx.draw.delete({ where: { id: existing.id } });
        // DELIBERATELY NOT restoreFulfilledPlan here. That is for undoing a
        // draw and leaving the week open, so the intent can still fire. This
        // path creates a NEW draw on the same week a few lines below, and
        // Draw.@@unique([weekId]) means a plan left PLANNED there could never
        // be fulfilled — while its numbers stayed frozen out of every
        // reshuffle forever. The plan is resolved against the draw that
        // actually happens, after it happens (resolvePlanForNewDraw below).
        undone = {
          payoutCount: existing.payouts.length,
          totalNet: existing.payouts.reduce((s, p) => s + p.netAmount, 0),
          collectedCount: existing.payouts.filter((p) => p.status === "COLLECTED").length,
          numbersReturned: existing.slot.members
            .map((m) => m.luckyNumber.number)
            .sort((a, b) => a - b),
          reversed,
          planRestored: false,
        };
        await logAudit(tx, {
          entity: "Draw",
          entityId: existing.id,
          action: "delete",
          summary:
            `Week ${week.weekNumber} draw UNDONE to make room for a manual assignment: ` +
            `${undone.numbersReturned.map((n) => `#${n}`).join("+")} return to the wheel; ` +
            `${undone.payoutCount} payout(s) totalling ${formatMoney(undone.totalNet)} removed` +
            (undone.collectedCount > 0 ? ` (${undone.collectedCount} already collected)` : "") +
            (reversed > 0 ? `; ${formatMoney(reversed)} of week settlement reversed (owed again)` : "") +
            // The plan is resolved against the NEW draw, below — saying it
            // was "PLANNED again" here asserted an intent that could not survive.
            "",
          before: {
            weekNumber: week.weekNumber,
            payouts: existing.payouts.map((p) => ({
              number: p.luckyNumber.number,
              netAmount: p.netAmount,
              status: p.status,
            })),
          },
        });
      }

      const ids = [...new Set(input.luckyNumberIds)];
      const numbers = await tx.luckyNumber.findMany({
        where: { id: { in: ids } },
        include: {
          slotMembers: { include: { slot: { include: { draws: { select: { id: true } } } } } },
        },
        orderBy: { number: "asc" },
      });
      if (numbers.length !== ids.length) return { error: "Unknown lucky number." };
      if (numbers.some((n) => n.participationId !== participation.id)) {
        return { error: "Those numbers do not all belong to this member." };
      }

      // A number sitting in a drawn slot has left the pool for good (2.27).
      const alreadyDrawn = new Set(
        numbers.filter((n) => n.slotMembers.some((m) => m.slot.draws.length > 0)).map((n) => n.id),
      );
      // ...and one COMMITTED to a plan for another week is out of the pool for
      // the same reason (2.3). The only per-number guard here was
      // `alreadyDrawn`, so a number reserved for week 9 could be assigned to
      // week 5 with no warning — leaving that plan pointing at a drawn number,
      // and week 9 undrawable live on Zoom with a message that explains
      // nothing. The frozen set below was built but used ONLY for slot-mates,
      // and it explicitly excluded the chosen numbers.
      const committedPlans = await tx.winnerPlan.findMany({
        where: {
          cycleId: week.cycleId,
          status: "PLANNED",
          weekId: { not: null },
          NOT: { weekId: week.id },
        },
        include: {
          numbers: { select: { luckyNumberId: true } },
          week: { select: { weekNumber: true } },
        },
      });
      const committedWeekByNumber = new Map<string, number>();
      for (const plan of committedPlans) {
        if (!plan.week) continue;
        for (const n of plan.numbers) committedWeekByNumber.set(n.luckyNumberId, plan.week.weekNumber);
      }
      const numbersProblem = numbersRefusal(
        numbers.map((n) => ({
          id: n.id,
          number: n.number,
          amount: n.amount,
          alreadyDrawn: alreadyDrawn.has(n.id),
          committedToWeek: committedWeekByNumber.get(n.id) ?? null,
        })),
      );
      if (numbersProblem) return { error: numbersProblem };

      // 2.3: pulling these numbers out must not disturb a slot-mate that is
      // itself frozen (already drawn, or committed to a plan).
      const committed = await tx.winnerPlanNumber.findMany({
        where: { plan: { cycleId: week.cycleId, status: "PLANNED" } },
        select: { luckyNumberId: true },
      });
      const frozenIds = new Set(committed.map((c) => c.luckyNumberId));
      const allDraws = await tx.draw.findMany({
        where: { week: { cycleId: week.cycleId } },
        include: { slot: { include: { members: { select: { luckyNumberId: true } } } } },
      });
      for (const d of allDraws) {
        for (const m of d.slot.members) frozenIds.add(m.luckyNumberId);
      }
      const vacatedSlotIds = [...new Set(numbers.flatMap((n) => n.slotMembers.map((m) => m.slotId)))];
      for (const slotId of vacatedSlotIds) {
        const slot = await tx.slot.findUniqueOrThrow({
          where: { id: slotId },
          include: { members: { include: { luckyNumber: true } } },
        });
        const stuck = slot.members
          .filter((m) => !ids.includes(m.luckyNumberId))
          .find((m) => frozenIds.has(m.luckyNumberId));
        if (stuck) {
          return {
            error:
              `Those numbers currently sit with locked number #${stuck.luckyNumber.number} — ` +
              `cancel that plan (or undo that draw) before assigning this payout.`,
          };
        }
      }

      // Their own slot, then the IDENTICAL draw path.
      await tx.slotMember.deleteMany({ where: { luckyNumberId: { in: ids } } });
      const maxPosition =
        (await tx.slot.aggregate({ where: { cycleId: week.cycleId }, _max: { position: true } }))
          ._max.position ?? 0;
      const slot = await tx.slot.create({
        data: { cycleId: week.cycleId, position: maxPosition + 1 },
      });
      await tx.slotMember.createMany({
        data: ids.map((luckyNumberId) => ({ slotId: slot.id, luckyNumberId })),
      });
      await tx.slot.deleteMany({
        where: { id: { in: vacatedSlotIds }, members: { none: {} }, draws: { none: {} } },
      });

      const note = input.notes?.trim() || null;
      const draw = await tx.draw.create({
        data: { weekId: week.id, slotId: slot.id, assignedManually: true, notes: note },
      });
      // 2.3 — a locked plan is never overwritten SILENTLY. Fulfilled when the
      // assignment matched what it committed, cancelled with the reason when
      // it did not. Never left planned on a week that now holds a draw.
      const planOutcome = await resolvePlanForNewDraw(tx, {
        cycleId: week.cycleId,
        weekId: week.id,
        slotNumberIds: ids,
        how: "a manual payout assignment",
      });

      const payouts = [];
      for (const n of numbers) {
        const payout = calculatePayout({
          luckyNumber: { id: n.id, amount: n.amount },
          participation: { weeksCommitted: participation.weeksCommitted },
          cycle: { feePercent: week.cycle.feePercent },
        });
        payouts.push(
          await tx.payout.create({
            data: {
              luckyNumberId: n.id,
              drawId: draw.id,
              grossAmount: payout.gross,
              feeAmount: payout.fee,
              netAmount: payout.net,
              status: "PENDING",
            },
          }),
        );
      }

      // The winner does not pay the week they win — the SAME settlement.
      const settlements = await settleWinnerWeeks(tx, draw.id);

      const settlementNote =
        settlements.length === 0
          ? ""
          : `; week ${week.weekNumber} contribution settled from the payout: ` +
            settlements.map((s) => `${s.name} ${formatMoney(s.settled)}`).join(", ");
      await logAudit(tx, {
        entity: "Draw",
        entityId: draw.id,
        action: "create",
        summary:
          `Week ${week.weekNumber} payout ASSIGNED MANUALLY (no draw) to ` +
          `${participation.person.nameEnglishFirst}: ` +
          payouts
            .map(
              (p, i) =>
                `#${numbers[i].number} gross ${formatMoney(p.grossAmount)}, fee ${formatMoney(p.feeAmount)}, net ${formatMoney(p.netAmount)}`,
            )
            .join("; ") +
          settlementNote +
          // BOTH halves in one entry: the record should read as one decision.
          (undone
            ? `. REPLACED the previous week-${week.weekNumber} draw in the same transaction: ` +
              `${undone.payoutCount} payout(s) totalling ${formatMoney(undone.totalNet)} removed` +
              (undone.collectedCount > 0 ? ` (${undone.collectedCount} already collected)` : "") +
              `, ${undone.numbersReturned.map((n) => `#${n}`).join("+")} returned to the wheel` +
              (undone.reversed > 0 ? `, ${formatMoney(undone.reversed)} of settlement reversed` : "")
            : "") +
          (note ? `. Reason: "${note}"` : ""),
      });

      return {
        drawId: draw.id,
        weekNumber: week.weekNumber,
        numbers: numbers.map((n) => n.number),
        totalNet: payouts.reduce((s, p) => s + p.netAmount, 0),
        settled: settlements.reduce((s, x) => s + x.settled, 0),
        replaced: undone,
      };
    });

    if ("error" in outcome && outcome.error) {
      return { ok: false as const, error: outcome.error };
    }
    const data = outcome as {
      drawId: string;
      weekNumber: number;
      numbers: number[];
      totalNet: number;
      settled: number;
      replaced: {
        payoutCount: number;
        totalNet: number;
        collectedCount: number;
        numbersReturned: number[];
        reversed: number;
        planRestored: boolean;
      } | null;
    };
    revalidatePath("/admin/wheel");
    revalidatePath("/admin/wheel/setup");
    revalidatePath("/admin/collections");
    revalidatePath("/admin/cycle/draws");
    revalidatePath("/admin/payments");
    revalidatePath("/admin");
    return { ok: true as const, data };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return {
        ok: false as const,
        error: "That week already has a payout event (one per week) — undo it first.",
      };
    }
    console.error("assignPayoutManually failed:", e);
    return { ok: false as const, error: `Could not assign the payout. ${errorMessage(e)}` };
  }
}
