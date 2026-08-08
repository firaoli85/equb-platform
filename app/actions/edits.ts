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
import { refuseIfCycleClosed } from "@/lib/cycle-guard";
import { deleteDrawIfEmpty, freedWeekClause, purgeEmptyWinnerPlans } from "@/lib/draw-cascade";
import {
  SETTLEMENT_EVENT_WHERE,
  settleWinnerWeeks,
  unsettleDraw,
  unsettlePayout,
} from "@/lib/draw-settlement";
import { frozenCycleRefusal } from "@/lib/cycle-close";
import { formatMoney, parseDateInput } from "@/lib/format";
import { Prisma } from "@/lib/generated/prisma/client";
import {
  chooseAutoNumbers,
  describeNumberConflict,
  reconcileWeeklyAmount,
  type NumberHolder,
} from "@/lib/lucky-numbers";
import { calculateFinishWeek, MAX_MONEY_CENTS, MAX_WEEKS } from "@/lib/money";
import {
  computeTermsSettlement,
  nameConfirmed,
  resizeWinnerWeekSettlement,
  settledSoFarFromLedger,
  settlementDescriptionPrefix,
  settlementLedgerTag,
} from "@/lib/settlement";
import {
  findNumberHolder,
  renumberHolder,
  swapNumbers,
  takenNumbers,
} from "@/lib/number-conflict";
import { reverseCarryDeduction } from "@/lib/carry-reversal";
import { weekInWindowRefusal, windowChangeRefusal } from "@/lib/participation-window";
import { duplicatePhoneRefusal, personRemovalBlockers } from "@/lib/person-record";
import { typedConfirmationRefusal } from "@/lib/typed-confirmation";
import {
  settlementReceiptAmountRefusal,
  settlementReceiptDeleteRefusal,
} from "@/lib/settlement-receipt";
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
      // A DUPLICATE PHONE MIS-AUTHENTICATES (lib/person-record.ts). Both OTP
      // doors resolve a person with findPeopleByPhone and take candidates[0]
      // from an unordered findMany, so two rows on one line means whoever
      // proves control of the number is signed in as whichever one Postgres
      // returned first.
      const others = await tx.person.findMany({
        where: { phone: { not: null } },
        select: { id: true, nameEnglishFirst: true, phone: true },
      });
      const phoneClash = duplicatePhoneRefusal({
        phone: input.phone,
        others,
        selfId: input.personId,
      });
      if (phoneClash) throw new Error(phoneClash);
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

