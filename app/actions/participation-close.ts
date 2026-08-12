"use server";

// CLOSING AND REOPENING A PARTICIPATION MID-CYCLE (2.18).
//
// The organizer knows at week 12 that someone will not continue. Until this
// existed, the only tool for it was `removeParticipation` — which DELETES the
// row, their receipts and their payouts. So the honest thing (record that they
// stopped) and the destructive thing (erase that they were ever here) were the
// same button, and the position went on counting money that would never come.
//
// WHAT IS STORED, AND WHY IT IS THE MINIMUM (2.14):
//
//   a ParticipationBreak   fromWeek, an open end, and the neutral reason
//
// That single row is the decision. Everything else is DERIVED from it: the
// expectation ends at `fromWeek - 1` (`inWindow`), the numbers leave the pool
// (2.27), and the balance is re-derived from the receipts every time it is
// read. Nothing computed here is written down, so nothing here can go stale.
//
// `status` and `closedAtWeek` on the participation are kept in step as the
// denormalised current state, because every ACTIVE filter in the platform
// already reads them. They are never a second source of truth — the break is.
//
// THE BALANCE IS THE ONE EXCEPTION, and it is stored on purpose: 2.18 says a
// balance belongs to the PERSON and survives cycle deletion. A derived figure
// cannot survive the rows it derives from, so the ledger entry is written.

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { currentWeekFromRows } from "@/lib/commitment";
import { frozenCycleRefusal } from "@/lib/cycle-close";
import { formatMoney } from "@/lib/format";
import { Prisma } from "@/lib/generated/prisma/client";
import { calculateFinishWeek, MAX_WEEKS } from "@/lib/money";
import {
  closeConsequences,
  closePlan,
  closeRefusal,
  closeReasonText,
  inWindow,
  isCloseReason,
  reactivateConsequences,
  reactivatePlan,
  reactivateRefusal,
  type CloseReason,
} from "@/lib/participation-close";
import { PRESENTATION_HIDDEN } from "@/lib/presentation";
import { prisma, serializableTransaction } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";
import { computeStanding, pinnedMapFromEvents } from "@/lib/standing";
import { typedConfirmationRefusal } from "@/lib/typed-confirmation";

/** Everything both the preview and the commit need, loaded once. */
const PARTICIPATION_INCLUDE = {
  person: true,
  breaks: { orderBy: { fromWeek: "asc" } },
  cycle: { include: { weeks: { orderBy: { weekNumber: "asc" } } } },
  payments: { include: { week: true } },
  paymentEvents: {
    select: { amount: true, pinnedWeekId: true, pinnedWeek: { select: { weekNumber: true } } },
  },
  luckyNumbers: {
    include: {
      payouts: { select: { netAmount: true, status: true } },
      planNumbers: {
        include: { plan: { include: { week: { select: { weekNumber: true } } } } },
      },
    },
  },
} as const;

type Loaded = Prisma.ParticipationGetPayload<{ include: typeof PARTICIPATION_INCLUDE }>;

/**
 * Everything the confirmation has to state, in real figures.
 *
 * Derived from the same rows the commit will use, so the organizer cannot be
 * shown one set of consequences and have another happen (2.23).
 */
function describe(p: Loaded, closingAtWeek: number) {
  const finishWeek = calculateFinishWeek(p.startWeek, p.weeksCommitted);
  const today = new Date();
  const standing = computeStanding({
    weeklyAmount: p.weeklyAmount,
    startWeek: p.startWeek,
    weeksCommitted: p.weeksCommitted,
    cycleWeek: currentWeekFromRows({
      weeks: p.cycle.weeks,
      today,
      cycleStartDate: p.cycle.startDate,
    }),
    today,
    // The window as it will be AFTER the close: their unpaid weeks up to the
    // closing point, and nothing beyond it.
    //
    // `inWindow` rather than a range, because a member who stopped once
    // before and came back has a HOLE in the middle. Nothing was expected
    // from them then, so billing them for it now — inside the very figure
    // that becomes a balance on their record — would be inventing a debt.
    windowWeeks: p.cycle.weeks
      .filter((w) =>
        inWindow(
          {
            startWeek: p.startWeek,
            weeksCommitted: p.weeksCommitted,
            breaks: [...p.breaks, { fromWeek: closingAtWeek + 1, toWeek: null }],
          },
          w.weekNumber,
        ),
      )
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
    totalPaid: p.payments.reduce((s, pm) => s + pm.amountPaid, 0),
    pinnedByWeek: pinnedMapFromEvents(
      p.paymentEvents
        .filter((e) => e.pinnedWeekId !== null)
        .map((e) => ({ amount: e.amount, weekNumber: e.pinnedWeek?.weekNumber ?? null })),
    ),
  });

  const undrawnNumbers = p.luckyNumbers
    .filter((n) => n.payouts.length === 0)
    .map((n) => n.number);
  // Only money actually HANDED OVER. A PENDING payout is still in his hands.
  const alreadyPaidOut = p.luckyNumbers
    .flatMap((n) => n.payouts)
    .filter((po) => po.status === "COLLECTED")
    .reduce((s, po) => s + po.netAmount, 0);

  const plan = closePlan({
    memberName: p.person.nameEnglishFirst,
    cycleName: p.cycle.name,
    startWeek: p.startWeek,
    weeksCommitted: p.weeksCommitted,
    weeklyAmount: p.weeklyAmount,
    closingAtWeek,
    outstandingToDate: standing.amountOutstanding,
    undrawnNumbers,
    alreadyPaidOut,
  });
  return { plan, standing, finishWeek };
}

