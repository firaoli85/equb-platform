"use server";

// D-32 / 2.23: full organizer control. Every mutation here runs with
// requireAdmin first, executes change + audit entry in ONE serializable
// transaction, and revalidates the admin pages so derived figures are
// recalculated immediately. Constraint violations become plain-language
// errors, never silent failures.

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import {
  SETTLEMENT_EVENT_WHERE,
  settleWinnerWeeks,
  unsettleDraw,
  unsettlePayout,
} from "@/lib/draw-settlement";
import { formatMoney, parseDateInput } from "@/lib/format";
import { Prisma } from "@/lib/generated/prisma/client";
import { calculateFinishWeek, MAX_MONEY_CENTS, MAX_WEEKS } from "@/lib/money";
import { computeTermsSettlement, nameConfirmed } from "@/lib/settlement";
import { changeWinnerRefusal } from "@/lib/undo-draw";
import {
  ensureWeeksThrough,
  validateCommitmentCap,
  validateParticipationFields,
  type ParticipationFieldsInput,
} from "@/lib/participation-rules";
import { PRESENTATION_HIDDEN } from "@/lib/presentation";
import { prisma, serializableTransaction } from "@/lib/prisma";
import { rebuildParticipationPayments } from "@/lib/rebuild";
import { getSetting } from "@/lib/settings";

const PAYMENT_METHODS = ["ZELLE", "CASH", "OTHER"] as const;
type MethodInput = (typeof PAYMENT_METHODS)[number] | null;

function revalidateAdmin() {
  revalidatePath("/admin/cycle");
  revalidatePath("/admin/cycle/add");
  revalidatePath("/admin/people");
  revalidatePath("/admin/audit");
}

function isUnique(e: unknown): e is Prisma.PrismaClientKnownRequestError {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

function validMethod(m: unknown): m is MethodInput {
  return m === null || PAYMENT_METHODS.includes(m as (typeof PAYMENT_METHODS)[number]);
}

function parseTimestamp(value: string): Date | null {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ————————————————— Person —————————————————

export async function updatePerson(input: {
  personId: string;
  nameAmharic: string;
  nameEnglishFirst: string;
  nameEnglishLast?: string;
  phone?: string;
}) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const nameAmharic = input.nameAmharic?.trim();
    const nameEnglishFirst = input.nameEnglishFirst?.trim();
    if (!nameAmharic) return { ok: false as const, error: "Amharic name is required." };
    if (!nameEnglishFirst) return { ok: false as const, error: "English first name is required." };

    const person = await serializableTransaction(async (tx) => {
      const before = await tx.person.findUniqueOrThrow({ where: { id: input.personId } });
      const after = await tx.person.update({
        where: { id: input.personId },
        data: {
          nameAmharic,
          nameEnglishFirst,
          nameEnglishLast: input.nameEnglishLast?.trim() || null,
          phone: input.phone?.trim() || null,
        },
      });
      await logAudit(tx, {
        entity: "Person",
        entityId: input.personId,
        action: "update",
        summary: `Edited ${before.nameEnglishFirst}: name/phone updated`,
        before: pickPerson(before),
        after: pickPerson(after),
      });
      return after;
    });
    revalidateAdmin();
    revalidatePath(`/admin/people/${input.personId}`);
    return { ok: true as const, data: person };
  } catch (e) {
    console.error("updatePerson failed:", e);
    return { ok: false as const, error: `Could not save. ${errorMessage(e)}` };
  }
}

function pickPerson(p: { nameAmharic: string; nameEnglishFirst: string; nameEnglishLast: string | null; phone: string | null }) {
  return {
    nameAmharic: p.nameAmharic,
    nameEnglishFirst: p.nameEnglishFirst,
    nameEnglishLast: p.nameEnglishLast,
    phone: p.phone,
  };
}

export async function deletePerson(input: { personId: string }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const result = await serializableTransaction(async (tx) => {
      const target = await tx.person.findUniqueOrThrow({
        where: { id: input.personId },
        include: { _count: { select: { participations: true, ledgerEntries: true } } },
      });
      if (target._count.participations > 0) {
        throw new Error(
          `${target.nameEnglishFirst} is in ${target._count.participations} cycle(s) — remove those participations first.`,
        );
      }
      if (target._count.ledgerEntries > 0) {
        throw new Error(
          `${target.nameEnglishFirst} has ledger entries — the carried balance record must be kept (2.18).`,
        );
      }
      await tx.person.delete({ where: { id: input.personId } });
      await logAudit(tx, {
        entity: "Person",
        entityId: input.personId,
        action: "delete",
        summary: `Removed ${target.nameAmharic} (${target.nameEnglishFirst}) from the directory`,
        before: pickPerson(target),
      });
      return { name: target.nameEnglishFirst };
    });
    revalidateAdmin();
    return { ok: true as const, data: result };
  } catch (e) {
    console.error("deletePerson failed:", e);
    return { ok: false as const, error: `Could not remove. ${errorMessage(e)}` };
  }
}

// ————————————————— Participation —————————————————

/**
 * Edit a participation's terms. NOT YET DRAWN → recalculate and save.
 * ALREADY DRAWN → they hold money based on their OLD commitment: if the new
 * terms change what they were entitled to, the save STOPS and returns the
 * real settlement figures; it completes only with an explicit settlement
 * choice and the member's typed name (2.18, 2.23).
 */
