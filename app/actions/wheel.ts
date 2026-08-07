"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { carryReversalClause, reverseCarryDeduction } from "@/lib/carry-reversal";
import { refuseIfCycleClosed } from "@/lib/cycle-guard";
import { Prisma } from "@/lib/generated/prisma/client";
import { formatMoney } from "@/lib/format";
import { currentWeekFromRows } from "@/lib/commitment";
import { prisma, serializableTransaction } from "@/lib/prisma";
import { frozenCycleRefusal } from "@/lib/cycle-close";
import { SETTLEMENT_EVENT_WHERE, settleWinnerWeeks, unsettleDraw } from "@/lib/draw-settlement";
import { restoreFulfilledPlan } from "@/lib/draw-cascade";
import { undoDrawConsequences } from "@/lib/undo-draw";
import { validateArrangement } from "@/lib/arrangement";
import { redactProposedSlots, redactWheelState } from "@/lib/presentation";
import { getSetting } from "@/lib/settings";
import {
  autoArrange,
  calculatePayout,
  displayOrder,
  eligibleNumbers,
  reshuffle,
  selectWinningSlot,
  undrawnWindowWarnings,
  type WheelNumber,
  type WheelParticipation,
} from "@/lib/wheel";

const WARNING_WEEKS_AHEAD = 3;

/**
 * The one error the SHARED draw screen may show (2.4, audit H3a). Neutral by
 * construction: no names, no money, no hint that a plan exists. The real
 * reason is always in the server log, and the operational pages (setup,
 * draws) explain it privately.
 */
const NEUTRAL_DRAW_SCREEN_ERROR =
  "Something needs attention before this draw — leave this screen and check the wheel setup page.";

function revalidateWheel() {
  revalidatePath("/admin/wheel");
  revalidatePath("/admin/wheel/setup");
  revalidatePath("/admin/collections");
  revalidatePath("/admin");
}

// ————————————————— Shared loading + derivation —————————————————

// Mutating actions pass their transaction client so the validation snapshot
// and the writes share one serializable transaction — a concurrent draw
// cannot slip between validate and write (SSI aborts one side; the P2034
// retry re-runs the whole callback, re-validating against fresh state).
async function loadWheel(db: Prisma.TransactionClient | typeof prisma = prisma) {
  const cycle = await db.cycle.findFirst({
    where: { status: "ACTIVE" },
    include: {
      weeks: { orderBy: { weekNumber: "asc" }, include: { draws: { select: { id: true } } } },
      participations: { include: { person: true } },
      luckyNumbers: { include: { participation: { include: { person: true } } } },
      slots: {
        orderBy: { position: "asc" },
        include: { members: { include: { luckyNumber: true } }, draws: { select: { id: true } } },
      },
      winnerPlans: {
        where: { status: "PLANNED" },
        include: { numbers: { include: { luckyNumber: true } }, week: { select: { id: true, weekNumber: true } } },
      },
    },
  });
  if (!cycle) return null;

  const draws = await db.draw.findMany({
    where: { week: { cycleId: cycle.id } },
    include: { slot: { include: { members: { select: { luckyNumberId: true } } } }, week: true },
  });
  const drawnNumberIds = new Set(draws.flatMap((d) => d.slot.members.map((m) => m.luckyNumberId)));
  const committedNumberIds = new Set(
    cycle.winnerPlans
      .filter((p) => p.mode !== "OPEN_PARTNER")
      .flatMap((p) => p.numbers.map((n) => n.luckyNumberId)),
  );
  const anchoredNumberIds = new Set(
    cycle.winnerPlans
      .filter((p) => p.mode === "OPEN_PARTNER")
      .flatMap((p) => p.numbers.map((n) => n.luckyNumberId)),
  );

  const wheelParticipations: WheelParticipation[] = cycle.participations.map((p) => ({
    id: p.id,
    name: `${p.person.nameAmharic} — ${p.person.nameEnglishFirst}`,
    startWeek: p.startWeek,
    weeksCommitted: p.weeksCommitted,
    status: p.status,
  }));
  const wheelNumbers: WheelNumber[] = cycle.luckyNumbers.map((n) => ({
    id: n.id,
    number: n.number,
    amount: n.amount,
    participationId: n.participationId,
  }));
  // 2.14: the clock comes from the stored week rows, so correcting a start
  // date can never change who is eligible to be drawn.
  const currentWeek = currentWeekFromRows({
    weeks: cycle.weeks,
    today: new Date(),
    cycleStartDate: cycle.startDate,
  });
  const eligible = eligibleNumbers({
    luckyNumbers: wheelNumbers,
    participations: wheelParticipations,
    drawnNumberIds,
    currentWeek,
  });
  const eligibleIds = new Set(eligible.map((n) => n.id));

  // A slot can spin only when it is undrawn and every member is in the pool.
  const eligibleSlots = cycle.slots.filter(
    (s) => s.draws.length === 0 && s.members.length > 0 && s.members.every((m) => eligibleIds.has(m.luckyNumberId)),
  );

  return {
    cycle,
    draws,
    drawnNumberIds,
    committedNumberIds,
    anchoredNumberIds,
    wheelParticipations,
    wheelNumbers,
    currentWeek,
    eligibleIds,
    eligibleSlots,
  };
}