/**
 * A committed winner plan naming one of their numbers (2.3).
 *
 * `PLANNED` IS the committed state in this schema — the organizer has decided
 * this number wins this week, and rule 13 freezes it against every path.
 * FULFILLED means the draw already happened (that number is drawn, so it left
 * the pool on its own) and CANCELLED means he changed his mind; neither can be
 * broken by closing.
 */
function committedPlanOf(p: Loaded) {
  const held = p.luckyNumbers.flatMap((n) =>
    n.planNumbers
      .filter((wpn) => wpn.plan.status === "PLANNED")
      .map((wpn) => ({ number: n.number, weekNumber: wpn.plan.week?.weekNumber ?? null })),
  );
  if (held.length === 0) return null;
  return {
    weekNumber: held[0].weekNumber,
    numbers: [...new Set(held.map((h) => h.number))].sort((a, b) => a - b),
  };
}

// ————————————————— The preview —————————————————

/**
 * What closing would do, before anything is written.
 *
 * A confirmation that says "are you sure" and nothing else asks the organizer
 * to trust the software with a decision he cannot see, which is the opposite
 * of 2.23. Every consequence comes back as a sentence with a real figure.
 */
export async function previewParticipationClose(input: {
  participationId: string;
  /** Defaults to the cycle's current week. */
  closingAtWeek?: number;
}) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    if (await getSetting("presentationMode")) {
      return { ok: false as const, error: PRESENTATION_HIDDEN };
    }
    const p = await prisma.participation.findUniqueOrThrow({
      where: { id: input.participationId },
      include: PARTICIPATION_INCLUDE,
    });
    const today = new Date();
    const currentWeek = currentWeekFromRows({
      weeks: p.cycle.weeks,
      today,
      cycleStartDate: p.cycle.startDate,
    });
    const closingAtWeek = input.closingAtWeek ?? Math.max(p.startWeek, currentWeek);
    const refusal = closeRefusal({
      memberName: p.person.nameEnglishFirst,
      cycleName: p.cycle.name,
      cycleStatus: p.cycle.status === "CLOSED" ? "CLOSED" : "ACTIVE",
      participationStatus: p.status,
      committedPlan: committedPlanOf(p),
      closingAtWeek,
      startWeek: p.startWeek,
      weeksCommitted: p.weeksCommitted,
    });
    if (refusal) return { ok: false as const, error: refusal };

    const { plan } = describe(p, closingAtWeek);
    return {
      ok: true as const,
      data: {
        plan,
        consequences: closeConsequences(plan),
        currentWeek,
        finishWeek: calculateFinishWeek(p.startWeek, p.weeksCommitted),
        confirmPhrase: p.person.nameEnglishFirst,
      },
    };
  } catch (e) {
    return { ok: false as const, error: errorMessage(e) };
  }
}

// ————————————————— Closing —————————————————