export async function updateParticipation(
  input: ParticipationFieldsInput & {
    participationId: string;
    settlement?: {
      choice: "returned" | "ledger" | "credit" | "decline-credit";
      returnedAmount?: number;
      typedName: string;
    };
  },
) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const invalid = validateParticipationFields(input);
    if (invalid) return { ok: false as const, error: invalid };

    const outcome = await serializableTransaction(async (tx) => {
      const before = await tx.participation.findUniqueOrThrow({
        where: { id: input.participationId },
        include: { cycle: true, person: true, luckyNumbers: { include: { payouts: true } } },
      });
      const capError = validateCommitmentCap(before.cycle, input);
      if (capError) throw new Error(capError);

      // The drawn branch: real money already went out under the old terms.
      const payouts = before.luckyNumbers.flatMap((n) => n.payouts);
      const termsChanged =
        before.weeklyAmount !== input.weeklyAmount ||
        before.weeksCommitted !== input.weeksCommitted;
      let settlementSummary = "";

      if (payouts.length > 0 && termsChanged) {
        // What they actually got: payout nets as they stand PLUS the week
        // contributions that were settled out of them at draw time.
        const settlementEvents = await tx.paymentEvent.findMany({
          where: { participationId: before.id, ...SETTLEMENT_EVENT_WHERE },
          select: { amount: true },
        });
        const alreadyReceived =
          payouts.reduce((sum, p) => sum + p.netAmount, 0) +
          settlementEvents.reduce((sum, e) => sum + e.amount, 0);
        const terms = computeTermsSettlement({
          oldWeeklyAmount: before.weeklyAmount,
          oldWeeksCommitted: before.weeksCommitted,
          newWeeklyAmount: input.weeklyAmount,
          newWeeksCommitted: input.weeksCommitted,
          feePercent: before.cycle.feePercent,
          alreadyReceived,
        });

        if (terms.gap !== 0 && !input.settlement) {
          // STOP — the UI must show the settlement step with these figures.
          return {
            needsSettlement: {
              memberName: before.person.nameEnglishFirst,
              nameEnglishLast: before.person.nameEnglishLast,
              nameAmharic: before.person.nameAmharic,
              cycleName: before.cycle.name,
              feePercent: before.cycle.feePercent,
              oldWeeklyAmount: before.weeklyAmount,
              oldWeeksCommitted: before.weeksCommitted,
              ...terms,
            },
          };
        }

        if (terms.gap !== 0 && input.settlement) {
          if (!nameConfirmed(input.settlement.typedName, before.person)) {
            throw new Error(
              `Type ${before.person.nameEnglishFirst}'s name exactly to confirm the settlement — nothing was saved.`,
            );
          }
          const gap = terms.gap;
          const choice = input.settlement.choice;
          if (gap > 0) {
            if (choice === "returned") {
              const returned = input.settlement.returnedAmount ?? 0;
              if (!Number.isSafeInteger(returned) || returned < 1 || returned > gap) {
                throw new Error(
                  `The returned amount must be between $0.01 and ${formatMoney(gap)} — nothing was saved.`,
                );
              }
              const remainder = gap - returned;
              if (remainder > 0) {
                await tx.ledgerEntry.create({
                  data: {
                    personId: before.personId,
                    type: "DEBT",
                    amount: remainder,
                    description: `Settlement in ${before.cycle.name}: terms cut after payout — returned ${formatMoney(returned)}, ${formatMoney(remainder)} still owed`,
                  },
                });
              }
              settlementSummary = `returned ${formatMoney(returned)}${remainder > 0 ? `, ${formatMoney(remainder)} to the carried ledger` : " — settled in full"}`;
            } else if (choice === "ledger") {
              await tx.ledgerEntry.create({
                data: {
                  personId: before.personId,
                  type: "DEBT",
                  amount: gap,
                  description: `Settlement in ${before.cycle.name}: terms cut after payout — nothing returned, ${formatMoney(gap)} owed`,
                },
              });
              settlementSummary = `nothing returned — ${formatMoney(gap)} to the carried ledger (2.18)`;
            } else {
              throw new Error("They hold too much — choose how the excess is settled.");
            }
          } else {
            // gap < 0: the new terms entitle them to MORE than they received.
            if (choice === "credit") {
              await tx.ledgerEntry.create({
                data: {
                  personId: before.personId,
                  type: "PAYMENT",
                  amount: -gap,
                  description: `Settlement in ${before.cycle.name}: terms increased after payout — ${formatMoney(-gap)} owed TO them (offsets carried debt)`,
                },
              });
              settlementSummary = `${formatMoney(-gap)} recorded as owed TO them (ledger credit)`;
            } else if (choice === "decline-credit") {
              settlementSummary = `${formatMoney(-gap)} owed to them — organizer chose not to record a credit`;
            } else {
              throw new Error("They are owed more — choose whether to record the credit.");
            }
          }
          settlementSummary =
            ` TERMS SETTLEMENT: received ${formatMoney(alreadyReceived)}, new entitlement ${formatMoney(terms.newEntitlementNet)}, gap ${formatMoney(Math.abs(gap))} — ${settlementSummary}.`;
        }
      }

      // A settled win-week's receipt was sized at the OLD weekly. A cheaper
      // week can no longer absorb it, so resize the settlement to the new
      // cost — the cash difference is inside the gap settled above. Without
      // this, the rebuild below would (rightly) refuse every save.
      if (payouts.length > 0 && before.weeklyAmount !== input.weeklyAmount) {
        const pinned = await tx.paymentEvent.findMany({
          where: { participationId: before.id, ...SETTLEMENT_EVENT_WHERE },
        });
        for (const event of pinned) {
          const resized = Math.min(event.amount, input.weeklyAmount);
          if (resized === event.amount) continue;
          if (resized === 0) await tx.paymentEvent.delete({ where: { id: event.id } });
          else await tx.paymentEvent.update({ where: { id: event.id }, data: { amount: resized } });
          settlementSummary += ` Win-week settlement resized ${formatMoney(event.amount)} → ${formatMoney(resized)} to fit the new weekly.`;
        }
      }

      await ensureWeeksThrough(
        tx,
        before.cycle,
        calculateFinishWeek(input.startWeek, input.weeksCommitted),
      );
      const after = await tx.participation.update({
        where: { id: input.participationId },
        data: {
          weeklyAmount: input.weeklyAmount,
          startWeek: input.startWeek,
          weeksCommitted: input.weeksCommitted,
        },
      });
      // The window or rate changed — replay the receipts so every aggregate
      // matches the new shape, or roll everything back with a clear reason.
      await rebuildParticipationPayments(tx, input.participationId);
      await logAudit(tx, {
        entity: "Participation",
        entityId: input.participationId,
        action: "update",
        summary: `Edited ${before.person.nameEnglishFirst}'s participation in ${before.cycle.name}.${settlementSummary}`,
        before: {
          weeklyAmount: before.weeklyAmount,
          startWeek: before.startWeek,
          weeksCommitted: before.weeksCommitted,
        },
        after: {
          weeklyAmount: after.weeklyAmount,
          startWeek: after.startWeek,
          weeksCommitted: after.weeksCommitted,
          settlement: settlementSummary || undefined,
        },
      });
      return { after };
    });

    if ("needsSettlement" in outcome) {
      return {
        ok: false as const,
        error: "This member has already been drawn — settle the difference first.",
        needsSettlement: outcome.needsSettlement,
      };
    }
    revalidateAdmin();
    revalidatePath(`/admin/participations/${input.participationId}`);
    return { ok: true as const, data: outcome.after };
  } catch (e) {
    console.error("updateParticipation failed:", e);
    return { ok: false as const, error: `Could not save. ${errorMessage(e)}` };
  }
}