/** Everything the SETUP page needs (private — never screen-shared). */
export async function getWheelState() {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const loaded = await loadWheel();
    if (!loaded) return { ok: false as const, error: "No active cycle." };
    const { cycle } = loaded;

    const assignedIds = new Set(cycle.slots.flatMap((s) => s.members.map((m) => m.luckyNumberId)));
    // The lock and its reason are decided HERE, server-side — presentation
    // mode can then strip the WHY without the client ever holding it.
    const numberInfo = (id: string) => {
      const n = cycle.luckyNumbers.find((x) => x.id === id)!;
      const lock: "frozen" | "anchored" | null = loaded.drawnNumberIds.has(n.id)
        ? "frozen"
        : loaded.committedNumberIds.has(n.id)
          ? "frozen"
          : loaded.anchoredNumberIds.has(n.id)
            ? "anchored"
            : null;
      // A manually ASSIGNED payout takes the number out of the pool exactly
      // like a spin does (2.27) — the wheel only distinguishes the WHY.
      const manuallyAssigned = loaded.draws.some(
        (d) => d.assignedManually && d.slot.members.some((m) => m.luckyNumberId === n.id),
      );
      const lockReason = loaded.drawnNumberIds.has(n.id)
        ? manuallyAssigned
          ? "payout assigned manually — out of the pool, cannot move"
          : "already drawn — history, cannot move"
        : loaded.committedNumberIds.has(n.id)
          ? "committed to a winner plan — cancel the plan to move it"
          : loaded.anchoredNumberIds.has(n.id)
            ? "committed (open partner) — may change slots, must stay on the wheel"
            : null;
      return {
        id: n.id,
        number: n.number,
        amount: n.amount as number | null,
        owner: n.participation.person.nameEnglishFirst,
        eligible: loaded.eligibleIds.has(n.id),
        lock,
        lockReason,
      };
    };

    const full = {
      presentation: false as const,
      cycleName: cycle.name,
      unitAmount: cycle.unitAmount as number | null,
      currentWeek: loaded.currentWeek,
      slots: cycle.slots.map((s) => ({
        id: s.id,
        position: s.position,
        drawn: s.draws.length > 0,
        members: s.members.map((m) => numberInfo(m.luckyNumberId)),
        total: s.members.reduce((sum, m) => sum + m.luckyNumber.amount, 0) as number | null,
      })),
      unassigned: cycle.luckyNumbers
        .filter((n) => !assignedIds.has(n.id))
        .map((n) => numberInfo(n.id)),
      plans: cycle.winnerPlans.map((p) => ({
        id: p.id,
        mode: p.mode,
        weekNumber: p.week?.weekNumber ?? null,
        numbers: p.numbers.map((n) => n.luckyNumber.number).sort((a, b) => a - b),
      })),
      weeks: cycle.weeks.map((w) => ({
        id: w.id,
        weekNumber: w.weekNumber,
        hasDraw: w.draws.length > 0,
        planned: cycle.winnerPlans.some((p) => p.week?.id === w.id),
      })),
      warnings: undrawnWindowWarnings({
        luckyNumbers: loaded.wheelNumbers,
        participations: loaded.wheelParticipations,
        drawnNumberIds: loaded.drawnNumberIds,
        currentWeek: loaded.currentWeek,
        weeksAhead: WARNING_WEEKS_AHEAD,
      }),
    };

    // Presentation mode (2.4): plans are not sent, every lock collapses to a
    // bare "frozen" with no reason, owners and money are gone.
    if (await getSetting("presentationMode")) {
      return { ok: true as const, data: redactWheelState(full) };
    }
    return { ok: true as const, data: full };
  } catch (e) {
    console.error("getWheelState failed:", e);
    return { ok: false as const, error: `Could not load the wheel. ${errorMessage(e)}` };
  }
}