export async function deletePerson(input: {
  personId: string;
  /** The person's name, typed by the organizer. Always required. */
  typedName?: string;
}) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const result = await serializableTransaction(async (tx) => {
      const target = await tx.person.findUniqueOrThrow({
        where: { id: input.personId },
        include: {
          _count: {
            select: {
              participations: true,
              ledgerEntries: true,
              // THE THIRD BLOCKER. MessageLog.person has no onDelete, so
              // Prisma restricts: a person who has ever been messaged — or
              // for whom a send merely FAILED, since failures are logged too
              // — cannot be deleted. This was previously discovered only as a
              // raw foreign-key error, after the organizer had typed the
              // name to confirm.
              messageLogs: true,
              signInSessions: true,
            },
          },
        },
      });
      const nameRefusal = typedConfirmationRefusal({
        typed: input.typedName,
        expected: target.nameEnglishFirst,
        whatItDoes:
          `this deletes ${target.nameEnglishFirst} from the directory along with every ` +
          `device and IP record of their sign-ins.`,
      });
      if (nameRefusal) throw new Error(nameRefusal);

      const blockers = personRemovalBlockers({
        name: target.nameEnglishFirst,
        participationCount: target._count.participations,
        ledgerEntryCount: target._count.ledgerEntries,
        carriedBalance: 0,
        messageCount: target._count.messageLogs,
        sessionCount: target._count.signInSessions,
      });
      // ALL of them at once. Three refusals one after another is not a
      // workflow — it is the product wasting the organizer's afternoon.
      if (blockers.length > 0) {
        throw new Error(blockers.map((b) => b.reason).join(" "));
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
        include: {
          cycle: true,
          // The ledger is how a settlement REMEMBERS itself (audit H4): a
          // second edit must charge only the difference, never the gap again.
          person: { include: { ledgerEntries: true } },
          luckyNumbers: { include: { payouts: true } },
        },
      });
      // Audit H5: a CLOSED cycle already wrote this member's shortfall onto
      // their carried ledger. Re-shaping their terms here would rebuild the
      // weeks AND stack a fresh settlement debt on top of that one — the same
      // money owed twice.
      const frozen = frozenCycleRefusal(before.cycle);
      if (frozen) throw new Error(frozen);
      const capError = validateCommitmentCap(before.cycle, input);
      if (capError) throw new Error(capError);

      // WHAT THE OLD WINDOW WAS CARRYING (lib/participation-window.ts).
      //
      // The cap check asks whether the new window fits the cycle. It does not
      // ask what falls OUTSIDE it — a committed winner plan the member can no
      // longer reach, or a draw they already won on a week the new window
      // excludes. Both were left stranded, and neither surfaced anywhere the
      // organizer would look.
      {
        const numberIds = before.luckyNumbers.map((n) => n.id);
        const numberOf = new Map(before.luckyNumbers.map((n) => [n.id, n.number]));

        const plans = await tx.winnerPlan.findMany({
          where: {
            cycleId: before.cycleId,
            status: "PLANNED",
            weekId: { not: null },
            numbers: { some: { luckyNumberId: { in: numberIds } } },
          },
          include: {
            numbers: { select: { luckyNumberId: true } },
            week: { select: { weekNumber: true } },
          },
        });

        const draws = await tx.draw.findMany({
          where: { slot: { members: { some: { luckyNumberId: { in: numberIds } } } } },
          include: {
            week: { select: { weekNumber: true, cycleId: true } },
            slot: { include: { members: { select: { luckyNumberId: true } } } },
          },
        });

        const refusal = windowChangeRefusal({
          memberName: before.person.nameEnglishFirst,
          startWeek: input.startWeek,
          weeksCommitted: input.weeksCommitted,
          plans: plans
            .filter((p) => p.week !== null)
            .map((p) => ({
              weekNumber: p.week!.weekNumber,
              numbers: p.numbers
                .map((n) => numberOf.get(n.luckyNumberId))
                .filter((n): n is number => n !== undefined),
            })),
          drawnWeeks: draws
            .filter((d) => d.week.cycleId === before.cycleId)
            .map((d) => ({
              weekNumber: d.week.weekNumber,
              numbers: d.slot.members
                .map((m) => numberOf.get(m.luckyNumberId))
                .filter((n): n is number => n !== undefined),
            })),
        });
        if (refusal) throw new Error(refusal);
      }

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

        // AUDIT H4 — settlement is IDEMPOTENT. terms.gap is the total
        // position against the NEW terms; the ledger already recognises what
        // earlier edits settled for this cycle. Only the DIFFERENCE is
        // actionable, so a second edit can never charge the same money twice
        // (and a reversal produces a self-cancelling credit).
        // Keyed by cycle ID, not name — a rename must never un-recognise a
        // settlement and re-charge it.
        const priorSettled = settledSoFarFromLedger(
          before.person.ledgerEntries,
          before.cycle.id,
        );
        const gap = terms.gap - priorSettled;

        if (gap !== 0 && !input.settlement) {
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
              // `gap` is what is STILL to settle now; totalGap and
              // priorSettled let the step explain why they differ.
              gap,
              totalGap: terms.gap,
              priorSettled,
            },
          };
        }

        if (gap !== 0 && input.settlement) {
          if (!nameConfirmed(input.settlement.typedName, before.person)) {
            throw new Error(
              `Type ${before.person.nameEnglishFirst}'s name exactly to confirm the settlement — nothing was saved.`,
            );
          }
          const prefix = settlementDescriptionPrefix(before.cycle.name);
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
              // The WHOLE obligation is recognised as a DEBT and the cash is
              // recorded as a PAYMENT against it (2.18: the ledger keeps the
              // story, and the running total is still just the remainder).
              // Writing only the remainder would under-recognise the
              // settlement and let the next edit charge the returned cash
              // all over again.
              await tx.ledgerEntry.create({
                data: {
                  personId: before.personId,
                  type: "DEBT",
                  amount: gap,
                  description: `${prefix} terms cut after payout — ${formatMoney(gap)} held beyond the new entitlement`,
                  notes: settlementLedgerTag(before.cycle.id, "debt"),
                },
              });
              await tx.ledgerEntry.create({
                data: {
                  personId: before.personId,
                  type: "PAYMENT",
                  amount: returned,
                  description: `${prefix} returned ${formatMoney(returned)} in cash`,
                  notes: settlementLedgerTag(before.cycle.id, "returned"),
                },
              });
              settlementSummary = `returned ${formatMoney(returned)}${remainder > 0 ? `, ${formatMoney(remainder)} left on the carried ledger` : " — settled in full"}`;
            } else if (choice === "ledger") {
              await tx.ledgerEntry.create({
                data: {
                  personId: before.personId,
                  type: "DEBT",
                  amount: gap,
                  description: `${prefix} terms cut after payout — nothing returned, ${formatMoney(gap)} owed`,
                  notes: settlementLedgerTag(before.cycle.id, "debt"),
                },
              });
              settlementSummary = `nothing returned — ${formatMoney(gap)} to the carried ledger (2.18)`;
            } else {
              throw new Error("They hold too much — choose how the excess is settled.");
            }
          } else {
            // gap < 0: the new terms entitle them to MORE than the books
            // currently recognise — including the case where an earlier
            // settlement is now (partly) undone by editing back.
            if (choice === "credit") {
              await tx.ledgerEntry.create({
                data: {
                  personId: before.personId,
                  type: "PAYMENT",
                  amount: -gap,
                  description: `${prefix} terms increased after payout — ${formatMoney(-gap)} owed TO them (offsets carried debt)`,
                  notes: settlementLedgerTag(before.cycle.id, "credit"),
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
            ` TERMS SETTLEMENT: received ${formatMoney(alreadyReceived)}, new entitlement ${formatMoney(terms.newEntitlementNet)}` +
            `, total gap ${formatMoney(Math.abs(terms.gap))}` +
            (priorSettled !== 0
              ? `, ${formatMoney(Math.abs(priorSettled))} already settled earlier, ${formatMoney(Math.abs(gap))} settled now`
              : `, gap ${formatMoney(Math.abs(gap))}`) +
            ` — ${settlementSummary}.`;
        }
      }

      // A settled win-week's receipt was sized at the OLD weekly. A cheaper
      // week can no longer absorb it, so the settlement is resized to the new
      // cost — and the DIFFERENCE GOES BACK ONTO THE PAYOUT it came out of
      // (audit H4). Without that credit the cash simply disappeared from the
      // books: "already received" then read low, and every later gap was
      // computed against a false total. Money always lands somewhere the
      // system remembers (2.14).
      if (payouts.length > 0 && before.weeklyAmount !== input.weeklyAmount) {
        const pinned = await tx.paymentEvent.findMany({
          where: { participationId: before.id, ...SETTLEMENT_EVENT_WHERE },
        });
        for (const event of pinned) {
          // The payout is read FIRST because a week that grew has to be funded
          // out of it, and a payout cannot fund more than it holds.
          const payout = event.settlementPayoutId
            ? await tx.payout.findUnique({ where: { id: event.settlementPayoutId } })
            : null;
          const { resized, credit, refusal } = resizeWinnerWeekSettlement(
            event.amount,
            input.weeklyAmount,
            payout?.netAmount,
          );
          if (refusal) throw new Error(refusal);
          if (credit === 0) continue;
          if (resized === 0) await tx.paymentEvent.delete({ where: { id: event.id } });
          else await tx.paymentEvent.update({ where: { id: event.id }, data: { amount: resized } });
          if (payout) {
            await tx.payout.update({
              where: { id: payout.id },
              data: { netAmount: { increment: credit } },
            });
          }
          settlementSummary +=
            ` Win-week settlement resized ${formatMoney(event.amount)} → ${formatMoney(resized)} to fit the new weekly` +
            (credit > 0
              ? `; ${formatMoney(credit)} credited back to the payout.`
              : `; ${formatMoney(-credit)} taken from the payout to fund the dearer week.`);
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

/**
 * REMOVE SOMEONE FROM A CYCLE — as if they had never been in it.
 *
 * This was a bare cascade delete. Prisma took their lucky numbers, payouts,
 * slot memberships, plan numbers, week rows, receipts and allocations, and
 * left FOUR things behind (mapped in lib/participation-removal.ts):
 *
 *   1. their DRAW, holding no payouts and an emptied slot — the week counted
 *      as drawn forever, un-redrawable
 *   2. the SLOT, occupying its @@unique([cycleId, position]) seat with nobody
 *      in it, and unreachable from the wheel UI (saveSlots refuses to delete a
 *      slot that has a draw)
 *   3. their WINNER PLAN with ZERO numbers — which silently rigs the next
 *      draw, because `[].every(...)` is true
 *   4. their SETTLEMENT RECEIPTS, whose payout FK is SetNull on delete, so
 *      money stayed credited to weeks with no payout behind it
 *
 * Each is now swept inside the same transaction, before the derived figures
 * are read again.
 */
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
          luckyNumbers: {
            include: {
              payouts: { select: { id: true, drawId: true, netAmount: true, status: true } },
            },
          },
          _count: { select: { luckyNumbers: true, payments: true, paymentEvents: true } },
        },
      });
      // Audit H5: a closed cycle's books are frozen and its carried ledgers
      // were computed from exactly these receipts and payouts.
      const frozen = frozenCycleRefusal(target.cycle);
      if (frozen) throw new Error(frozen);

      // 1. Reverse every settlement their payouts funded BEFORE the cascade
      //    nulls the FK — otherwise the receipt survives as money credited to
      //    a week with no payout behind it.
      const payouts = target.luckyNumbers.flatMap((n) => n.payouts);
      let reversed = 0;
      for (const payout of payouts) {
        const result = await unsettlePayout(tx, payout.id);
        await reverseCarryDeduction(tx, payout.id, "the payout was removed");
        reversed += result.reversed;
      }

      // 2. Remember which draws they were part of, so an emptied one can be
      //    removed after the cascade has taken their payouts and slot rows.
      const drawIds = [...new Set(payouts.map((p) => p.drawId).filter((id): id is string => id !== null))];
      const slotMembers = await tx.slotMember.findMany({
        where: { luckyNumberId: { in: target.luckyNumbers.map((n) => n.id) } },
        include: { slot: { include: { draws: { select: { id: true } } } } },
      });
      for (const m of slotMembers) {
        for (const d of m.slot.draws) if (!drawIds.includes(d.id)) drawIds.push(d.id);
      }
      const vacatedSlotIds = [...new Set(slotMembers.map((m) => m.slotId))];

      await tx.participation.delete({ where: { id: input.participationId } });

      // 3. Sweep the orphans the cascade cannot reach.
      const freedWeeks: number[] = [];
      const returnedNumbers: number[] = [];
      for (const drawId of drawIds) {
        const freed = await deleteDrawIfEmpty(tx, drawId);
        if (freed.deleted) {
          freedWeeks.push(freed.weekNumber);
          returnedNumbers.push(...freed.numbersReturning);
        }
      }
      const plans = await purgeEmptyWinnerPlans(tx, target.cycleId);
      // Slots emptied by the cascade that never had a draw of their own.
      const releasedSlots = await tx.slot.deleteMany({
        where: { id: { in: vacatedSlotIds }, members: { none: {} }, draws: { none: {} } },
      });

      await logAudit(tx, {
        entity: "Participation",
        entityId: input.participationId,
        action: "delete",
        summary:
          `Removed ${target.person.nameEnglishFirst} from ${target.cycle.name} ` +
          `(deleted ${target._count.luckyNumbers} lucky numbers, ${target._count.payments} week rows, ${target._count.paymentEvents} receipts` +
          (payouts.length > 0
            ? `, ${payouts.length} payout(s) totalling ${formatMoney(payouts.reduce((s, p) => s + p.netAmount, 0))}`
            : "") +
          `)` +
          (reversed > 0
            ? `. ${formatMoney(reversed)} of win-week settlement reversed first, so no receipt is left crediting a week with no payout behind it`
            : "") +
          (freedWeeks.length > 0
            ? `. Week${freedWeeks.length === 1 ? "" : "s"} ${freedWeeks.join(", ")} held no other winner, so ` +
              `${freedWeeks.length === 1 ? "its draw was" : "their draws were"} removed and ` +
              `${freedWeeks.length === 1 ? "it is" : "they are"} UNDRAWN again` +
              (returnedNumbers.length > 0
                ? ` (${returnedNumbers.sort((a, b) => a - b).map((n) => `#${n}`).join(", ")} back in the pool)`
                : "")
            : "") +
          (plans.purged > 0
            ? `. ${plans.purged} winner plan(s) left with no numbers were deleted — an empty plan rigs the next draw`
            : "") +
          (releasedSlots.count > 0 ? `. ${releasedSlots.count} emptied wheel slot(s) released` : ""),
        before: {
          personId: target.personId,
          weeklyAmount: target.weeklyAmount,
          startWeek: target.startWeek,
          weeksCommitted: target.weeksCommitted,
          payouts: payouts.map((p) => ({ netAmount: p.netAmount, status: p.status })),
          settlementReversed: reversed,
        },
      });
      return {
        name: target.person.nameEnglishFirst,
        cycle: target.cycle.name,
        settlementReversed: reversed,
        weeksFreed: freedWeeks,
        plansPurged: plans.purged,
      };
    });
    revalidateAdmin();
    revalidatePath("/admin/collections");
    revalidatePath("/admin/wheel");
    revalidatePath("/admin/wheel/setup");
    revalidatePath("/admin/cycle/draws");
    revalidatePath("/admin/payments");
    revalidatePath("/admin");
    return { ok: true as const, data };
  } catch (e) {
    console.error("removeParticipation failed:", e);
    return { ok: false as const, error: `Could not remove. ${errorMessage(e)}` };
  }
}