export async function removeParticipation(input: { participationId: string }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const data = await serializableTransaction(async (tx) => {
      const target = await tx.participation.findUniqueOrThrow({
        where: { id: input.participationId },
        include: {
          person: true,
          cycle: true,
          _count: { select: { luckyNumbers: true, payments: true, paymentEvents: true } },
        },
      });
      await tx.participation.delete({ where: { id: input.participationId } });
      await logAudit(tx, {
        entity: "Participation",
        entityId: input.participationId,
        action: "delete",
        summary:
          `Removed ${target.person.nameEnglishFirst} from ${target.cycle.name} ` +
          `(deleted ${target._count.luckyNumbers} lucky numbers, ${target._count.payments} week rows, ${target._count.paymentEvents} receipts)`,
        before: {
          personId: target.personId,
          weeklyAmount: target.weeklyAmount,
          startWeek: target.startWeek,
          weeksCommitted: target.weeksCommitted,
        },
      });
      return { name: target.person.nameEnglishFirst, cycle: target.cycle.name };
    });
    revalidateAdmin();
    return { ok: true as const, data };
  } catch (e) {
    console.error("removeParticipation failed:", e);
    return { ok: false as const, error: `Could not remove. ${errorMessage(e)}` };
  }
}

// ————————————————— Lucky numbers —————————————————

export async function updateLuckyNumber(input: { luckyNumberId: string; number: number; amount: number }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    if (!Number.isSafeInteger(input.number) || input.number < 1) {
      return { ok: false as const, error: "Lucky number must be a positive whole number." };
    }
    if (!Number.isSafeInteger(input.amount) || input.amount < 1 || input.amount > MAX_MONEY_CENTS) {
      return { ok: false as const, error: "Amount must be a positive amount." };
    }
    const data = await serializableTransaction(async (tx) => {
      const before = await tx.luckyNumber.findUniqueOrThrow({ where: { id: input.luckyNumberId } });
      const after = await tx.luckyNumber.update({
        where: { id: input.luckyNumberId },
        data: { number: input.number, amount: input.amount },
      });
      await logAudit(tx, {
        entity: "LuckyNumber",
        entityId: input.luckyNumberId,
        action: "update",
        summary: `Lucky number #${before.number} (${before.amount}c) -> #${after.number} (${after.amount}c)`,
        before: { number: before.number, amount: before.amount },
        after: { number: after.number, amount: after.amount },
      });
      return after;
    });
    revalidateAdmin();
    return { ok: true as const, data };
  } catch (e) {
    if (isUnique(e)) {
      return { ok: false as const, error: `Number ${input.number} is already taken in this cycle.` };
    }
    console.error("updateLuckyNumber failed:", e);
    return { ok: false as const, error: `Could not save. ${errorMessage(e)}` };
  }
}