/**
 * The DRAW SCREEN's data (2.4 — screen-shared): the week to draw and the
 * eligible slots as number labels. NOTHING else — no names, no amounts, no
 * plans. Selection logic never reaches the browser.
 */
export async function getDrawScreen() {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const loaded = await loadWheel();
    if (!loaded) return { ok: false as const, error: "No active cycle." };

    // Draw the earliest undrawn week that has arrived (catching up), else
    // the next undrawn week.
    const undrawn = loaded.cycle.weeks.filter((w) => w.draws.length === 0);
    const target =
      undrawn.find((w) => w.weekNumber <= loaded.currentWeek) ?? undrawn[0] ?? null;
    if (!target) return { ok: false as const, error: "Every week has been drawn." };

    return {
      ok: true as const,
      data: {
        weekId: target.id,
        weekNumber: target.weekNumber,
        // 2.4 / audit H3c: NOT position order — a planned winner's slot is
        // created last, so raw order would paint it as the final segment
        // every week. Seeded by the week: stable across reloads, unrelated
        // to creation order. The server picks winners by slot ID, so the
        // display order carries no meaning.
        slots: displayOrder(loaded.eligibleSlots, target.id).map((s) => ({
          id: s.id,
          numbers: s.members
            .map((m) => loaded.wheelNumbers.find((n) => n.id === m.luckyNumberId)?.number ?? 0)
            .sort((a, b) => a - b),
        })),
      },
    };
  } catch (e) {
    // 2.4 / audit H3a: this screen is PROJECTED. The real reason (which can
    // carry a name, a dollar figure, or the existence of a plan) stays in
    // the server log — the screen gets a neutral sentence.
    console.error("getDrawScreen failed:", e);
    return { ok: false as const, error: NEUTRAL_DRAW_SCREEN_ERROR };
  }
}

// ————————————————— Arrangement —————————————————

type SlotProposalInput = { id: string | null; luckyNumberIds: string[] }[];

/**
 * Save an arrangement. A drawn or ALONE/TOGETHER-committed number's slot
 * must arrive byte-identical — rejected otherwise with the number named
 * (2.3). OPEN_PARTNER numbers must remain present somewhere.
 */
export async function saveSlots(input: { slots: SlotProposalInput }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    // Validation and writes share ONE serializable transaction: a draw
    // committed between them would otherwise strip the drawn slot's members.
    const rejected = await serializableTransaction(async (tx) => {
      const loaded = await loadWheel(tx);
      if (!loaded) return "No active cycle.";
      const { cycle } = loaded;
      // 2.9/2.14: a CLOSED cycle's books are final. Resolved through
      // lib/cycle-guard so the check is one line and cannot be skipped
      // for want of plumbing — which is how 14 actions lost it.
      await refuseIfCycleClosed(tx, { cycleId: cycle.id });

      const numberById = new Map(cycle.luckyNumbers.map((n) => [n.id, n]));
      // The full backstop lives in lib/arrangement.ts (pure, tested): number
      // and slot-id sanity plus the 2.3 freeze — including slot IDENTITY, so
      // a frozen slot can never be re-housed under a new id (which would
      // delete the original slot and cascade-delete its Draw).
      const invalid = validateArrangement({
        slots: input.slots,
        existingSlots: cycle.slots.map((s) => ({
          id: s.id,
          memberIds: s.members.map((m) => m.luckyNumberId),
        })),
        knownNumberIds: new Set(numberById.keys()),
        drawnNumberIds: loaded.drawnNumberIds,
        committedNumberIds: loaded.committedNumberIds,
        anchoredNumberIds: loaded.anchoredNumberIds,
        label: (id) => String(numberById.get(id)?.number ?? "?"),
      });
      if (invalid) return invalid;

      const keptIds = new Set(input.slots.map((s) => s.id).filter((id): id is string => id !== null));
      // Remove memberships and slots that are not kept (frozen slots always
      // arrive identical, so deleting+recreating them is safe and simpler).
      await tx.slotMember.deleteMany({ where: { slot: { cycleId: cycle.id } } });
      // draws:none is belt-and-braces on top of validateArrangement — a slot
      // with a Draw must NEVER be deleted (Draw.slot cascades).
      await tx.slot.deleteMany({
        where: { cycleId: cycle.id, id: { notIn: [...keptIds] }, draws: { none: {} } },
      });

      let nextPosition =
        Math.max(0, ...cycle.slots.filter((s) => keptIds.has(s.id)).map((s) => s.position)) + 1;
      for (const slot of input.slots) {
        let slotId = slot.id;
        if (slotId === null) {
          const created = await tx.slot.create({
            data: { cycleId: cycle.id, position: nextPosition++ },
          });
          slotId = created.id;
        }
        if (slot.luckyNumberIds.length > 0) {
          await tx.slotMember.createMany({
            data: slot.luckyNumberIds.map((luckyNumberId) => ({ slotId: slotId!, luckyNumberId })),
          });
        }
      }
      // Empty slots in the payload are PERSISTED — an organizer-created slot
      // is never silently dropped. (The wheel itself ignores empty slots.)
      await logAudit(tx, {
        entity: "Slot",
        entityId: cycle.id,
        action: "update",
        summary: `Wheel arrangement saved: ${input.slots.length} slots`,
      });
      return null;
    });
    if (rejected) return { ok: false as const, error: rejected };

    revalidateWheel();
    return { ok: true as const, data: { saved: true } };
  } catch (e) {
    console.error("saveSlots failed:", e);
    return { ok: false as const, error: `Could not save the arrangement. ${errorMessage(e)}` };
  }
}