// ————————————————— Lucky numbers —————————————————
//
// A NUMBER ALREADY IN USE IS A CHOICE, NOT A DEAD END (organizer's ruling).
// Both entry points used to answer "Number 22 is already taken in this cycle"
// — true, and useless: it never said WHO had it, and left nothing to do but
// guess again. Now the holder is named and two real options are offered:
//
//   REPLACE — the number belongs to THIS member. The current holder is
//             renumbered: onto the number being vacated when there is one (a
//             true swap, so nobody ends up without a number), otherwise onto
//             the next free value. Refused when their number is drawn or
//             carries a payout, because that number IS the record of a week
//             they won.
//   KEEP    — the number stays where it is, and the reply names the free
//             number to use instead.
//
// Nothing happens without the organizer choosing, and no path can duplicate:
// @@unique([cycleId, number]) is the durable backstop under all of it.

// findNumberHolder / takenNumbers / renumberHolder now live in
// lib/number-conflict.ts — the add-member wizard needs the identical rule, and
// a rule that lives in one action file is a rule the next path will not have.

export async function updateLuckyNumber(input: {
  luckyNumberId: string;
  number: number;
  amount: number;
  /** The organizer's answer to a conflict. Absent = ask, never assume. */
  onConflict?: "replace";
}) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    if (!Number.isSafeInteger(input.number) || input.number < 1) {
      return { ok: false as const, error: "Lucky number must be a positive whole number." };
    }
    if (!Number.isSafeInteger(input.amount) || input.amount < 1 || input.amount > MAX_MONEY_CENTS) {
      return { ok: false as const, error: "Amount must be a positive amount." };
    }
    const outcome = await serializableTransaction(async (tx) => {
      // 2.9/2.14: a CLOSED cycle's books are final. Resolved through
      // lib/cycle-guard so the check is one line and cannot be skipped
      // for want of plumbing — which is how 14 actions lost it.
      await refuseIfCycleClosed(tx, { luckyNumberId: input.luckyNumberId });
      const before = await tx.luckyNumber.findUniqueOrThrow({
        where: { id: input.luckyNumberId },
        include: { participation: { include: { person: true } } },
      });
      let amountNote = "";

      // THE AMOUNT IS A SLICE, NOT A FIGURE OF ITS OWN.
      //
      // This wrote any amount from 1 to MAX_MONEY_CENTS and touched nothing
      // else. Editing a $250 number to $2,500 in a 20-week cycle turned a
      // $5,000 gross into a $50,000 gross — calculatePayout is
      // amount x weeksCommitted — while the member still owed $250 a week.
      // Money out that nobody funded.
      //
      // The SAME reconciliation addLuckyNumber and deleteLuckyNumber already
      // use: the numbers and the weekly move together, or the edit is
      // refused. A second mechanism here would be a second answer to one
      // question.
      if (before.amount !== input.amount) {
        const siblings = await tx.luckyNumber.findMany({
          where: { participationId: before.participationId },
          select: { id: true, amount: true },
        });
        const payoutCount = await tx.payout.count({
          where: { luckyNumber: { participationId: before.participationId } },
        });
        const reconciliation = reconcileWeeklyAmount({
          memberName: before.participation.person.nameEnglishFirst,
          storedWeekly: before.participation.weeklyAmount,
          numberAmounts: siblings.map((sib) =>
            sib.id === before.id ? input.amount : sib.amount,
          ),
          payoutCount,
        });
        if (reconciliation.refusal) return { refusal: reconciliation.refusal };
        if (reconciliation.changed) {
          await tx.participation.update({
            where: { id: before.participationId },
            data: { weeklyAmount: reconciliation.impliedWeekly },
          });
          await rebuildParticipationPayments(tx, before.participationId);
          amountNote = ` ${reconciliation.sentence}`;
        }
      }

      let swapNote = "";
      // The swap already wrote the number; the final update must not write it
      // again from stale state.
      let swapped = false;
      if (before.number !== input.number) {
        const holder = await findNumberHolder(tx, {
          cycleId: before.cycleId,
          number: input.number,
          excludeLuckyNumberId: input.luckyNumberId,
        });
        if (holder) {
          const taken = await takenNumbers(tx, before.cycleId);
          // The number being vacated is the swap partner: it comes free the
          // moment this edit lands, so it is not "taken" for the holder.
          taken.delete(before.number);
          const conflict = describeNumberConflict({
            number: input.number,
            holder,
            taken,
            vacating: before.number,
          });
          if (input.onConflict !== "replace" || conflict.replaceRefusal) {
            return { conflict };
          }
          // A TRUE SWAP — three statements, not two. The old code moved the
          // holder onto `before.number` while this row still held it, so the
          // unique index refused every single REPLACE and the organizer was
          // shown "already taken" after choosing to take it.
          await swapNumbers(tx, {
            cycleId: before.cycleId,
            moving: { luckyNumberId: input.luckyNumberId, from: before.number },
            holder,
          });
          swapped = true;
          swapNote =
            ` ${holder.memberName} held #${input.number} and took #${before.number} ` +
            `in the swap, by the organizer's REPLACE choice.`;
        }
      }

      const after = await tx.luckyNumber.update({
        where: { id: input.luckyNumberId },
        // The swap already moved the number; writing it again is harmless but
        // stating it here keeps the non-swap path honest.
        data: swapped ? { amount: input.amount } : { number: input.number, amount: input.amount },
      });
      await logAudit(tx, {
        entity: "LuckyNumber",
        entityId: input.luckyNumberId,
        action: "update",
        summary:
          `Lucky number #${before.number} (${before.amount}c) -> #${after.number} (${after.amount}c) ` +
          `for ${before.participation.person.nameEnglishFirst}.${swapNote}${amountNote}`,
        before: { number: before.number, amount: before.amount },
        after: { number: after.number, amount: after.amount },
      });
      return { after };
    });

    // The conflict is a REFUSAL carrying the choice, not a failure: the
    // transaction rolled back and nothing was written.
    // A refusal is not a crash: the transaction rolled back and the reason
    // is the organizer’s to read, not a stack trace.
    if (outcome.refusal) return { ok: false as const, error: outcome.refusal };
    const conflict = outcome.conflict ?? null;
    if (conflict) return { ok: false as const, error: conflict.message, conflict };
    revalidateAdmin();
    revalidatePath("/admin/wheel");
    revalidatePath("/admin/wheel/setup");
    return { ok: true as const, data: outcome.after };
  } catch (e) {
    if (isUnique(e)) {
      return { ok: false as const, error: `Number ${input.number} is already taken in this cycle.` };
    }
    console.error("updateLuckyNumber failed:", e);
    return { ok: false as const, error: `Could not save. ${errorMessage(e)}` };
  }
}

