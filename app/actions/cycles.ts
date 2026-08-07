"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { formatMoney } from "@/lib/format";
import { redactCycleDetail } from "@/lib/presentation";
import { getSetting } from "@/lib/settings";
import { requireAdmin } from "@/lib/auth";
import { resolveWeekDate, storedWeekDates } from "@/lib/commitment";
import { isWithinBounds, newCycleStartBounds, toIsoDay } from "@/lib/date-bounds";
import { formatDateLongUTC, parseDateInput } from "@/lib/format";
import { calculateFinishWeek, generateWeekDates, MAX_MONEY_CENTS, MAX_WEEKS } from "@/lib/money";
import { prisma, serializableTransaction } from "@/lib/prisma";
import { typedConfirmationRefusal } from "@/lib/typed-confirmation";

/**
 * A refused start date. Thrown from inside the transaction so the write rolls
 * back, then caught below and returned as the organizer-facing reason — not
 * as "Could not save the cycle. <stack>".
 */
class CycleDateError extends Error {}

export type CreateCycleInput = {
  name: string;
  /** "YYYY-MM-DD" from a date input; stored as UTC midnight. */
  startDate: string;
  plannedWeeks: number;
  /** Cents. */
  unitAmount: number;
  feePercent: number;
  /**
   * A deliberate choice, never an assumption: fresh numbers for everyone, or
   * carry each person's numbers over from their previous cycle when free.
   */
  numbering: "fresh" | "carryover";
};

/**
 * Create a cycle and generate all its weeks in one transaction (2.6: weeks
 * and dates generate automatically). Becomes ACTIVE only if no other cycle
 * is active; otherwise saved as DRAFT.
 */
export async function createCycle(input: CreateCycleInput) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const name = input.name?.trim();
    if (!name) return { ok: false as const, error: "Name is required." };

    const startDate = parseDateInput(input.startDate);
    if (!startDate) return { ok: false as const, error: "Start date must be a valid date." };

    if (
      !Number.isSafeInteger(input.plannedWeeks) ||
      input.plannedWeeks < 1 ||
      input.plannedWeeks > MAX_WEEKS
    ) {
      return {
        ok: false as const,
        error: `Planned weeks must be a whole number between 1 and ${MAX_WEEKS}.`,
      };
    }
    if (
      !Number.isSafeInteger(input.unitAmount) ||
      input.unitAmount < 1 ||
      input.unitAmount > MAX_MONEY_CENTS
    ) {
      return { ok: false as const, error: "Unit amount must be a positive amount." };
    }
    if (!Number.isFinite(input.feePercent) || input.feePercent < 0 || input.feePercent > 100) {
      return { ok: false as const, error: "Fee percent must be between 0 and 100." };
    }
    if (input.numbering !== "fresh" && input.numbering !== "carryover") {
      return {
        ok: false as const,
        error: "Choose how lucky numbers are assigned: fresh, or carried over from the previous cycle.",
      };
    }

    // Serializable so two concurrent creates can never both see "no active
    // cycle" and both become ACTIVE.
    const cycle = await serializableTransaction(async (tx) => {
      const active = await tx.cycle.findFirst({
        where: { status: "ACTIVE" },
        select: { id: true, name: true, startDate: true, plannedWeeks: true },
      });

      // THE DATE RULE, enforced here and not only in the picker (a bound that
      // lives in the UI is a hint, not a rule). Read inside the transaction so
      // it sees the same active cycle the status decision does.
      const activeCycle = active
        ? await (async () => {
            const weeks = await tx.week.findMany({
              where: { cycleId: active.id },
              orderBy: { weekNumber: "asc" },
              select: { weekNumber: true, date: true },
            });
            const stored = storedWeekDates(weeks);
            const finishWeek = calculateFinishWeek(1, active.plannedWeeks);
            const planned = resolveWeekDate({
              weekNumber: finishWeek,
              stored,
              cycleStartDate: active.startDate,
            })?.date;
            const lastRow = weeks.at(-1)?.date;
            // 2.7: a cycle can run LONG, so its real end is the later of the
            // planned finish and the last week row that exists.
            const finalWeekDate =
              planned && lastRow ? (lastRow > planned ? lastRow : planned) : (planned ?? lastRow);
            return finalWeekDate
              ? {
                  name: active.name,
                  finalWeekDate,
                  finalWeekLabel: formatDateLongUTC(finalWeekDate),
                }
              : null;
          })()
        : null;

      const bounds = newCycleStartBounds({ activeCycle });
      if (!isWithinBounds(toIsoDay(startDate), bounds)) {
        throw new CycleDateError(bounds.reason ?? "That start date is not available.");
      }

      const created = await tx.cycle.create({
        data: {
          name,
          startDate,
          plannedWeeks: input.plannedWeeks,
          unitAmount: input.unitAmount,
          feePercent: input.feePercent,
          status: active ? "DRAFT" : "ACTIVE",
          weeks: {
            create: generateWeekDates(startDate, input.plannedWeeks).map((date, i) => ({
              weekNumber: i + 1,
              date,
            })),
          },
        },
        include: { weeks: { orderBy: { weekNumber: "asc" } } },
      });
      // The numbering choice travels with the cycle (per-cycle setting row).
      // Removed with the cycle by deleteClosedCycle — Setting has no relation
      // to Cycle, so nothing cascades it.
      await tx.setting.create({
        data: { key: `numberingMode:${created.id}`, value: JSON.stringify(input.numbering) },
      });
      // D-32: creating a cycle is a state change like any other, and it was
      // the only one of its size with no entry at all.
      await logAudit(tx, {
        entity: "Cycle",
        entityId: created.id,
        action: "create",
        summary:
          `Cycle "${created.name}" created — ${created.plannedWeeks} planned weeks from ` +
          `${formatDateLongUTC(created.startDate)}, unit ${formatMoney(created.unitAmount)}, ` +
          `fee ${created.feePercent}%, lucky numbers ${input.numbering === "carryover" ? "CARRIED OVER where free" : "FRESH from 1"}. ` +
          `Status ${created.status}${active ? ` (${active.name} is still active)` : ""}.`,
        after: {
          name: created.name,
          startDate: created.startDate,
          plannedWeeks: created.plannedWeeks,
          unitAmount: created.unitAmount,
          feePercent: created.feePercent,
          numbering: input.numbering,
          status: created.status,
        },
      });
      return created;
    });

    revalidatePath("/admin/cycle");
    revalidatePath("/admin/cycle/add");
    revalidatePath("/admin/people");
    return { ok: true as const, data: cycle };
  } catch (e) {
    // A refused date is a rule the organizer can act on, not a failure.
    if (e instanceof CycleDateError) return { ok: false as const, error: e.message };
    console.error("createCycle failed:", e);
    return { ok: false as const, error: `Could not save the cycle. ${errorMessage(e)}` };
  }
}