export async function addLuckyNumber(input: { participationId: string; number: number; amount: number }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    if (!Number.isSafeInteger(input.number) || input.number < 1) {
      return { ok: false as const, error: "Lucky number must be a positive whole number." };
    }
    if (!Number.isSafeInteger(input.amount) || input.amount < 1 || input.amount > MAX_MONEY_CENTS) {
      return { ok: false as const, error: "Amount must be a positive amount." };
    }
    const data = await serializableTransaction(async (tx) => {
      const participation = await tx.participation.findUniqueOrThrow({
        where: { id: input.participationId },
        include: { person: true },
      });
      const created = await tx.luckyNumber.create({
        data: {
          participationId: input.participationId,
          cycleId: participation.cycleId,
          number: input.number,
          amount: input.amount,
        },
      });
      await logAudit(tx, {
        entity: "LuckyNumber",
        entityId: created.id,
        action: "create",
        summary: `Added lucky number #${created.number} (${created.amount}c) for ${participation.person.nameEnglishFirst}`,
        after: { number: created.number, amount: created.amount },
      });
      return created;
    });
    revalidateAdmin();
    return { ok: true as const, data };
  } catch (e) {
    if (isUnique(e)) {
      return { ok: false as const, error: `Number ${input.number} is already taken in this cycle.` };
    }
    console.error("addLuckyNumber failed:", e);
    return { ok: false as const, error: `Could not save. ${errorMessage(e)}` };
  }
}

export async function deleteLuckyNumber(input: { luckyNumberId: string }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const data = await serializableTransaction(async (tx) => {
      const target = await tx.luckyNumber.findUniqueOrThrow({
        where: { id: input.luckyNumberId },
        include: { _count: { select: { payouts: true, slotMembers: true } } },
      });
      if (target._count.payouts > 0) {
        throw new Error(
          `#${target.number} has ${target._count.payouts} payout record(s) — delete those first so no money record is lost.`,
        );
      }
      await tx.luckyNumber.delete({ where: { id: input.luckyNumberId } });
      await logAudit(tx, {
        entity: "LuckyNumber",
        entityId: input.luckyNumberId,
        action: "delete",
        summary: `Deleted lucky number #${target.number} (${target.amount}c)`,
        before: { number: target.number, amount: target.amount },
      });
      return { number: target.number };
    });
    revalidateAdmin();
    return { ok: true as const, data };
  } catch (e) {
    console.error("deleteLuckyNumber failed:", e);
    return { ok: false as const, error: `Could not delete. ${errorMessage(e)}` };
  }
}

// ————————————————— Payment events and week rows —————————————————

export async function updatePaymentEvent(input: {
  eventId: string;
  amount: number;
  method: MethodInput;
  receivedAt: string;
  notes?: string;
}) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    if (!Number.isSafeInteger(input.amount) || input.amount < 1 || input.amount > MAX_MONEY_CENTS) {
      return { ok: false as const, error: "Amount must be a positive amount." };
    }
    if (!validMethod(input.method)) return { ok: false as const, error: "Unknown method." };
    const receivedAt = parseTimestamp(input.receivedAt);
    if (!receivedAt) return { ok: false as const, error: "Received-at must be a valid date." };

    const data = await serializableTransaction(async (tx) => {
      const before = await tx.paymentEvent.findUniqueOrThrow({ where: { id: input.eventId } });
      const after = await tx.paymentEvent.update({
        where: { id: input.eventId },
        data: {
          amount: input.amount,
          method: input.method,
          receivedAt,
          notes: input.notes?.trim() || null,
        },
      });
      await rebuildParticipationPayments(tx, before.participationId);
      await logAudit(tx, {
        entity: "PaymentEvent",
        entityId: input.eventId,
        action: "update",
        summary: `Receipt edited: ${before.amount}c ${before.method ?? ""} -> ${after.amount}c ${after.method ?? ""}; weeks recalculated`,
        before: { amount: before.amount, method: before.method, receivedAt: before.receivedAt, notes: before.notes },
        after: { amount: after.amount, method: after.method, receivedAt: after.receivedAt, notes: after.notes },
      });
      return after;
    });
    revalidateAdmin();
    return { ok: true as const, data };
  } catch (e) {
    console.error("updatePaymentEvent failed:", e);
    return { ok: false as const, error: `Could not save. ${errorMessage(e)}` };
  }
}

export async function deletePaymentEvent(input: { eventId: string }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const data = await serializableTransaction(async (tx) => {
      const target = await tx.paymentEvent.findUniqueOrThrow({ where: { id: input.eventId } });
      await tx.paymentEvent.delete({ where: { id: input.eventId } });
      await rebuildParticipationPayments(tx, target.participationId);
      await logAudit(tx, {
        entity: "PaymentEvent",
        entityId: input.eventId,
        action: "delete",
        summary: `Receipt deleted: ${target.amount}c (${target.method ?? "no method"}); weeks recalculated`,
        before: { amount: target.amount, method: target.method, receivedAt: target.receivedAt },
      });
      return { amount: target.amount };
    });
    revalidateAdmin();
    return { ok: true as const, data };
  } catch (e) {
    console.error("deletePaymentEvent failed:", e);
    return { ok: false as const, error: `Could not delete. ${errorMessage(e)}` };
  }
}

/**
 * Week-row edits: deferral, receipt metadata, notes. The AMOUNT of a week row
 * is derived from its allocated receipts — edit the receipts to change it.
 */