/** Propose an auto-arrangement of the unassigned numbers. Does NOT save. */
export async function autoArrangeSlots() {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const loaded = await loadWheel();
    if (!loaded) return { ok: false as const, error: "No active cycle." };
    const assigned = new Set(loaded.cycle.slots.flatMap((s) => s.members.map((m) => m.luckyNumberId)));
    const proposal = autoArrange({
      unassignedNumbers: loaded.wheelNumbers.filter((n) => !assigned.has(n.id) && loaded.eligibleIds.has(n.id)),
      unitAmount: loaded.cycle.unitAmount,
      lockedNumberIds: new Set([...loaded.drawnNumberIds, ...loaded.committedNumberIds]),
    });
    // Presentation mode (2.4): the client applies proposals by id only —
    // allowlist-rebuilt so no amount, owner, or plan flag can ride along.
    if (await getSetting("presentationMode")) {
      return { ok: true as const, data: { proposal: redactProposedSlots(proposal) } };
    }
    return { ok: true as const, data: { proposal } };
  } catch (e) {
    console.error("autoArrangeSlots failed:", e);
    return { ok: false as const, error: `Could not arrange. ${errorMessage(e)}` };
  }
}

/** Propose a reshuffle of everything free. Does NOT save. */
export async function reshuffleSlots() {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const loaded = await loadWheel();
    if (!loaded) return { ok: false as const, error: "No active cycle." };
    const presentation = await getSetting("presentationMode");
    const result = reshuffle({
      slots: loaded.cycle.slots.map((s) => ({
        id: s.id,
        members: s.members.map((m) => ({
          id: m.luckyNumberId,
          number: m.luckyNumber.number,
          amount: m.luckyNumber.amount,
          participationId: m.luckyNumber.participationId,
        })),
      })),
      drawnNumberIds: loaded.drawnNumberIds,
      // In presentation mode the client sees anchored numbers as fully frozen
      // and keeps their slots — so the shuffle must freeze them too, or the
      // proposal would re-seed the anchor and the merged draft would hold it
      // twice (unsalvageable until Discard).
      committedNumberIds: presentation
        ? new Set([...loaded.committedNumberIds, ...loaded.anchoredNumberIds])
        : loaded.committedNumberIds,
      anchoredNumberIds: presentation ? new Set() : loaded.anchoredNumberIds,
      unitAmount: loaded.cycle.unitAmount,
    });
    // Presentation mode (2.4): proposals go out by id only, allowlist-rebuilt
    // so no amount, owner, or plan flag (`anchored`) can ride along; the
    // frozen-slot list is withheld too — correlated with draw history it
    // would mark committed slots.
    if (presentation) {
      return {
        ok: true as const,
        data: {
          frozenSlotIds: [] as string[],
          proposedSlots: redactProposedSlots(result.proposedSlots),
        },
      };
    }
    return { ok: true as const, data: result };
  } catch (e) {
    console.error("reshuffleSlots failed:", e);
    return { ok: false as const, error: `Could not reshuffle. ${errorMessage(e)}` };
  }
}