export type CycleWithWeeks = Extract<
  Awaited<ReturnType<typeof createCycle>>,
  { ok: true }
>["data"];

/** The single active cycle with its weeks, or null. ADMIN-only (null otherwise). */
export async function getActiveCycle() {
  const gate = await requireAdmin();
  if (!gate.ok) return null;
  const cycle = await prisma.cycle.findFirst({
    where: { status: "ACTIVE" },
    include: { weeks: { orderBy: { weekNumber: "asc" } } },
  });
  // Presentation mode (2.4): the cycle's money configuration is not sent,
  // and week notes (uncontrolled free text — can name members or amounts)
  // are blanked.
  if (cycle && (await getSetting("presentationMode"))) {
    return {
      ...cycle,
      unitAmount: 0,
      feePercent: 0,
      weeks: cycle.weeks.map((w) => ({ ...w, notes: null })),
    };
  }
  return cycle;
}

/** The active cycle with weeks and participations. ADMIN-only (null otherwise). */
export async function getActiveCycleDetail() {
  const gate = await requireAdmin();
  if (!gate.ok) return null;
  const cycle = await prisma.cycle.findFirst({
    where: { status: "ACTIVE" },
    include: {
      weeks: { orderBy: { weekNumber: "asc" } },
      participations: {
        orderBy: { createdAt: "asc" },
        include: {
          person: true,
          luckyNumbers: { orderBy: { number: "asc" } },
        },
      },
    },
  });
  // Presentation mode (2.4): identities become lucky numbers; phones, auth
  // and PIN state are blanked; money is zeroed. Pages hide money columns via
  // the mode flag so no misleading $0 renders.
  if (cycle && (await getSetting("presentationMode"))) {
    return redactCycleDetail(cycle);
  }
  return cycle;
}

export type ActiveCycleDetail = NonNullable<Awaited<ReturnType<typeof getActiveCycleDetail>>>;

// ————————————————— DRAFT CYCLES: the way out —————————————————
//
// `createCycle` writes DRAFT when a cycle is already ACTIVE — the new-cycle
// page is built for exactly that case, and the form confirms "Saved as a
// draft". Nothing then read DRAFT anywhere. There was no activate, no delete
// that accepted it (`deleteClosedCycle` requires CLOSED, `closeCycle` requires
// ACTIVE), and no screen listed it.
//
// So a draft and its week rows and its numbering Setting were permanent
// orphans: invisible, unactivatable, undeletable. The organizer's only
// recourse was to create a third cycle — and `newCycleStartBounds` only knows
// about the ACTIVE cycle, so that one could be given dates overlapping the
// invisible draft's weeks.
//
// Two actions close it. Both are deliberately narrow: a draft has no money,
// no draws and no members, so activating it is safe and deleting it destroys
// nothing that was ever real.

/** Every DRAFT cycle — the ones no other screen can see. */
export async function listDraftCycles() {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const drafts = await prisma.cycle.findMany({
      where: { status: "DRAFT" },
      orderBy: { startDate: "asc" },
      include: { _count: { select: { weeks: true, participations: true } } },
    });
    return {
      ok: true as const,
      data: drafts.map((c) => ({
        id: c.id,
        name: c.name,
        startDate: c.startDate.toISOString().slice(0, 10),
        plannedWeeks: c.plannedWeeks,
        unitAmount: c.unitAmount,
        feePercent: c.feePercent,
        weekCount: c._count.weeks,
        memberCount: c._count.participations,
      })),
    };
  } catch (e) {
    console.error("listDraftCycles failed:", e);
    return { ok: false as const, error: `Could not load the drafts. ${errorMessage(e)}` };
  }
}