export async function updatePaymentRow(input: {
  paymentId: string;
  isDeferred: boolean;
  method: MethodInput;
  paidAt: string | null;
  notes?: string;
}) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    if (!validMethod(input.method)) return { ok: false as const, error: "Unknown method." };
    const paidAt = input.paidAt === null ? null : parseTimestamp(input.paidAt);
    if (input.paidAt !== null && !paidAt) {
      return { ok: false as const, error: "Paid-at must be a valid date." };
    }
    const data = await serializableTransaction(async (tx) => {
      const before = await tx.payment.findUniqueOrThrow({
        where: { id: input.paymentId },
        include: { week: true },
      });
      const after = await tx.payment.update({
        where: { id: input.paymentId },
        data: {
          isDeferred: input.isDeferred,
          method: input.method,
          paidAt,
          notes: input.notes?.trim() || null,
        },
      });
      // Deferral changes what is owed — replay the receipts (2.15).
      if (before.isDeferred !== input.isDeferred) {
        await rebuildParticipationPayments(tx, before.participationId);
      }
      await logAudit(tx, {
        entity: "Payment",
        entityId: input.paymentId,
        action: "update",
        summary: `Week ${before.week.weekNumber} row edited${before.isDeferred !== input.isDeferred ? ` (deferred ${before.isDeferred} -> ${input.isDeferred}; weeks recalculated)` : ""}`,
        before: { isDeferred: before.isDeferred, method: before.method, paidAt: before.paidAt, notes: before.notes },
        after: { isDeferred: after.isDeferred, method: after.method, paidAt: after.paidAt, notes: after.notes },
      });
      return after;
    });
    revalidateAdmin();
    return { ok: true as const, data };
  } catch (e) {
    console.error("updatePaymentRow failed:", e);
    return { ok: false as const, error: `Could not save. ${errorMessage(e)}` };
  }
}

/**
 * Toggle a week's deferral for one member from the grid. Deferral is a REAL
 * stored decision (2.14): the organizer excusing a week. It is never owed
 * and never counts as behind. Creates the week-payment row if none exists,
 * replays the member's receipts (deferral changes what is owed), and audits.
 * Paid/unpaid/partial/late are DERIVED and have no direct setter anywhere.
 */
export async function setWeekDeferral(input: {
  participationId: string;
  weekNumber: number;
  deferred: boolean;
}) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    if (typeof input.deferred !== "boolean") {
      return { ok: false as const, error: "Invalid value." };
    }
    const data = await serializableTransaction(async (tx) => {
      const participation = await tx.participation.findUniqueOrThrow({
        where: { id: input.participationId },
        include: { person: true },
      });
      const week = await tx.week.findUnique({
        where: {
          cycleId_weekNumber: { cycleId: participation.cycleId, weekNumber: input.weekNumber },
        },
      });
      if (!week) throw new Error(`Week ${input.weekNumber} does not exist in this cycle.`);

      const before = await tx.payment.findUnique({
        where: { weekId_participationId: { weekId: week.id, participationId: input.participationId } },
      });
      await tx.payment.upsert({
        where: { weekId_participationId: { weekId: week.id, participationId: input.participationId } },
        create: {
          weekId: week.id,
          participationId: input.participationId,
          amountPaid: 0,
          isDeferred: input.deferred,
        },
        update: { isDeferred: input.deferred },
      });
      await rebuildParticipationPayments(tx, input.participationId);
      await logAudit(tx, {
        entity: "Payment",
        entityId: before?.id ?? `${week.id}/${input.participationId}`,
        action: "update",
        summary:
          `Week ${input.weekNumber} for ${participation.person.nameEnglishFirst}: ` +
          `deferred ${before?.isDeferred ?? false} -> ${input.deferred}; receipts re-allocated`,
        before: { isDeferred: before?.isDeferred ?? false },
        after: { isDeferred: input.deferred },
      });
      return { weekNumber: input.weekNumber, deferred: input.deferred };
    });
    revalidateAdmin();
    revalidatePath("/admin/payments");
    return { ok: true as const, data };
  } catch (e) {
    console.error("setWeekDeferral failed:", e);
    return { ok: false as const, error: `Could not save. ${errorMessage(e)}` };
  }
}

/** Set or clear the note on one member's week from the grid. */
export async function setWeekNote(input: {
  participationId: string;
  weekNumber: number;
  note: string;
}) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const note = input.note?.trim() || null;
    const data = await serializableTransaction(async (tx) => {
      const participation = await tx.participation.findUniqueOrThrow({
        where: { id: input.participationId },
        include: { person: true },
      });
      const week = await tx.week.findUnique({
        where: {
          cycleId_weekNumber: { cycleId: participation.cycleId, weekNumber: input.weekNumber },
        },
      });
      if (!week) throw new Error(`Week ${input.weekNumber} does not exist in this cycle.`);
      const before = await tx.payment.findUnique({
        where: { weekId_participationId: { weekId: week.id, participationId: input.participationId } },
      });
      await tx.payment.upsert({
        where: { weekId_participationId: { weekId: week.id, participationId: input.participationId } },
        create: { weekId: week.id, participationId: input.participationId, amountPaid: 0, notes: note },
        update: { notes: note },
      });
      await logAudit(tx, {
        entity: "Payment",
        entityId: before?.id ?? `${week.id}/${input.participationId}`,
        action: "update",
        summary: `Week ${input.weekNumber} note for ${participation.person.nameEnglishFirst} ${note ? "set" : "cleared"}`,
        before: { notes: before?.notes ?? null },
        after: { notes: note },
      });
      return { weekNumber: input.weekNumber, note };
    });
    revalidateAdmin();
    revalidatePath("/admin/payments");
    return { ok: true as const, data };
  } catch (e) {
    console.error("setWeekNote failed:", e);
    return { ok: false as const, error: `Could not save the note. ${errorMessage(e)}` };
  }
}