export async function closeParticipation(input: {
  participationId: string;
  closingAtWeek: number;
  reason: string;
  note?: string;
  /** The member's name, typed. */
  typedName: string;
}) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    if (await getSetting("presentationMode")) {
      return { ok: false as const, error: PRESENTATION_HIDDEN };
    }
    if (!isCloseReason(input.reason)) {
      return {
        ok: false as const,
        error: "Choose a reason from the list. It goes on the record and stays there.",
      };
    }
    const reason: CloseReason = input.reason;
    const note = input.note?.trim() || null;
    if (reason === "OTHER" && !note) {
      return {
        ok: false as const,
        error: "“Other” needs a short factual note about the arrangement, or the record says nothing.",
      };
    }
    if (
      !Number.isSafeInteger(input.closingAtWeek) ||
      input.closingAtWeek < 1 ||
      input.closingAtWeek > MAX_WEEKS
    ) {
      return { ok: false as const, error: `The closing week must be between 1 and ${MAX_WEEKS}.` };
    }

    const data = await serializableTransaction(async (tx) => {
      const p = await tx.participation.findUniqueOrThrow({
        where: { id: input.participationId },
        include: PARTICIPATION_INCLUDE,
      });
      // Re-checked INSIDE the transaction against the same pure function the
      // preview used. A plan committed between preview and commit must not
      // slip through (2.3).
      const refusal = closeRefusal({
        memberName: p.person.nameEnglishFirst,
        cycleName: p.cycle.name,
        cycleStatus: p.cycle.status === "CLOSED" ? "CLOSED" : "ACTIVE",
        participationStatus: p.status,
        committedPlan: committedPlanOf(p),
        closingAtWeek: input.closingAtWeek,
        startWeek: p.startWeek,
        weeksCommitted: p.weeksCommitted,
      });
      if (refusal) throw new Error(refusal);
      // THE SHARED FREEZE CHECK, not a second copy of it. `closeRefusal` also
      // names the closed cycle — that sentence is what the organizer reads on
      // the preview — but the ENFORCEMENT is the one function every other
      // cycle-mutating action calls, so this can never drift away from rule 14
      // while still looking correct (lib/cycle-lock.test.ts scans for it).
      const frozen = frozenCycleRefusal(p.cycle);
      if (frozen) throw new Error(frozen);

      const typed = typedConfirmationRefusal({
        typed: input.typedName,
        expected: p.person.nameEnglishFirst,
        whatItDoes: `this ends what ${p.person.nameEnglishFirst} is expected to pay from week ${input.closingAtWeek + 1} on.`,
      });
      if (typed) throw new Error(typed);

      const { plan } = describe(p, input.closingAtWeek);

      // THE BREAK IS THE FACT. It opens at the week after their last counted
      // one and has no end, which is exactly what "they have stopped" means.
      // Every derived figure reads it through `inWindow`.
      await tx.participationBreak.create({
        data: {
          participationId: p.id,
          fromWeek: input.closingAtWeek + 1,
          toWeek: null,
          reason,
          note,
        },
      });
      // The denormalised current state, for the ACTIVE filters that already
      // exist across the platform (the wheel pool, messaging, the portal).
      // Kept in step with the open break, never a second source of truth.
      await tx.participation.update({
        where: { id: p.id },
        data: {
          status: "CLOSED",
          closedAtWeek: input.closingAtWeek,
          closeReason: reason,
          closeNote: note,
          closedAt: new Date(),
        },
      });

      // THE BALANCE GOES ON THE PERSON, not the cycle (2.18 / rule 10) — the
      // same shape `finalBalanceEntries` writes when a whole cycle closes, so
      // an early close and an automatic one are one story in the ledger and
      // not two. Skipped when they are paid up: a $0 debt entry is noise in a
      // record whose whole job is telling him WHY a balance exists.
      let ledgerEntryId: string | null = null;
      if (plan.balanceToRecord > 0) {
        const entry = await tx.ledgerEntry.create({
          data: {
            personId: p.personId,
            type: "DEBT",
            amount: plan.balanceToRecord,
            description:
              `${p.cycle.name} — stopped at week ${input.closingAtWeek}, ` +
              `${formatMoney(plan.balanceToRecord)} unpaid`,
            notes: closeReasonText(reason, note),
          },
        });
        ledgerEntryId = entry.id;
      }

      await logAudit(tx, {
        entity: "Participation",
        entityId: p.id,
        // The audit vocabulary is create/update/delete/move. Closing is an
        // UPDATE to the participation — the summary carries what changed.
        action: "update",
        summary:
          `${p.person.nameEnglishFirst} stopped at week ${input.closingAtWeek} of ` +
          `${p.cycle.name} — ${closeReasonText(reason, note)}. ` +
          closeConsequences(plan).join(" "),
        before: { status: p.status, closedAtWeek: p.closedAtWeek },
        after: {
          status: "CLOSED",
          closedAtWeek: input.closingAtWeek,
          closeReason: reason,
          closeNote: note,
          weeksLeaving: plan.weeksLeaving,
          amountLeaving: plan.amountLeaving,
          balanceRecorded: plan.balanceToRecord,
          ledgerEntryId,
          numbersLeavingPool: plan.numbersLeavingPool,
          alreadyPaidOut: plan.alreadyPaidOut,
          shortfallToCover: plan.shortfallToCover,
        },
      });

      return { plan, personId: p.personId, consequences: closeConsequences(plan) };
    });

    revalidatePath("/admin");
    revalidatePath("/admin/cycle/position");
    revalidatePath("/admin/cash");
    revalidatePath("/admin/wheel");
    revalidatePath(`/admin/people/${data.personId}`);
    return { ok: true as const, data };
  } catch (e) {
    return { ok: false as const, error: errorMessage(e) };
  }
}

// ————————————————— Reopening —————————————————