/**
 * Make a DRAFT cycle the live one.
 *
 * Refused while another cycle is ACTIVE — the database enforces it too
 * (the partial unique index `one_active_cycle`), and meeting that as a raw
 * constraint violation would tell the organizer nothing.
 */
export async function activateCycle(input: { cycleId: string }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const outcome = await serializableTransaction(async (tx) => {
      const cycle = await tx.cycle.findUnique({ where: { id: input.cycleId } });
      if (!cycle) return { error: "Cycle not found." };
      if (cycle.status !== "DRAFT") {
        return {
          error:
            cycle.status === "ACTIVE"
              ? `“${cycle.name}” is already the live cycle.`
              : `“${cycle.name}” is closed. A closed cycle is never reopened — its archive and the carried ledgers were both written from it (2.9).`,
        };
      }
      const live = await tx.cycle.findFirst({ where: { status: "ACTIVE" } });
      if (live) {
        return {
          error:
            `“${live.name}” is still running, and only one cycle can be live at a time. ` +
            `Close it first — that writes its archive and every carried balance — and then ` +
            `activate “${cycle.name}”.`,
        };
      }

      await tx.cycle.update({ where: { id: cycle.id }, data: { status: "ACTIVE" } });
      await logAudit(tx, {
        entity: "Cycle",
        entityId: cycle.id,
        action: "update",
        summary:
          `Cycle “${cycle.name}” is now ACTIVE — it was created as a draft while another ` +
          `cycle was running. Its ${cycle.plannedWeeks} planned weeks and its numbering ` +
          `choice are unchanged.`,
        before: { status: "DRAFT" },
        after: { status: "ACTIVE" },
      });
      return { name: cycle.name };
    });
    if ("error" in outcome && outcome.error) return { ok: false as const, error: outcome.error };

    revalidatePath("/admin");
    revalidatePath("/admin/cycle");
    revalidatePath("/admin/cycles");
    return { ok: true as const, data: { name: (outcome as { name: string }).name } };
  } catch (e) {
    console.error("activateCycle failed:", e);
    return { ok: false as const, error: `Could not activate the cycle. ${errorMessage(e)}` };
  }
}

/**
 * Delete a DRAFT cycle.
 *
 * No archive is required and none is written: a draft has never held a
 * receipt, a draw or a member, so there is nothing to preserve (2.9's archive
 * rule is about a cycle that RAN). Refused the moment anything is attached,
 * so "draft" can never quietly become "delete a real cycle without an
 * archive".
 */
export async function deleteDraftCycle(input: { cycleId: string; typedName: string }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const outcome = await serializableTransaction(async (tx) => {
      const cycle = await tx.cycle.findUnique({
        where: { id: input.cycleId },
        include: { _count: { select: { participations: true, weeks: true } } },
      });
      if (!cycle) return { error: "Cycle not found." };
      if (cycle.status !== "DRAFT") {
        return {
          error: `Only a draft can be deleted this way — “${cycle.name}” is ${cycle.status.toLowerCase()}.`,
        };
      }
      if (cycle._count.participations > 0) {
        return {
          error:
            `“${cycle.name}” already has ${cycle._count.participations} member(s) in it. Take ` +
            `them out first — their receipts and numbers are not something a delete should ` +
            `decide about quietly.`,
        };
      }
      const refusal = typedConfirmationRefusal({
        typed: input.typedName,
        expected: cycle.name,
        whatItDoes: `this deletes the draft and its ${cycle._count.weeks} generated week rows.`,
      });
      if (refusal) return { error: refusal };

      await logAudit(tx, {
        entity: "Cycle",
        entityId: cycle.id,
        action: "delete",
        summary:
          `Draft cycle “${cycle.name}” deleted with its ${cycle._count.weeks} week rows. It ` +
          `never ran: no member, receipt, draw or payout was ever attached, so no archive was ` +
          `written.`,
        before: { name: cycle.name, plannedWeeks: cycle.plannedWeeks },
      });
      await tx.cycle.delete({ where: { id: cycle.id } });
      // The numbering choice is a Setting row keyed by cycle id and has no
      // relation to Cycle, so nothing cascades it away.
      await tx.setting.deleteMany({ where: { key: `numberingMode:${cycle.id}` } });
      return { name: cycle.name };
    });
    if ("error" in outcome && outcome.error) return { ok: false as const, error: outcome.error };

    revalidatePath("/admin/cycles");
    revalidatePath("/admin/cycle");
    return { ok: true as const, data: { name: (outcome as { name: string }).name } };
  } catch (e) {
    console.error("deleteDraftCycle failed:", e);
    return { ok: false as const, error: `Could not delete the draft. ${errorMessage(e)}` };
  }
}