// ————————————————— Weeks —————————————————

export async function updateWeek(input: {
  weekId: string;
  date: string;
  isSkipped: boolean;
  notes?: string;
}) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const date = parseDateInput(input.date) ?? parseTimestamp(input.date);
    if (!date) return { ok: false as const, error: "Date must be valid." };

    const data = await serializableTransaction(async (tx) => {
      const before = await tx.week.findUniqueOrThrow({ where: { id: input.weekId } });
      const after = await tx.week.update({
        where: { id: input.weekId },
        data: { date, isSkipped: input.isSkipped, notes: input.notes?.trim() || null },
      });
      // A skip-toggle changes what every member owes that week — replay all
      // receipts in the cycle (2.15; D-32 immediate recalculation).
      if (before.isSkipped !== input.isSkipped) {
        const participations = await tx.participation.findMany({
          where: { cycleId: before.cycleId },
          select: { id: true },
        });
        for (const p of participations) {
          await rebuildParticipationPayments(tx, p.id);
        }
      }
      await logAudit(tx, {
        entity: "Week",
        entityId: input.weekId,
        action: "update",
        summary: `Week ${before.weekNumber} edited${before.isSkipped !== input.isSkipped ? ` (skipped ${before.isSkipped} -> ${input.isSkipped}; all members recalculated)` : ""}`,
        before: { date: before.date, isSkipped: before.isSkipped, notes: before.notes },
        after: { date: after.date, isSkipped: after.isSkipped, notes: after.notes },
      });
      return after;
    });
    revalidateAdmin();
    revalidatePath("/admin/cycle/weeks");
    return { ok: true as const, data };
  } catch (e) {
    console.error("updateWeek failed:", e);
    return { ok: false as const, error: `Could not save. ${errorMessage(e)}` };
  }
}

// ————————————————— Draws —————————————————

export async function moveDraw(input: { drawId: string; weekId: string }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const data = await serializableTransaction(async (tx) => {
      const before = await tx.draw.findUniqueOrThrow({
        where: { id: input.drawId },
        include: { week: true },
      });
      const targetWeek = await tx.week.findUniqueOrThrow({ where: { id: input.weekId } });
      if (targetWeek.cycleId !== before.week.cycleId) {
        throw new Error("The target week belongs to a different cycle.");
      }
      // Un-settle the OLD week before moving (the winner's contribution
      // belongs to the week they actually won), then settle the new one.
      const undone = await unsettleDraw(tx, input.drawId);
      const after = await tx.draw.update({
        where: { id: input.drawId },
        data: { weekId: input.weekId },
      });
      const resettled = await settleWinnerWeeks(tx, input.drawId);
      await logAudit(tx, {
        entity: "Draw",
        entityId: input.drawId,
        action: "move",
        summary:
          `Draw moved from week ${before.week.weekNumber} to week ${targetWeek.weekNumber}` +
          (undone.count > 0
            ? `; week ${before.week.weekNumber}'s settlement (${formatMoney(undone.reversed)}) reversed`
            : "") +
          (resettled.length > 0
            ? `; week ${targetWeek.weekNumber} settled from the payout: ${resettled.map((s) => `${s.name} ${formatMoney(s.settled)}`).join(", ")}`
            : ""),
        before: { weekNumber: before.week.weekNumber },
        after: { weekNumber: targetWeek.weekNumber },
      });
      return after;
    });
    revalidateAdmin();
    revalidatePath("/admin/cycle/draws");
    return { ok: true as const, data };
  } catch (e) {
    if (isUnique(e)) {
      return {
        ok: false as const,
        error: "That week already has a winning draw — move or delete it first (one draw per week).",
      };
    }
    console.error("moveDraw failed:", e);
    return { ok: false as const, error: `Could not move the draw. ${errorMessage(e)}` };
  }
}

export async function changeDrawSlot(input: { drawId: string; slotId: string }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const data = await serializableTransaction(async (tx) => {
      const before = await tx.draw.findUniqueOrThrow({
        where: { id: input.drawId },
        include: { slot: { include: { members: { include: { luckyNumber: true } } } }, week: true },
      });
      const targetSlot = await tx.slot.findUniqueOrThrow({
        where: { id: input.slotId },
        include: { members: { include: { luckyNumber: true } } },
      });
      if (targetSlot.cycleId !== before.week.cycleId) {
        throw new Error("The target slot belongs to a different cycle.");
      }

      // SECURITY (audit C5): drawn-ness is derived from SLOT MEMBERSHIP, so
      // repointing the draw would silently return the old slot's numbers to
      // the wheel pool while their payouts stayed behind — the same member
      // could then be drawn a second time and collect twice (2.27). Payout
      // money is not something this action knows how to move, so it refuses
      // and points at the pair that does it correctly.
      const refusal = changeWinnerRefusal({
        weekNumber: before.week.weekNumber,
        payoutCount: await tx.payout.count({ where: { drawId: input.drawId } }),
        currentNumbers: before.slot.members.map((m) => m.luckyNumber.number),
      });
      if (refusal) throw new Error(refusal);

      const after = await tx.draw.update({
        where: { id: input.drawId },
        data: { slotId: input.slotId },
      });
      const numbersOf = (s: typeof targetSlot) =>
        s.members.map((m) => `#${m.luckyNumber.number}`).join(",");
      await logAudit(tx, {
        entity: "Draw",
        entityId: input.drawId,
        action: "update",
        summary: `Week ${before.week.weekNumber} winner changed: slot [${numbersOf(before.slot)}] -> [${numbersOf(targetSlot)}]`,
        before: { slotId: before.slotId, numbers: numbersOf(before.slot) },
        after: { slotId: input.slotId, numbers: numbersOf(targetSlot) },
      });
      return after;
    });
    revalidateAdmin();
    revalidatePath("/admin/cycle/draws");
    return { ok: true as const, data };
  } catch (e) {
    if (isUnique(e)) {
      return {
        ok: false as const,
        error: "That slot has already won a week — a slot can win only once per cycle.",
      };
    }
    console.error("changeDrawSlot failed:", e);
    return { ok: false as const, error: `Could not change the winner. ${errorMessage(e)}` };
  }
}

