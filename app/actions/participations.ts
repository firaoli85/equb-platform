"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import { Prisma } from "@/lib/generated/prisma/client";
import { chooseAutoNumbers, validateManualNumbers } from "@/lib/lucky-numbers";
import { calculateFinishWeek, splitIntoLuckyNumbers } from "@/lib/money";
import {
  ensureWeeksThrough,
  validateCommitmentCap,
  validateParticipationFields,
} from "@/lib/participation-rules";
import { prisma, serializableTransaction } from "@/lib/prisma";

export type ParticipationFields = {
  /** Cents. */
  weeklyAmount: number;
  startWeek: number;
  weeksCommitted: number;
  /**
   * Ground truth 2.22 / D-31: commitments are capped to the planned cycle end
   * unless the organizer explicitly overrides. Only with the override are the
   * extra weeks generated — the cycle then actually runs longer than planned.
   */
  extendPastPlannedEnd?: boolean;
  /**
   * Organizer-typed lucky numbers (2.23: auto by default, full manual control
   * always). Must match the contribution's split count; validated against the
   * cycle before saving, with the unique constraint as durable backstop.
   */
  numbers?: number[];
};

export type AddToCycleInput = ParticipationFields & {
  cycleId: string;
  personId: string;
};

export type AddNewPersonToCycleInput = ParticipationFields & {
  cycleId: string;
  nameAmharic: string;
  nameEnglishFirst: string;
  nameEnglishLast?: string;
  phone?: string;
};

async function loadOpenCycle(cycleId: string) {
  const cycle = await prisma.cycle.findUnique({
    where: { id: cycleId },
    select: { id: true, unitAmount: true, status: true, plannedWeeks: true, startDate: true },
  });
  if (!cycle) return { error: "Cycle not found." as const, cycle: null };
  if (cycle.status === "CLOSED") return { error: "This cycle is closed." as const, cycle: null };
  return { error: null, cycle };
}


/**
 * Create the participation and its lucky numbers inside one transaction.
 * Numbers come from, in order: the organizer's manual entry (validated with
 * a plain-language reason), the person's carried-over numbers when the cycle
 * is in carry-over mode and they are free, or fresh next-available numbers.
 */
async function createParticipationWithNumbers(
  tx: Prisma.TransactionClient,
  args: {
    cycleId: string;
    personId: string;
    weeklyAmount: number;
    startWeek: number;
    weeksCommitted: number;
    unitAmount: number;
    manualNumbers?: number[];
    preferredNumbers?: number[];
  },
) {
  const participation = await tx.participation.create({
    data: {
      cycleId: args.cycleId,
      personId: args.personId,
      weeklyAmount: args.weeklyAmount,
      startWeek: args.startWeek,
      weeksCommitted: args.weeksCommitted,
    },
  });

  const amounts = splitIntoLuckyNumbers(args.weeklyAmount, args.unitAmount);
  const existing = await tx.luckyNumber.findMany({
    where: { cycleId: args.cycleId },
    select: { number: true },
  });
  const taken = new Set(existing.map((n) => n.number));

  let numbers: number[];
  if (args.manualNumbers) {
    const invalid = validateManualNumbers({
      numbers: args.manualNumbers,
      requiredCount: amounts.length,
      taken,
    });
    if (invalid) throw new Error(invalid);
    numbers = [...args.manualNumbers];
  } else {
    numbers = chooseAutoNumbers({
      count: amounts.length,
      taken,
      preferred: args.preferredNumbers,
    });
  }

  try {
    await tx.luckyNumber.createMany({
      data: amounts.map((amount, i) => ({
        participationId: participation.id,
        cycleId: args.cycleId,
        number: numbers[i],
        amount,
      })),
    });
  } catch (e) {
    // The @@unique([cycleId, number]) backstop fired — rethrow as a plain
    // error so it is not mistaken for a duplicate-person P2002 upstream.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new Error("A lucky number was assigned at the same moment — try again.");
    }
    throw e;
  }

  const full = await tx.participation.findUniqueOrThrow({
    where: { id: participation.id },
    include: {
      person: true,
      luckyNumbers: { orderBy: { number: "asc" } },
    },
  });

  // D-32: adding someone to a cycle creates a participation AND lucky numbers
  // — both entities the audit trail is required to cover. It was the one
  // creation path with no entry, so the numbers a member was given could not
  // be traced back to when or how they were chosen.
  await logAudit(tx, {
    entity: "Participation",
    entityId: full.id,
    action: "create",
    summary:
      `${full.person.nameEnglishFirst} added to the cycle — ` +
      `${formatMoney(full.weeklyAmount)}/week from week ${full.startWeek} for ` +
      `${full.weeksCommitted} week${full.weeksCommitted === 1 ? "" : "s"} ` +
      `(finishes week ${calculateFinishWeek(full.startWeek, full.weeksCommitted)}). ` +
      `Lucky number${full.luckyNumbers.length === 1 ? "" : "s"} ` +
      `${full.luckyNumbers.map((n) => `#${n.number}`).join(", ")} ` +
      (args.manualNumbers
        ? "entered by the organizer."
        : args.preferredNumbers
          ? "assigned automatically, carrying over the previous cycle's numbers where free."
          : "assigned automatically from the next free numbers."),
    after: {
      personId: args.personId,
      weeklyAmount: full.weeklyAmount,
      startWeek: full.startWeek,
      weeksCommitted: full.weeksCommitted,
      numbers: full.luckyNumbers.map((n) => n.number),
      numbersChosenBy: args.manualNumbers ? "organizer" : "auto",
    },
  });
  return full;
}