// ————————————————— Winner planning (2.3) —————————————————

export async function createWinnerPlan(input: {
  luckyNumberIds: string[];
  mode: "ALONE" | "TOGETHER" | "OPEN_PARTNER";
  weekId?: string;
}) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const ids = [...new Set(input.luckyNumberIds)];
    if (ids.length === 0) return { ok: false as const, error: "Pick at least one number." };
    if (input.mode === "TOGETHER" && ids.length < 2) {
      return { ok: false as const, error: "TOGETHER needs at least two numbers." };
    }
    if (input.mode === "OPEN_PARTNER" && ids.length !== 1) {
      return { ok: false as const, error: "Open-partner takes exactly one number." };
    }

    // Validation and writes share ONE serializable transaction (same reason
    // as saveSlots): a draw committed between them could otherwise pull a
    // just-drawn number out of its drawn slot.
    const outcome = await serializableTransaction(async (tx) => {
      // 2.9/2.14: a CLOSED cycle's books are final. Resolved through
      // lib/cycle-guard so the check is one line and cannot be skipped
      // for want of plumbing — which is how 14 actions lost it.
      await refuseIfCycleClosed(tx, { weekId: input.weekId });
      const loaded = await loadWheel(tx);
      if (!loaded) return { error: "No active cycle." };
      const { cycle } = loaded;

      const numberById = new Map(cycle.luckyNumbers.map((n) => [n.id, n]));
      for (const id of ids) {
        const n = numberById.get(id);
        if (!n) return { error: "Unknown number." };
        if (loaded.drawnNumberIds.has(id)) {
          return { error: `Number ${n.number} has already been drawn.` };
        }
        if (loaded.committedNumberIds.has(id) || loaded.anchoredNumberIds.has(id)) {
          return { error: `Number ${n.number} is already committed to another plan.` };
        }
        if (!loaded.eligibleIds.has(id)) {
          return { error: `Number ${n.number} is not in the pool (window closed or not started).` };
        }
      }
      if (input.weekId) {
        const week = cycle.weeks.find((w) => w.id === input.weekId);
        if (!week) return { error: "Unknown week." };
        if (week.draws.length > 0) return { error: `Week ${week.weekNumber} has already been drawn.` };
        if (cycle.winnerPlans.some((p) => p.week?.id === input.weekId)) {
          return { error: `Week ${week.weekNumber} already has a planned winner.` };
        }
      }

      // Moving the planned numbers into their own slot must not disturb any
      // OTHER frozen number's slot (2.3).
      for (const slot of cycle.slots) {
        const memberIds = slot.members.map((m) => m.luckyNumberId);
        const leaving = memberIds.filter((id) => ids.includes(id));
        if (leaving.length === 0) continue;
        const staying = memberIds.filter((id) => !ids.includes(id));
        const frozenStaying = staying.find(
          (id) => loaded.drawnNumberIds.has(id) || loaded.committedNumberIds.has(id),
        );
        if (frozenStaying) {
          return {
            error: `Number ${numberById.get(leaving[0])?.number} currently sits with locked number ${numberById.get(frozenStaying)?.number} — cancel that plan first.`,
          };
        }
      }

      // Only the slots the planned numbers VACATE may be cleaned up if they
      // end up empty — organizer-created empty slots persist (never silently
      // dropped).
      const vacatedSlotIds = cycle.slots
        .filter((s) => s.members.some((m) => ids.includes(m.luckyNumberId)))
        .map((s) => s.id);

      // Pull the numbers out of their current slots into one new slot.
      await tx.slotMember.deleteMany({ where: { luckyNumberId: { in: ids } } });
      const position =
        (await tx.slot.aggregate({ where: { cycleId: cycle.id }, _max: { position: true } }))._max
          .position ?? 0;
      const slot = await tx.slot.create({ data: { cycleId: cycle.id, position: position + 1 } });
      await tx.slotMember.createMany({ data: ids.map((luckyNumberId) => ({ slotId: slot.id, luckyNumberId })) });
      await tx.slot.deleteMany({
        where: { id: { in: vacatedSlotIds }, members: { none: {} }, draws: { none: {} } },
      });

      const plan = await tx.winnerPlan.create({
        data: {
          cycleId: cycle.id,
          weekId: input.weekId ?? null,
          mode: input.mode,
          numbers: { create: ids.map((luckyNumberId) => ({ luckyNumberId })) },
        },
      });
      const numbers = ids.map((id) => `#${numberById.get(id)!.number}`).join("+");
      const weekLabel = input.weekId
        ? `week ${cycle.weeks.find((w) => w.id === input.weekId)?.weekNumber}`
        : "no week yet";
      await logAudit(tx, {
        entity: "WinnerPlan",
        entityId: plan.id,
        action: "create",
        summary: `Planned: ${numbers} (${input.mode}) — ${weekLabel}. Numbers locked.`,
      });
      return { planId: plan.id };
    });
    if ("error" in outcome) return { ok: false as const, error: outcome.error };

    revalidateWheel();
    return { ok: true as const, data: outcome };
  } catch (e) {
    console.error("createWinnerPlan failed:", e);
    return { ok: false as const, error: `Could not save the plan. ${errorMessage(e)}` };
  }
}