export async function addLuckyNumber(input: {
  participationId: string;
  number: number;
  amount: number;
  /** The organizer's answer to a conflict. Absent = ask, never assume. */
  onConflict?: "replace";
}) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    if (!Number.isSafeInteger(input.number) || input.number < 1) {
      return { ok: false as const, error: "Lucky number must be a positive whole number." };
    }
    if (!Number.isSafeInteger(input.amount) || input.amount < 1 || input.amount > MAX_MONEY_CENTS) {
      return { ok: false as const, error: "Amount must be a positive amount." };
    }
    const outcome = await serializableTransaction(async (tx) => {
      // 2.9/2.14: a CLOSED cycle's books are final. Resolved through
      // lib/cycle-guard so the check is one line and cannot be skipped
      // for want of plumbing — which is how 14 actions lost it.
      await refuseIfCycleClosed(tx, { participationId: input.participationId });
      const participation = await tx.participation.findUniqueOrThrow({
        where: { id: input.participationId },
        include: { person: true },
      });


      let swapNote = "";
      const holder = await findNumberHolder(tx, {
        cycleId: participation.cycleId,
        number: input.number,
      });
      if (holder) {
        const conflict = describeNumberConflict({
          number: input.number,
          holder,
          taken: await takenNumbers(tx, participation.cycleId),
          // An ADD vacates nothing, so there is no swap partner: the holder
          // moves to the next free number.
          vacating: null,
        });
        if (input.onConflict !== "replace" || conflict.replaceRefusal) {
          return { conflict };
        }
        // RESERVE the number being added. Without it the holder is renumbered
        // to "the next free value" — which, the instant they vacate, is the
        // contested number itself, so they land straight back on it.
        const landedOn = await renumberHolder(tx, {
          cycleId: participation.cycleId,
          holder,
          reserve: [input.number],
        });
        swapNote =
          ` ${holder.memberName} held #${input.number} and was moved to #${landedOn} ` +
          `by the organizer's REPLACE choice.`;
      }

      // MONEY OUT WITH NO MONEY IN. A number's amount IS a slice of the
      // member's weekly contribution, and every payout is priced per number —
      // so adding one raised their entitlement while their weekly bill, read
      // from participation.weeklyAmount, never moved. The contribution is
      // reconciled to what their numbers now add up to, or refused outright
      // when a payout already exists and the difference is a settlement.
      const existingAmounts = await tx.luckyNumber.findMany({
        where: { participationId: input.participationId },
        select: { amount: true },
      });
      const payoutCount = await tx.payout.count({
        where: { luckyNumber: { participationId: input.participationId } },
      });
      const reconciliation = reconcileWeeklyAmount({
        memberName: participation.person.nameEnglishFirst,
        storedWeekly: participation.weeklyAmount,
        numberAmounts: [...existingAmounts.map((n) => n.amount), input.amount],
        payoutCount,
      });
      if (reconciliation.refusal) return { refusal: reconciliation.refusal };

      const created = await tx.luckyNumber.create({
        data: {
          participationId: input.participationId,
          cycleId: participation.cycleId,
          number: input.number,
          amount: input.amount,
        },
      });
      if (reconciliation.changed) {
        await tx.participation.update({
          where: { id: input.participationId },
          data: { weeklyAmount: reconciliation.impliedWeekly },
        });
        // Their weekly bill changed, so every week they have paid re-allocates
        // against it (2.15). Without this the grid keeps the old shape.
        await rebuildParticipationPayments(tx, input.participationId);
      }
      await logAudit(tx, {
        entity: "LuckyNumber",
        entityId: created.id,
        action: "create",
        summary:
          `Added lucky number #${created.number} (${created.amount}c) for ` +
          `${participation.person.nameEnglishFirst}.${swapNote}` +
          (reconciliation.sentence ? ` ${reconciliation.sentence}` : ""),
        after: {
          number: created.number,
          amount: created.amount,
          weeklyAmountBefore: participation.weeklyAmount,
          weeklyAmountAfter: reconciliation.impliedWeekly,
        },
      });
      return { created };
    });

    // The conflict is a REFUSAL carrying the choice, not a failure: the
    // transaction rolled back and nothing was written.
    // A refusal is not a crash: the transaction rolled back and the reason
    // is the organizer’s to read, not a stack trace.
    if (outcome.refusal) return { ok: false as const, error: outcome.refusal };
    const conflict = outcome.conflict ?? null;
    if (conflict) return { ok: false as const, error: conflict.message, conflict };
    // The contribution refusal is the same shape: the transaction rolled back,
    // so nothing was written and the reason names where to go instead.
    if (outcome.refusal) return { ok: false as const, error: outcome.refusal };
    revalidateAdmin();
    revalidatePath("/admin/wheel");
    revalidatePath("/admin/wheel/setup");
    revalidatePath("/admin/payments");
    return { ok: true as const, data: outcome.created };
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
      // 2.9/2.14: a CLOSED cycle's books are final. Resolved through
      // lib/cycle-guard so the check is one line and cannot be skipped
      // for want of plumbing — which is how 14 actions lost it.
      await refuseIfCycleClosed(tx, { luckyNumberId: input.luckyNumberId });
      const target = await tx.luckyNumber.findUniqueOrThrow({
        where: { id: input.luckyNumberId },
        include: {
          slotMembers: { select: { slotId: true } },
          _count: { select: { payouts: true, slotMembers: true, planNumbers: true } },
        },
      });
      if (target._count.payouts > 0) {
        throw new Error(
          `#${target.number} has ${target._count.payouts} payout record(s) — delete those first so no money record is lost.`,
        );
      }
      // The mirror of addLuckyNumber: a number's amount is a SLICE of the
      // member's weekly contribution, so removing one leaves the stored weekly
      // higher than their numbers add up to — they keep being billed for a
      // number they no longer hold. Reconciled, or refused when it would
      // leave them with nothing.
      const participation = await tx.participation.findUniqueOrThrow({
        where: { id: target.participationId },
        include: { person: true, luckyNumbers: { select: { id: true, amount: true } } },
      });
      const reconciliation = reconcileWeeklyAmount({
        memberName: participation.person.nameEnglishFirst,
        storedWeekly: participation.weeklyAmount,
        numberAmounts: participation.luckyNumbers
          .filter((n) => n.id !== input.luckyNumberId)
          .map((n) => n.amount),
        // Their OTHER numbers' payouts: this number's own are already refused
        // above, and a drawn member's entitlement change is a settlement.
        payoutCount: await tx.payout.count({
          where: {
            luckyNumber: { participationId: target.participationId },
            luckyNumberId: { not: input.luckyNumberId },
          },
        }),
      });
      if (reconciliation.refusal) throw new Error(reconciliation.refusal);

      const vacatedSlotIds = target.slotMembers.map((m) => m.slotId);
      await tx.luckyNumber.delete({ where: { id: input.luckyNumberId } });
      if (reconciliation.changed) {
        await tx.participation.update({
          where: { id: target.participationId },
          data: { weeklyAmount: reconciliation.impliedWeekly },
        });
        await rebuildParticipationPayments(tx, target.participationId);
      }

      // WinnerPlanNumber cascades with the number. A plan left with NO numbers
      // matches the first eligible slot (`[].every(...)` is true) and silently
      // decides the next draw — so it goes with it rather than lying in wait.
      const plans = await purgeEmptyWinnerPlans(tx, target.cycleId);
      // A slot the number vacated, now empty and winning nothing, is released
      // so it stops holding its position seat.
      const releasedSlots = await tx.slot.deleteMany({
        where: { id: { in: vacatedSlotIds }, members: { none: {} }, draws: { none: {} } },
      });

      await logAudit(tx, {
        entity: "LuckyNumber",
        entityId: input.luckyNumberId,
        action: "delete",
        summary:
          `Deleted lucky number #${target.number} (${target.amount}c)` +
          (target._count.planNumbers > 0
            ? `; it was committed to ${target._count.planNumbers} winner plan(s)`
            : "") +
          (plans.purged > 0
            ? `. ${plans.purged} winner plan(s) left with no numbers were deleted — an empty plan rigs the next draw`
            : "") +
          (releasedSlots.count > 0 ? `. ${releasedSlots.count} emptied wheel slot(s) released` : "") +
          (reconciliation.sentence ? ` ${reconciliation.sentence}` : ""),
        before: {
          number: target.number,
          amount: target.amount,
          weeklyAmountBefore: participation.weeklyAmount,
          weeklyAmountAfter: reconciliation.impliedWeekly,
        },
      });
      return { number: target.number, plansPurged: plans.purged };
    });
    revalidateAdmin();
    revalidatePath("/admin/wheel");
    revalidatePath("/admin/wheel/setup");
    revalidatePath("/admin/payments");
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
      const before = await tx.paymentEvent.findUniqueOrThrow({
        where: { id: input.eventId },
        include: { participation: { include: { cycle: true } } },
      });
      // Audit H5: rewriting a receipt replays every week of the member's
      // window — on a CLOSED cycle that moves money the frozen ledger has
      // already accounted for.
      const frozen = frozenCycleRefusal(before.participation.cycle);
      if (frozen) throw new Error(frozen);

      // A settlement receipt is half of a pair with the payout it came out of
      // (lib/settlement-receipt.ts). Shrinking one half here destroyed the
      // difference: `allocatePinned` accepts any amount at or below the week,
      // so no error fired, and nothing credited the payout back. A $500
      // settlement edited to $0.01 lost $499.99 with the payout still down the
      // full $500. The description fields stay editable.
      const amountRefusal = settlementReceiptAmountRefusal({
        receipt: before,
        amountBefore: before.amount,
        amountAfter: input.amount,
      });
      if (amountRefusal) throw new Error(amountRefusal);

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
      const target = await tx.paymentEvent.findUniqueOrThrow({
        where: { id: input.eventId },
        include: { participation: { include: { cycle: true } } },
      });
      // Audit H5: deleting a receipt removes money from a CLOSED cycle whose
      // carried-ledger balances were computed with it.
      const frozen = frozenCycleRefusal(target.participation.cycle);
      if (frozen) throw new Error(frozen);

      // A SETTLEMENT receipt is not ordinary money — it is the winner's own
      // week taken out of their payout, and the payout's netAmount was
      // DECREMENTED by exactly this amount when it was created. Deleting it
      // without putting that back charges the member twice. The rule and its
      // reasoning live in lib/settlement-receipt.ts, shared with the edit path.
      const deleteRefusal = settlementReceiptDeleteRefusal(target);
      if (deleteRefusal) throw new Error(deleteRefusal);

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
        include: { week: { include: { cycle: true } } },
      });
      // Audit H5: this flips isDeferred — the same money-affecting change
      // setWeekDeferral is guarded for, reachable from a second action.
      const frozen = frozenCycleRefusal(before.week.cycle);
      if (frozen) throw new Error(frozen);
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
        include: { person: true, cycle: true },
      });
      // Audit H5, same class as recording: a deferral changes what a week
      // OWES, and a closed cycle's shortfalls are already fixed on the
      // carried ledger — flipping one here would leave two different debts
      // for the same money. (Week NOTES stay editable: they touch no money.)
      const frozen = frozenCycleRefusal(participation.cycle);
      if (frozen) throw new Error(frozen);
      // THE WEEK MUST BE THEIRS.
      //
      // This resolved the week by (cycleId, weekNumber) — any week of the
      // cycle — and upserted a Payment row for it, while the member's own
      // startWeek and weeksCommitted sat loaded and unread. The stray row
      // then survives everything: rebuildParticipationPayments only writes
      // to in-window rows, so it never deletes it; the grid renders that
      // week as before-start or after-finish, so it is invisible and
      // unreachable through the UI that made it; and extending the member
      // later resurrects it.
      {
        const outside = weekInWindowRefusal({
          memberName: participation.person.nameEnglishFirst,
          weekNumber: input.weekNumber,
          startWeek: participation.startWeek,
          weeksCommitted: participation.weeksCommitted,
          what: "deferring a week",
        });
        if (outside) throw new Error(outside);
      }
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
      // 2.9/2.14: a CLOSED cycle's books are final. Resolved through
      // lib/cycle-guard so the check is one line and cannot be skipped
      // for want of plumbing — which is how 14 actions lost it.
      await refuseIfCycleClosed(tx, { participationId: input.participationId });
      const participation = await tx.participation.findUniqueOrThrow({
        where: { id: input.participationId },
        include: { person: true },
      });
      // THE WEEK MUST BE THEIRS.
      //
      // This resolved the week by (cycleId, weekNumber) — any week of the
      // cycle — and upserted a Payment row for it, while the member's own
      // startWeek and weeksCommitted sat loaded and unread. The stray row
      // then survives everything: rebuildParticipationPayments only writes
      // to in-window rows, so it never deletes it; the grid renders that
      // week as before-start or after-finish, so it is invisible and
      // unreachable through the UI that made it; and extending the member
      // later resurrects it.
      {
        const outside = weekInWindowRefusal({
          memberName: participation.person.nameEnglishFirst,
          weekNumber: input.weekNumber,
          startWeek: participation.startWeek,
          weeksCommitted: participation.weeksCommitted,
          what: "a note",
        });
        if (outside) throw new Error(outside);
      }
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
      const before = await tx.week.findUniqueOrThrow({
        where: { id: input.weekId },
        include: { cycle: true },
      });
      // Audit H5: toggling isSkipped rebuilds EVERY participation in the
      // cycle — on a CLOSED cycle that desyncs every frozen ledger entry the
      // close wrote, in one call.
      const frozen = frozenCycleRefusal(before.cycle);
      if (frozen) throw new Error(frozen);
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
        include: { week: { include: { cycle: true } } },
      });
      const targetWeek = await tx.week.findUniqueOrThrow({ where: { id: input.weekId } });
      if (targetWeek.cycleId !== before.week.cycleId) {
        throw new Error("The target week belongs to a different cycle.");
      }
      // Audit H5: moving a draw re-runs settleWinnerWeeks, which CREATES a
      // PaymentEvent on the target week — recording money onto a closed
      // cycle, the exact act the refusal forbids.
      const frozen = frozenCycleRefusal(before.week.cycle);
      if (frozen) throw new Error(frozen);
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
      // 2.9/2.14: a CLOSED cycle's books are final. Resolved through
      // lib/cycle-guard so the check is one line and cannot be skipped
      // for want of plumbing — which is how 14 actions lost it.
      await refuseIfCycleClosed(tx, { drawId: input.drawId });
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
      // 2.9/2.14: a CLOSED cycle's books are final. Resolved through
      // lib/cycle-guard so the check is one line and cannot be skipped
      // for want of plumbing — which is how 14 actions lost it.
      await refuseIfCycleClosed(tx, { payoutId: input.payoutId });
      const before = await tx.payout.findUniqueOrThrow({ where: { id: input.payoutId } });

      // THE SETTLEMENT PAIR WAS ONE-SIDED.
      //
      // When the winner's own week was settled from this payout, netAmount was
      // DECREMENTED by exactly the amount of a PaymentEvent that credits that
      // week. lib/settlement-receipt.ts refuses any amount edit on that
      // receipt and says so — and this action had no settlement awareness at
      // all, so the other half was freely editable.
      //
      // The sequence that invents money: gross $1,000, fee $20, own week $500,
      // so netAmount is stored as $480. Collections shows "$1,000 gross · $20
      // fee · week N contribution $500 deducted" with the net field reading
      // 480. The organizer corrects the gross to $1,100 and, computing net as
      // gross − fee, types 1080. Week N is still credited $500 from a payout
      // that no longer carries the deduction: they are handed the full net AND
      // have that week paid. $500 out of nowhere, and every downstream figure
      // — the archive, the cash position, updateParticipation's
      // `alreadyReceived` — inherits it.
      const settlements = await tx.paymentEvent.findMany({
        where: { settlementPayoutId: input.payoutId },
        select: { amount: true, pinnedWeek: { select: { weekNumber: true } } },
      });
      const settled = settlements.reduce((sum, s) => sum + s.amount, 0);
      const moneyChanged =
        before.grossAmount !== input.grossAmount ||
        before.feeAmount !== input.feeAmount ||
        before.netAmount !== input.netAmount;
      if (settled > 0 && moneyChanged) {
        const weeks = settlements
          .map((s) => s.pinnedWeek?.weekNumber)
          .filter((w): w is number => w !== undefined)
          .sort((a, b) => a - b);
        return {
          refusal:
            `This payout already has ${formatMoney(settled)} deducted from it for ` +
            `${weeks.length === 1 ? `week ${weeks[0]}` : `weeks ${weeks.join(", ")}`} — the ` +
            `winner does not pay the week they win, and that deduction is a receipt crediting ` +
            `that week. Editing the figures here would move one half of the pair and leave the ` +
            `other, inventing ${formatMoney(settled)}. Change their weekly amount on the ` +
            `participation instead: it resizes the settlement and moves the payout with it. ` +
            `Status, method, paid-on and notes can still be corrected here.`,
        };
      }

      const after = await tx.payout.update({
        where: { id: input.payoutId },
        data: {
          grossAmount: input.grossAmount,
          feeAmount: input.feeAmount,
          netAmount: input.netAmount,
          status: input.status,
          method: input.method,
          paidAt,
          // AN OMITTED FIELD IS NOT AN INSTRUCTION TO ERASE.
          //
          // This read `input.notes?.trim() || null`, so a caller that does not
          // send notes cleared the column. The Waiting screen's "Mark
          // collected" sends gross, fee, net, status, method and paidAt and no
          // notes — its row type has no notes field — so one click there
          // silently destroyed whatever the organizer had written. The same
          // button on Collections passes them through and preserved it: the
          // same logical action lost data on one screen and not the other.
          ...(input.notes === undefined ? {} : { notes: input.notes.trim() || null }),
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
      return { payout: after };
    });
    // A refusal is a rolled-back transaction carrying a reason, not a crash.
    if ("refusal" in data && data.refusal) {
      return { ok: false as const, error: data.refusal };
    }
    revalidateAdmin();
    revalidatePath("/admin/collections");
    return { ok: true as const, data: data.payout! };
  } catch (e) {
    console.error("updatePayout failed:", e);
    return { ok: false as const, error: `Could not save. ${errorMessage(e)}` };
  }
}