// "Delete draw but keep the payouts" no longer exists — it was the exact
// ambiguity 2.23 forbids. The two intentions are now explicit: deletePayout
// (below — the DRAW STANDS) and undoDraw in app/actions/wheel.ts (draw AND
// payouts go, numbers return to the wheel pool).

// ————————————————— Payouts —————————————————

export async function updatePayout(input: {
  payoutId: string;
  grossAmount: number;
  feeAmount: number;
  netAmount: number;
  status: "PENDING" | "COLLECTED";
  method: MethodInput;
  paidAt: string | null;
  notes?: string;
}) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    for (const [name, v] of [
      ["Gross", input.grossAmount],
      ["Fee", input.feeAmount],
      ["Net", input.netAmount],
    ] as const) {
      if (!Number.isSafeInteger(v) || v < 0 || v > MAX_MONEY_CENTS) {
        return { ok: false as const, error: `${name} must be a non-negative amount.` };
      }
    }
    if (!["PENDING", "COLLECTED"].includes(input.status)) {
      return { ok: false as const, error: "Unknown status." };
    }
    if (!validMethod(input.method)) return { ok: false as const, error: "Unknown method." };
    const paidAt = input.paidAt === null ? null : parseTimestamp(input.paidAt);
    if (input.paidAt !== null && !paidAt) {
      return { ok: false as const, error: "Paid-at must be a valid date." };
    }

    const data = await serializableTransaction(async (tx) => {
      const before = await tx.payout.findUniqueOrThrow({ where: { id: input.payoutId } });
      const after = await tx.payout.update({
        where: { id: input.payoutId },
        data: {
          grossAmount: input.grossAmount,
          feeAmount: input.feeAmount,
          netAmount: input.netAmount,
          status: input.status,
          method: input.method,
          paidAt,
          notes: input.notes?.trim() || null,
        },
      });
      await logAudit(tx, {
        entity: "Payout",
        entityId: input.payoutId,
        action: "update",
        summary: `Payout edited: net ${before.netAmount}c ${before.status} -> ${after.netAmount}c ${after.status}`,
        before: {
          grossAmount: before.grossAmount,
          feeAmount: before.feeAmount,
          netAmount: before.netAmount,
          status: before.status,
          method: before.method,
          paidAt: before.paidAt,
        },
        after: {
          grossAmount: after.grossAmount,
          feeAmount: after.feeAmount,
          netAmount: after.netAmount,
          status: after.status,
          method: after.method,
          paidAt: after.paidAt,
        },
      });
      return after;
    });
    revalidateAdmin();
    revalidatePath("/admin/collections");
    return { ok: true as const, data };
  } catch (e) {
    console.error("updatePayout failed:", e);
    return { ok: false as const, error: `Could not save. ${errorMessage(e)}` };
  }
}

/**
 * DELETE PAYOUT — the money record was wrong (2.23). The DRAW STANDS: the
 * lucky number stays drawn and does NOT return to the wheel. Any week that
 * was settled from this payout becomes owed again (the settlement receipt
 * is reversed with it — a week cannot stay covered by money whose record
 * was wrong).
 */
export async function deletePayout(input: { payoutId: string }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const data = await serializableTransaction(async (tx) => {
      const target = await tx.payout.findUniqueOrThrow({
        where: { id: input.payoutId },
        include: { luckyNumber: true, draw: { include: { week: true } } },
      });
      const { reversed } = await unsettlePayout(tx, input.payoutId);
      await tx.payout.delete({ where: { id: input.payoutId } });
      await logAudit(tx, {
        entity: "Payout",
        entityId: input.payoutId,
        action: "delete",
        summary:
          `Deleted payout for #${target.luckyNumber.number}: net ${formatMoney(target.netAmount)} (${target.status}). ` +
          `The draw stands — #${target.luckyNumber.number} stays drawn` +
          (reversed > 0 && target.draw
            ? `; week ${target.draw.week.weekNumber}'s settled ${formatMoney(reversed)} is owed again`
            : ""),
        before: {
          luckyNumber: target.luckyNumber.number,
          grossAmount: target.grossAmount,
          feeAmount: target.feeAmount,
          netAmount: target.netAmount,
          status: target.status,
          settlementReversed: reversed,
        },
      });
      return { number: target.luckyNumber.number, settlementReversed: reversed };
    });
    revalidateAdmin();
    revalidatePath("/admin/collections");
    revalidatePath("/admin/payments");
    return { ok: true as const, data };
  } catch (e) {
    console.error("deletePayout failed:", e);
    return { ok: false as const, error: `Could not delete. ${errorMessage(e)}` };
  }
}