export async function cancelWinnerPlan(input: { planId: string }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const data = await serializableTransaction(async (tx) => {
      // 2.9/2.14: a CLOSED cycle's books are final. Resolved through
      // lib/cycle-guard so the check is one line and cannot be skipped
      // for want of plumbing — which is how 14 actions lost it.
      await refuseIfCycleClosed(tx, { winnerPlanId: input.planId });
      const plan = await tx.winnerPlan.findUniqueOrThrow({
        where: { id: input.planId },
        include: { numbers: { include: { luckyNumber: true } }, week: true },
      });
      if (plan.status !== "PLANNED") throw new Error("This plan is no longer active.");
      await tx.winnerPlan.update({ where: { id: input.planId }, data: { status: "CANCELLED" } });
      await logAudit(tx, {
        entity: "WinnerPlan",
        entityId: input.planId,
        action: "update",
        summary: `Plan cancelled: ${plan.numbers.map((n) => `#${n.luckyNumber.number}`).join("+")} (${plan.mode}) — numbers unlocked`,
      });
      return { cancelled: true };
    });
    revalidateWheel();
    return { ok: true as const, data };
  } catch (e) {
    console.error("cancelWinnerPlan failed:", e);
    return { ok: false as const, error: `Could not cancel the plan. ${errorMessage(e)}` };
  }
}

// ————————————————— The spin and the draw —————————————————

/**
 * SERVER-side winner decision (2.4): returns ONLY the slot to land on. The
 * reason (planned vs random) goes to the audit log and never to a screen.
 */
export async function spinWheel(input: { weekId: string }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const loaded = await loadWheel();
    if (!loaded) return { ok: false as const, error: "No active cycle." };
    const week = loaded.cycle.weeks.find((w) => w.id === input.weekId);
    if (!week) return { ok: false as const, error: "Unknown week." };
    if (week.draws.length > 0) return { ok: false as const, error: "This week has already been drawn." };

    const selection = selectWinningSlot({
      eligibleSlots: loaded.eligibleSlots.map((s) => ({
        id: s.id,
        luckyNumberIds: s.members.map((m) => m.luckyNumberId),
      })),
      winnerPlans: loaded.cycle.winnerPlans.map((p) => ({
        id: p.id,
        weekId: p.week?.id ?? null,
        luckyNumberIds: p.numbers.map((n) => n.luckyNumberId),
      })),
      weekId: input.weekId,
    });

    await prisma.auditLog.create({
      data: {
        entity: "Wheel",
        entityId: input.weekId,
        action: "update",
        summary: `Week ${week.weekNumber} spin: ${selection.reason}${selection.planId ? ` (plan ${selection.planId})` : ""}`,
      },
    });

    return { ok: true as const, data: { slotId: selection.slotId } };
  } catch (e) {
    // 2.4 / audit H3a: a planned-winner mismatch throws with plan details —
    // log it, never project it.
    console.error("spinWheel failed:", e);
    return { ok: false as const, error: NEUTRAL_DRAW_SCREEN_ERROR };
  }
}

