"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/action-result";
import { redactCycleDetail } from "@/lib/presentation";
import { getSetting } from "@/lib/settings";
import { requireAdmin } from "@/lib/auth";
import { parseDateInput } from "@/lib/format";
import { generateWeekDates, MAX_MONEY_CENTS, MAX_WEEKS } from "@/lib/money";
import { prisma, serializableTransaction } from "@/lib/prisma";

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
        select: { id: true },
      });
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
      await tx.setting.create({
        data: { key: `numberingMode:${created.id}`, value: JSON.stringify(input.numbering) },
      });
      return created;
    });

    revalidatePath("/admin/cycle");
    revalidatePath("/admin/cycle/add");
    revalidatePath("/admin/people");
    return { ok: true as const, data: cycle };
  } catch (e) {
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