/**
 * Bring a stopped member back, FROM HERE FORWARD.
 *
 * Reversible while the cycle is open (2.23: the organizer is never trapped by
 * his own correction) and permanent once it closes, because closing writes
 * every carried balance from exactly these receipts and rule 14 makes the
 * books final.
 *
 * The weeks they were away stay closed. They really did pass with the member
 * out — nobody chased them and the organizer read a position that did not
 * include them. Restoring those weeks would invent arrears that never existed.
 */
export async function reactivateParticipation(input: {
  participationId: string;
  /** Defaults to the current week. Never earlier than the week after the close. */
  fromWeek?: number;
}) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    if (await getSetting("presentationMode")) {
      return { ok: false as const, error: PRESENTATION_HIDDEN };
    }
    const data = await serializableTransaction(async (tx) => {
      const p = await tx.participation.findUniqueOrThrow({
        where: { id: input.participationId },
        include: PARTICIPATION_INCLUDE,
      });
      const refusal = reactivateRefusal({
        memberName: p.person.nameEnglishFirst,
        cycleName: p.cycle.name,
        cycleStatus: p.cycle.status === "CLOSED" ? "CLOSED" : "ACTIVE",
        participationStatus: p.status,
      });
      if (refusal) throw new Error(refusal);
      // The same shared freeze check: reopening writes to the cycle too, and a
      // CLOSED cycle already wrote every carried balance from these receipts.
      const frozen = frozenCycleRefusal(p.cycle);
      if (frozen) throw new Error(frozen);

      const today = new Date();
      const currentWeek = currentWeekFromRows({
        weeks: p.cycle.weeks,
        today,
        cycleStartDate: p.cycle.startDate,
      });
      // The break they are still inside. A row closed before this table
      // existed has none, so one is derived from where they stopped.
      const open =
        p.breaks.find((b) => b.toWeek === null) ??
        (await tx.participationBreak.create({
          data: {
            participationId: p.id,
            fromWeek: (p.closedAtWeek ?? p.startWeek - 1) + 1,
            toWeek: null,
            reason: p.closeReason ?? "STOPPED_CONTRIBUTING",
            note: p.closeNote,
          },
        }));
      const closedAtWeek = open.fromWeek - 1;
      const plan = reactivatePlan({
        memberName: p.person.nameEnglishFirst,
        startWeek: p.startWeek,
        weeksCommitted: p.weeksCommitted,
        weeklyAmount: p.weeklyAmount,
        closedAtWeek,
        fromWeek: input.fromWeek ?? currentWeek,
        undrawnNumbers: p.luckyNumbers.filter((n) => n.payouts.length === 0).map((n) => n.number),
      });

      // FORWARD ONLY, BY CONSTRUCTION. Closing the break at the week before
      // the restart leaves the weeks they were away permanently outside their
      // window — there is no way to express "give those weeks back", because
      // giving them back would invent arrears for weeks nobody ever asked
      // them about. The break row survives as the record of where they were.
      //
      // Resuming immediately leaves an EMPTY break (toWeek < fromWeek), which
      // no week can fall inside, so their window is whole again.
      await tx.participationBreak.update({
        where: { id: open.id },
        data: { toWeek: plan.fromWeek - 1, endedAt: new Date() },
      });
      await tx.participation.update({
        where: { id: p.id },
        data: {
          status: "ACTIVE",
          closedAtWeek: null,
          closeReason: null,
          closeNote: null,
          closedAt: null,
        },
      });

      await logAudit(tx, {
        entity: "Participation",
        entityId: p.id,
        action: "update",
        summary:
          `${p.person.nameEnglishFirst} is contributing again in ${p.cycle.name} from week ` +
          `${plan.fromWeek}. ` +
          reactivateConsequences(plan).join(" "),
        before: {
          status: "CLOSED",
          closedAtWeek,
          closeReason: p.closeReason,
          closeNote: p.closeNote,
        },
        after: {
          status: "ACTIVE",
          fromWeek: plan.fromWeek,
          // The break that stays on the record: the weeks they were away.
          breakWeeks:
            plan.fromWeek - 1 >= open.fromWeek
              ? `${open.fromWeek}..${plan.fromWeek - 1}`
              : "none — they resumed immediately",
          weeksReturning: plan.weeksReturning,
          amountReturning: plan.amountReturning,
          weeksStayingClosed: plan.weeksStayingClosed,
        },
      });

      return { plan, personId: p.personId, consequences: reactivateConsequences(plan) };
    });

    revalidatePath("/admin");
    revalidatePath("/admin/cycle/position");
    revalidatePath("/admin/cash");
    revalidatePath("/admin/wheel");
    revalidatePath(`/admin/people/${data.personId}`);
    return { ok: true as const, data };
  } catch (e) {
    return { ok: false as const, error: errorMessage(e) };
  }
}