/**
 * Record the draw: the Draw row plus one PENDING payout PER LUCKY NUMBER in
 * the winning slot, in ONE transaction, with an audit entry. Fulfills the
 * plan that targeted this week, if any.
 */
export async function recordDraw(input: { weekId: string; slotId: string }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const data = await serializableTransaction(async (tx) => {
      const week = await tx.week.findUniqueOrThrow({
        where: { id: input.weekId },
        include: { cycle: true },
      });
      const slot = await tx.slot.findUniqueOrThrow({
        where: { id: input.slotId },
        include: {
          members: { include: { luckyNumber: { include: { participation: { include: { person: true } } } } } },
        },
      });
      if (slot.cycleId !== week.cycleId) throw new Error("Slot and week belong to different cycles.");
      if (slot.members.length === 0) throw new Error("This slot is empty.");
      // Audit H5: settleWinnerWeeks below CREATES a PaymentEvent on this
      // week — money recorded into a closed cycle's frozen books.
      const frozen = frozenCycleRefusal(week.cycle);
      if (frozen) throw new Error(frozen);

      const draw = await tx.draw.create({ data: { weekId: week.id, slotId: slot.id } });

      const payouts = [];
      for (const member of slot.members) {
        const payout = calculatePayout({
          luckyNumber: { id: member.luckyNumberId, amount: member.luckyNumber.amount },
          participation: { weeksCommitted: member.luckyNumber.participation.weeksCommitted },
          cycle: { feePercent: week.cycle.feePercent },
        });
        payouts.push(
          await tx.payout.create({
            data: {
              luckyNumberId: member.luckyNumberId,
              drawId: draw.id,
              grossAmount: payout.gross,
              feeAmount: payout.fee,
              netAmount: payout.net,
              status: "PENDING",
            },
          }),
        );
      }

      // The winner does not pay the week they win: settle each winner's
      // drawn-week contribution FROM their payout(s), reversibly.
      const settlements = await settleWinnerWeeks(tx, draw.id);

      // Fulfill the plan that targeted this week when its numbers won.
      const slotNumberIds = new Set(slot.members.map((m) => m.luckyNumberId));
      const plan = await tx.winnerPlan.findFirst({
        where: { cycleId: week.cycleId, weekId: week.id, status: "PLANNED" },
        include: { numbers: true },
      });
      if (plan && plan.numbers.every((n) => slotNumberIds.has(n.luckyNumberId))) {
        await tx.winnerPlan.update({ where: { id: plan.id }, data: { status: "FULFILLED" } });
      }

      const numberLabels = slot.members
        .map((m) => `#${m.luckyNumber.number}`)
        .join("+");
      const settlementNote =
        settlements.length === 0
          ? ""
          : `; week ${week.weekNumber} contribution settled from the payout: ` +
            settlements.map((s) => `${s.name} ${formatMoney(s.settled)}`).join(", ");
      await logAudit(tx, {
        entity: "Draw",
        entityId: draw.id,
        action: "create",
        summary: `Week ${week.weekNumber} drawn: ${numberLabels} — ${payouts.length} payout(s) pending${settlementNote}`,
      });
      // 2.4 / audit H3b: this response feeds the PROJECTED screen — numbers
      // only. Names and settled amounts live in the audit log and on the
      // private draws/collections pages, never in this payload.
      return {
        drawId: draw.id,
        weekNumber: week.weekNumber,
        numbers: slot.members.map((m) => m.luckyNumber.number).sort((a, b) => a - b),
        settlementCount: settlements.length,
      };
    });

    revalidateWheel();
    revalidatePath("/admin/cycle/draws");
    revalidatePath("/admin/payments");
    return { ok: true as const, data };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return {
        ok: false as const,
        error: "That draw conflicts with an existing one (one draw per week, one win per slot).",
      };
    }
    // 2.4 / audit H3a: the settlement guard throws with a member's NAME and
    // a dollar figure — log it, never project it.
    console.error("recordDraw failed:", e);
    return { ok: false as const, error: NEUTRAL_DRAW_SCREEN_ERROR };
  }
}

/**
 * UNDO THE DRAW — the week was not drawn (2.23). The OPPOSITE of deleting a
 * payout: removes the draw AND every payout it produced, reverses the
 * winner's-week settlements (those weeks are owed again), and the numbers
 * RETURN TO THE WHEEL POOL. A plan this draw fulfilled becomes PLANNED
 * again — the intent survives the undo.
 */