/**
 * When the cycle was created with the carry-over choice, an existing
 * person's numbers from their most recent other cycle are preferred —
 * reused automatically when free, otherwise fresh numbers are assigned.
 */
async function carryoverPreferred(
  cycleId: string,
  personId: string,
): Promise<number[] | undefined> {
  const setting = await prisma.setting.findUnique({
    where: { key: `numberingMode:${cycleId}` },
  });
  let mode = "fresh";
  if (setting) {
    try {
      mode = JSON.parse(setting.value);
    } catch {
      mode = "fresh";
    }
  }
  if (mode !== "carryover") return undefined;
  const previous = await prisma.participation.findFirst({
    where: { personId, cycleId: { not: cycleId } },
    orderBy: { createdAt: "desc" },
    include: { luckyNumbers: { orderBy: { number: "asc" } } },
  });
  return previous && previous.luckyNumbers.length > 0
    ? previous.luckyNumbers.map((n) => n.number)
    : undefined;
}

function isDuplicateParticipation(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError &&
    e.code === "P2002"
  );
}

/** Add an existing directory person to a cycle (2.5: participation per-cycle). */
export async function addToCycle(input: AddToCycleInput) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const invalid = validateParticipationFields(input);
    if (invalid) return { ok: false as const, error: invalid };

    const { error, cycle } = await loadOpenCycle(input.cycleId);
    if (error) return { ok: false as const, error };

    const capError = validateCommitmentCap(cycle, input);
    if (capError) return { ok: false as const, error: capError };

    const person = await prisma.person.findUnique({
      where: { id: input.personId },
      select: { id: true, nameEnglishFirst: true },
    });
    if (!person) return { ok: false as const, error: "Person not found." };

    const preferred = input.numbers
      ? undefined
      : await carryoverPreferred(input.cycleId, input.personId);

    // Serializable so two concurrent saves can never read the same free
    // lucky numbers and both assign them.
    const participation = await serializableTransaction(async (tx) => {
      await ensureWeeksThrough(
        tx,
        cycle,
        calculateFinishWeek(input.startWeek, input.weeksCommitted),
      );
      return createParticipationWithNumbers(tx, {
        cycleId: input.cycleId,
        personId: input.personId,
        weeklyAmount: input.weeklyAmount,
        startWeek: input.startWeek,
        weeksCommitted: input.weeksCommitted,
        unitAmount: cycle.unitAmount,
        manualNumbers: input.numbers,
        preferredNumbers: preferred,
      });
    });

    revalidatePath("/admin/cycle");
    revalidatePath("/admin/cycle/add");
    revalidatePath("/admin/people");
    return { ok: true as const, data: participation };
  } catch (e) {
    if (isDuplicateParticipation(e)) {
      return { ok: false as const, error: "This person is already in this cycle." };
    }
    console.error("addToCycle failed:", e);
    return { ok: false as const, error: `Could not save. ${errorMessage(e)}` };
  }
}

/**
 * D-30: a brand-new person is created in the directory AND added to the
 * cycle in ONE transaction — never two separate steps that can half-succeed.
 */
export async function addNewPersonToCycle(input: AddNewPersonToCycleInput) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const nameAmharic = input.nameAmharic?.trim();
    const nameEnglishFirst = input.nameEnglishFirst?.trim();
    if (!nameAmharic) return { ok: false as const, error: "Amharic name is required." };
    if (!nameEnglishFirst) return { ok: false as const, error: "English first name is required." };

    const invalid = validateParticipationFields(input);
    if (invalid) return { ok: false as const, error: invalid };

    const { error, cycle } = await loadOpenCycle(input.cycleId);
    if (error) return { ok: false as const, error };

    const capError = validateCommitmentCap(cycle, input);
    if (capError) return { ok: false as const, error: capError };

    const participation = await serializableTransaction(async (tx) => {
      await ensureWeeksThrough(
        tx,
        cycle,
        calculateFinishWeek(input.startWeek, input.weeksCommitted),
      );
      const person = await tx.person.create({
        data: {
          nameAmharic,
          nameEnglishFirst,
          nameEnglishLast: input.nameEnglishLast?.trim() || null,
          phone: input.phone?.trim() || null,
        },
      });
      return createParticipationWithNumbers(tx, {
        cycleId: input.cycleId,
        personId: person.id,
        weeklyAmount: input.weeklyAmount,
        startWeek: input.startWeek,
        weeksCommitted: input.weeksCommitted,
        unitAmount: cycle.unitAmount,
        // A brand-new person has no previous cycle to carry numbers from.
        manualNumbers: input.numbers,
      });
    });

    revalidatePath("/admin/cycle");
    revalidatePath("/admin/cycle/add");
    revalidatePath("/admin/people");
    return { ok: true as const, data: participation };
  } catch (e) {
    console.error("addNewPersonToCycle failed:", e);
    return { ok: false as const, error: `Could not save. ${errorMessage(e)}` };
  }
}

export type SavedParticipation = Extract<
  Awaited<ReturnType<typeof addToCycle>>,
  { ok: true }
>["data"];