/**
 * DELETE PAYOUT — the money record was wrong (2.23). The DRAW STANDS while
 * the week still has another winner: the lucky number stays drawn and does
 * NOT return to the wheel. Any week that was settled from this payout becomes
 * owed again (the settlement receipt is reversed with it — a week cannot stay
 * covered by money whose record was wrong).
 *
 * THE ONE EXCEPTION, and the reason it exists. If this was the week's LAST
 * payout there is no draw left to stand: the row would record a win holding
 * nothing, and that half-state is what stranded weeks 1 and 6 — counted as
 * drawn, showing no amount in any picker, impossible to assign to, and
 * un-redrawable because `Draw.@@unique([weekId])` refuses a second one. So the
 * empty draw is deleted with it and the week becomes genuinely UNDRAWN, its
 * slot numbers back in the pool. The caller is told which happened, and the
 * confirmation dialog states it before anything runs.
 */
export async function deletePayout(input: {
  payoutId: string;
  /**
   * The member's name, typed by the organizer. REQUIRED once the payout
   * is COLLECTED — the money is gone and this row is the only record of
   * it leaving.
   */
  typedName?: string;
}) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const data = await serializableTransaction(async (tx) => {
      // 2.9/2.14: a CLOSED cycle's books are final. Resolved through
      // lib/cycle-guard so the check is one line and cannot be skipped
      // for want of plumbing — which is how 14 actions lost it.
      await refuseIfCycleClosed(tx, { payoutId: input.payoutId });
      const target = await tx.payout.findUniqueOrThrow({
        where: { id: input.payoutId },
        include: {
          luckyNumber: { include: { participation: { include: { person: true } } } },
          draw: { include: { week: true } },
        },
      });

      // A COLLECTED payout is the record of cash that has already left.
      // Deleting it is not recoverable from anything else, so the typed
      // confirmation the dialog asks for is checked here too.
      if (target.status === "COLLECTED") {
        const person = target.luckyNumber.participation.person;
        const refusal = typedConfirmationRefusal({
          typed: input.typedName,
          expected: person.nameEnglishFirst,
          whatItDoes:
            `this deletes the record of ${formatMoney(target.netAmount)} already handed ` +
            `over to ${person.nameEnglishFirst}.`,
        });
        if (refusal) throw new Error(refusal);
      }

      const { reversed } = await unsettlePayout(tx, input.payoutId);
      // The OTHER half of a carry deduction. unsettlePayout reverses the
      // winner-week settlement because that half has an FK; this reverses the
      // ledger PAYMENT for the same reason, now that it has one too.
      const carry = await reverseCarryDeduction(
        tx,
        input.payoutId,
        "the payout was deleted",
      );
      await tx.payout.delete({ where: { id: input.payoutId } });
      const freed = target.draw
        ? await deleteDrawIfEmpty(tx, target.draw.id)
        : { deleted: false, numbersReturning: [] as number[], sentence: "", deleteDraw: false, deleteSlot: false, weekNumber: 0, planRestored: false };
      await logAudit(tx, {
        entity: "Payout",
        entityId: input.payoutId,
        action: "delete",
        summary:
          `Deleted payout for #${target.luckyNumber.number}: net ${formatMoney(target.netAmount)} (${target.status}). ` +
          (freed.deleted
            ? `It was the week's last payout`
            : `The draw stands — #${target.luckyNumber.number} stays drawn`) +
          (reversed > 0 && target.draw
            ? `; week ${target.draw.week.weekNumber}'s settled ${formatMoney(reversed)} is owed again`
            : "") +
          (target.draw ? freedWeekClause(freed, target.draw.week.weekNumber) : ""),
        before: {
          luckyNumber: target.luckyNumber.number,
          grossAmount: target.grossAmount,
          feeAmount: target.feeAmount,
          netAmount: target.netAmount,
          status: target.status,
          settlementReversed: reversed,
        },
      });
      return {
        number: target.luckyNumber.number,
        settlementReversed: reversed,
        weekFreed: freed.deleted,
        weekNumber: target.draw?.week.weekNumber ?? null,
        numbersReturned: freed.numbersReturning,
      };
    });
    revalidateAdmin();
    revalidatePath("/admin/collections");
    revalidatePath("/admin/payments");
    revalidatePath("/admin/wheel");
    revalidatePath("/admin/wheel/setup");
    revalidatePath("/admin/cycle/draws");
    revalidatePath("/admin");
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
      // 2.9/2.14: a CLOSED cycle's books are final. Resolved through
      // lib/cycle-guard so the check is one line and cannot be skipped
      // for want of plumbing — which is how 14 actions lost it.
      await refuseIfCycleClosed(tx, { cycleId: input.cycleId });
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

// listAuditLog moved to app/actions/audit.ts — reading the record is not a
// job for the file that writes it, and the reader now pages and filters.