export async function undoDraw(input: { drawId: string }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const data = await serializableTransaction(async (tx) => {
      const draw = await tx.draw.findUniqueOrThrow({
        where: { id: input.drawId },
        include: {
          week: { include: { cycle: true } },
          payouts: { include: { luckyNumber: true } },
          slot: { include: { members: { include: { luckyNumber: true } } } },
        },
      });
      // Audit H5: undoing a draw in a CLOSED cycle deletes payouts recording
      // cash already collected and reverses settlements the archive and the
      // carried ledgers were both built from.
      const frozen = frozenCycleRefusal(draw.week.cycle);
      if (frozen) throw new Error(frozen);

      // Reverse the settlements FIRST (they reference the payouts by key),
      // then remove the money-out records, then the draw itself.
      const settlementByPayout = new Map<string, number>();
      const settlementEvents = await tx.paymentEvent.findMany({
        where: { ...SETTLEMENT_EVENT_WHERE, settlementPayout: { drawId: draw.id } },
        select: { amount: true, settlementPayoutId: true },
      });
      for (const event of settlementEvents) {
        if (!event.settlementPayoutId) continue;
        settlementByPayout.set(
          event.settlementPayoutId,
          (settlementByPayout.get(event.settlementPayoutId) ?? 0) + event.amount,
        );
      }

      const consequences = undoDrawConsequences({
        weekNumber: draw.week.weekNumber,
        slotNumbers: draw.slot.members.map((m) => m.luckyNumber.number),
        payouts: draw.payouts.map((p) => ({
          payoutId: p.id,
          number: p.luckyNumber.number,
          netAmount: p.netAmount,
          status: p.status,
          settlementAmount: settlementByPayout.get(p.id) ?? 0,
        })),
      });

      const { reversed, count } = await unsettleDraw(tx, draw.id);
      // The other half of a carry deduction, per payout — undoing the draw
      // destroys the payouts, and without this the members would keep the
      // credit on their carried ledger for money that never left.
      let carryRestored = 0;
      for (const p of draw.payouts) {
        const back = await reverseCarryDeduction(tx, p.id, "the draw was undone");
        carryRestored += back.restored;
      }
      await tx.payout.deleteMany({ where: { drawId: draw.id } });
      await tx.draw.delete({ where: { id: draw.id } });

      // The plan this draw fulfilled goes back to PLANNED — undoing the draw
      // never silently discards the organizer's locked intent (2.3). Unless it
      // has been hollowed out, in which case restoring it would arm an EMPTY
      // plan that decides the next draw by itself (lib/draw-cascade.ts).
      const planResult = await restoreFulfilledPlan(tx, {
        cycleId: draw.week.cycleId,
        weekId: draw.weekId,
      });

      await logAudit(tx, {
        entity: "Draw",
        entityId: draw.id,
        action: "delete",
        summary:
          `Week ${draw.week.weekNumber} draw UNDONE: ${consequences.numbersReturning.map((n) => `#${n}`).join("+")} return to the wheel; ` +
          `${consequences.payoutCount} payout(s) totalling ${formatMoney(consequences.totalNet)} removed` +
          (consequences.collectedCount > 0
            ? ` (${consequences.collectedCount} already collected: ${formatMoney(consequences.collectedNet)})`
            : "") +
          (count > 0 ? `; ${count} week-settlement(s) reversed (${formatMoney(reversed)} owed again)` : "") +
          carryReversalClause({ restored: carryRestored, entries: carryRestored > 0 ? 1 : 0 }) +
          (planResult.restored
            ? "; the fulfilled winner plan is PLANNED again"
            : planResult.purged
              ? "; its winner plan was NOT restored — it had no numbers left"
              : ""),
        before: {
          weekNumber: draw.week.weekNumber,
          slotId: draw.slotId,
          payouts: draw.payouts.map((p) => ({
            number: p.luckyNumber.number,
            netAmount: p.netAmount,
            status: p.status,
          })),
        },
      });
      return consequences;
    });

    revalidateWheel();
    revalidatePath("/admin/cycle/draws");
    revalidatePath("/admin/payments");
    return { ok: true as const, data };
  } catch (e) {
    console.error("undoDraw failed:", e);
    return { ok: false as const, error: `Could not undo the draw. ${errorMessage(e)}` };
  }
}