// ————————————————— Cycle —————————————————

export async function updateCycle(input: {
  cycleId: string;
  name: string;
  startDate: string;
  plannedWeeks: number;
  unitAmount: number;
  feePercent: number;
}) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const name = input.name?.trim();
    if (!name) return { ok: false as const, error: "Name is required." };
    const startDate = parseDateInput(input.startDate);
    if (!startDate) return { ok: false as const, error: "Start date must be valid." };
    if (!Number.isSafeInteger(input.plannedWeeks) || input.plannedWeeks < 1 || input.plannedWeeks > MAX_WEEKS) {
      return { ok: false as const, error: `Planned weeks must be between 1 and ${MAX_WEEKS}.` };
    }
    if (!Number.isSafeInteger(input.unitAmount) || input.unitAmount < 1 || input.unitAmount > MAX_MONEY_CENTS) {
      return { ok: false as const, error: "Unit amount must be a positive amount." };
    }
    if (!Number.isFinite(input.feePercent) || input.feePercent < 0 || input.feePercent > 100) {
      return { ok: false as const, error: "Fee percent must be between 0 and 100." };
    }

    const data = await serializableTransaction(async (tx) => {
      const before = await tx.cycle.findUniqueOrThrow({
        where: { id: input.cycleId },
        include: { weeks: { orderBy: { weekNumber: "asc" } } },
      });

      if (input.plannedWeeks < before.plannedWeeks) {
        // Shrinking: refuse if any week being removed carries data or falls
        // inside a member's window.
        const removed = before.weeks.filter((w) => w.weekNumber > input.plannedWeeks);
        const removedIds = removed.map((w) => w.id);
        const paymentsOnRemoved = await tx.payment.count({
          where: { weekId: { in: removedIds }, OR: [{ amountPaid: { gt: 0 } }, { isDeferred: true }] },
        });
        const drawsOnRemoved = await tx.draw.count({ where: { weekId: { in: removedIds } } });
        const overlapping = await tx.participation.count({
          where: { cycleId: input.cycleId },
        });
        const participations = await tx.participation.findMany({
          where: { cycleId: input.cycleId },
          select: { startWeek: true, weeksCommitted: true },
        });
        const deepestFinish = participations.reduce(
          (max, p) => Math.max(max, calculateFinishWeek(p.startWeek, p.weeksCommitted)),
          0,
        );
        if (paymentsOnRemoved > 0 || drawsOnRemoved > 0) {
          throw new Error(
            `Weeks ${input.plannedWeeks + 1}–${before.plannedWeeks} carry payments or draws — clear them first.`,
          );
        }
        if (overlapping > 0 && deepestFinish > input.plannedWeeks) {
          throw new Error(
            `A member's commitment runs to week ${deepestFinish} — shorten those participations first.`,
          );
        }
        await tx.week.deleteMany({ where: { id: { in: removedIds } } });
      }
      const after = await tx.cycle.update({
        where: { id: input.cycleId },
        data: {
          name,
          startDate,
          plannedWeeks: input.plannedWeeks,
          unitAmount: input.unitAmount,
          feePercent: input.feePercent,
        },
      });
      if (input.plannedWeeks > before.plannedWeeks) {
        await ensureWeeksThrough(
          tx,
          { id: after.id, startDate: after.startDate, plannedWeeks: before.plannedWeeks },
          input.plannedWeeks,
        );
      }
      await logAudit(tx, {
        entity: "Cycle",
        entityId: input.cycleId,
        action: "update",
        summary:
          `Cycle "${before.name}" edited` +
          (before.plannedWeeks !== input.plannedWeeks
            ? ` (planned weeks ${before.plannedWeeks} -> ${input.plannedWeeks})`
            : "") +
          (before.startDate.getTime() !== startDate.getTime()
            ? " (start date changed — existing week dates are kept as historical facts)"
            : ""),
        before: {
          name: before.name,
          startDate: before.startDate,
          plannedWeeks: before.plannedWeeks,
          unitAmount: before.unitAmount,
          feePercent: before.feePercent,
        },
        after: {
          name: after.name,
          startDate: after.startDate,
          plannedWeeks: after.plannedWeeks,
          unitAmount: after.unitAmount,
          feePercent: after.feePercent,
        },
      });
      return after;
    });
    revalidateAdmin();
    revalidatePath("/admin/cycle/edit");
    return { ok: true as const, data };
  } catch (e) {
    console.error("updateCycle failed:", e);
    return { ok: false as const, error: `Could not save. ${errorMessage(e)}` };
  }
}

// ————————————————— Audit log —————————————————

export async function listAuditLog(limit = 200) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    // The audit log narrates everything — names, money, plans (2.4).
    if (await getSetting("presentationMode")) {
      return { ok: false as const, error: PRESENTATION_HIDDEN };
    }
    const entries = await prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(1, limit), 500),
    });
    return { ok: true as const, data: entries };
  } catch (e) {
    console.error("listAuditLog failed:", e);
    return { ok: false as const, error: `Could not load the audit log. ${errorMessage(e)}` };
  }
}
