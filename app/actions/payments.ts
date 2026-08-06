"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/action-result";
import { requireAdmin } from "@/lib/auth";
import { allocatePayment, type AllocationWeek } from "@/lib/allocation";
import { Prisma } from "@/lib/generated/prisma/client";
import { sendStatement, type SendOutcome } from "@/lib/messaging-engine";
import { contribution } from "@/lib/contribution";
import { calculateFinishWeek, currentWeekNumber, MAX_MONEY_CENTS } from "@/lib/money";
import { PRESENTATION_HIDDEN } from "@/lib/presentation";
import { prisma, serializableTransaction } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";
import { frozenCycleRefusal } from "@/lib/cycle-close";
import { isReservedSettlementKey } from "@/lib/draw-settlement";
import { computeStanding, pinnedMapFromEvents, planCommit } from "@/lib/standing";

const PAYMENT_METHODS = ["ZELLE", "CASH", "OTHER"] as const;
export type PaymentMethodInput = (typeof PAYMENT_METHODS)[number];

// ————— Shared loader: a member's window as the engine sees it —————
// One loader feeds preview, commit, and standing, so all three always agree
// (2.19: one engine). amountDue is the participation's CURRENT weekly amount
// (2.14) and a cycle-wide skipped week owes nothing, exactly like a personal
// deferral.
async function loadMemberWindow(db: Prisma.TransactionClient, participationId: string) {
  const participation = await db.participation.findUnique({
    where: { id: participationId },
    include: {
      person: true,
      payments: true,
      // EVERY receipt: total contributed is their sum (2.14). The pinned
      // subset — payout settlements, which stay on their drawn week and are
      // never fungible — is filtered out of this list in code.
      paymentEvents: {
        select: {
          amount: true,
          pinnedWeekId: true,
          pinnedWeek: { select: { weekNumber: true } },
        },
      },
      cycle: { include: { weeks: { orderBy: { weekNumber: "asc" } } } },
    },
  });
  if (!participation) return null;

  const finishWeek = calculateFinishWeek(participation.startWeek, participation.weeksCommitted);
  const paymentByWeekId = new Map(participation.payments.map((p) => [p.weekId, p]));
  const windowWeeks = participation.cycle.weeks
    .filter((w) => w.weekNumber >= participation.startWeek && w.weekNumber <= finishWeek)
    .map((week) => {
      const payment = paymentByWeekId.get(week.id) ?? null;
      const allocation: AllocationWeek = {
        weekNumber: week.weekNumber,
        amountDue: participation.weeklyAmount,
        amountAlreadyPaid: payment?.amountPaid ?? 0,
        isSkipped: week.isSkipped,
      };
      // DEFERRED rides alongside the allocation input, never inside it: money
      // lands on a deferred week like any other (organizer ruling, Aug 2026).
      return { week, payment, allocation, isDeferred: payment?.isDeferred ?? false };
    });

  return { participation, finishWeek, windowWeeks };
}

function validAmount(amount: number): boolean {
  return Number.isSafeInteger(amount) && amount >= 1 && amount <= MAX_MONEY_CENTS;
}

/**
 * AUDIT H5 — money may never land on a CLOSED cycle's week. loadMemberWindow
 * happily loaded a frozen cycle, so a receipt could be recorded against an
 * archived cycle whose ledger balances were already written at close. The
 * READ paths (standing, the archive, the member's own history) stay open —
 * 2.9 keeps past cycles viewable; only the writes are refused.
 */
function frozenRefusal(loaded: { participation: { cycle: { name: string; status: string } } }) {
  return frozenCycleRefusal({
    name: loaded.participation.cycle.name,
    status: loaded.participation.cycle.status as "DRAFT" | "ACTIVE" | "CLOSED",
  });
}

/**
 * What WOULD happen if this amount were recorded — never writes (2.15:
 * the allocation is shown before it is committed).
 */
export async function previewAllocation(input: { participationId: string; amount: number }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    // The preview echoes a member's owed weeks and amounts — recording money
    // is exactly what should not happen on a shared screen (2.4). Turn
    // presentation mode off to record.
    if (await getSetting("presentationMode")) {
      return { ok: false as const, error: PRESENTATION_HIDDEN };
    }
    if (!validAmount(input.amount)) {
      return { ok: false as const, error: "Amount must be a positive amount." };
    }
    const loaded = await loadMemberWindow(prisma, input.participationId);
    if (!loaded) return { ok: false as const, error: "Participation not found." };
    // Refuse HERE too, not only at commit — a preview that promises an
    // allocation the commit will reject is a lie (2.10).
    const frozen = frozenRefusal(loaded);
    if (frozen) return { ok: false as const, error: frozen };

    const result = allocatePayment(
      input.amount,
      loaded.windowWeeks.map((w) => w.allocation),
    );
    const dateByWeek = new Map(loaded.windowWeeks.map((w) => [w.week.weekNumber, w.week.date]));
    return {
      ok: true as const,
      data: {
        allocations: result.allocations.map((a) => ({ ...a, date: dateByWeek.get(a.weekNumber)! })),
        totalApplied: result.totalApplied,
        unallocated: result.unallocated,
      },
    };
  } catch (e) {
    console.error("previewAllocation failed:", e);
    return { ok: false as const, error: `Could not preview the allocation. ${errorMessage(e)}` };
  }
}

export type RecordPaymentInput = {
  participationId: string;
  /** Cents. */
  amount: number;
  method?: PaymentMethodInput;
  /** ISO 8601 timestamp; defaults to the moment of commit. */
  paidAt?: string;
  /**
   * Caller-generated per submission intent (e.g. crypto.randomUUID() when
   * the entry form opens). The DATABASE enforces uniqueness — a double-click
   * resubmitting the same key is rejected by the unique constraint, durable
   * across restarts and instances.
   */
  idempotencyKey: string;
  notes?: string;
};

/**
 * Record one RECEIPT of money: creates the PaymentEvent, runs the SAME
 * engine as the preview, and writes every touched week plus the
 * event→week allocation audit trail in ONE serializable transaction.
 * Money the member's window cannot absorb is rejected, never silently
 * dropped — and a rejected attempt rolls back its event, so a corrected
 * retry may reuse the same idempotency key.
 */
export async function recordPayment(input: RecordPaymentInput) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    // Same gate as previewAllocation: the response carries the DB-derived
    // per-week allocation — money that must not cross the wire during a
    // screen share (2.4). Turn presentation mode off to record.
    if (await getSetting("presentationMode")) {
      return { ok: false as const, error: PRESENTATION_HIDDEN };
    }
    if (!validAmount(input.amount)) {
      return { ok: false as const, error: "Amount must be a positive amount." };
    }
    if (input.method !== undefined && !PAYMENT_METHODS.includes(input.method)) {
      return { ok: false as const, error: "Unknown payment method." };
    }
    let explicitPaidAt: Date | null = null;
    if (input.paidAt !== undefined) {
      explicitPaidAt = new Date(input.paidAt);
      if (Number.isNaN(explicitPaidAt.getTime())) {
        return { ok: false as const, error: "paidAt must be a valid date and time." };
      }
    }

    const idempotencyKey = input.idempotencyKey?.trim();
    if (!idempotencyKey || idempotencyKey.length > 200) {
      return { ok: false as const, error: "A valid idempotency key is required." };
    }
    // The settlement engine owns this namespace (audit C6). A caller that
    // could write into it would also collide with a real settlement key and
    // block a legitimate draw.
    if (isReservedSettlementKey(idempotencyKey)) {
      return { ok: false as const, error: "That idempotency key is reserved by the system." };
    }

    const data = await serializableTransaction(async (tx) => {
      // The receipt is created FIRST: a duplicate submission dies here on the
      // database's unique idempotencyKey before anything else is touched. Any
      // later guard throwing rolls the event back too, so a corrected retry
      // may reuse the same key.
      const receivedAt = explicitPaidAt ?? new Date();
      const event = await tx.paymentEvent.create({
        data: {
          participationId: input.participationId,
          amount: input.amount,
          method: input.method ?? null,
          receivedAt,
          notes: input.notes?.trim() || null,
          idempotencyKey,
        },
      });

      const loaded = await loadMemberWindow(tx, input.participationId);
      if (!loaded) throw new Error("Participation not found.");
      // The authoritative refusal (audit H5) — INSIDE the serializable
      // transaction, so a cycle closing concurrently cannot slip a receipt
      // in behind the check.
      const frozen = frozenRefusal(loaded);
      if (frozen) throw new Error(frozen);
      if (loaded.windowWeeks.length < loaded.participation.weeksCommitted) {
        throw new Error(
          "This member's commitment runs past the cycle's existing weeks (data from " +
            "before the 2.22/D-31 rule). Extend the cycle's weeks before recording money.",
        );
      }

      const plan = planCommit(
        input.amount,
        loaded.windowWeeks.map((w) => w.allocation),
      );
      if (!plan.ok) throw new Error(plan.error);

      const rowByWeekNumber = new Map(loaded.windowWeeks.map((w) => [w.week.weekNumber, w]));
      for (const a of plan.result.allocations) {
        const row = rowByWeekNumber.get(a.weekNumber)!;
        // Payment.amountPaid stays STORED as an aggregate cache of this
        // week's allocations, maintained ONLY inside this transaction, so it
        // can never drift from the events. paidAt/method on the week row keep
        // the FIRST receipt's facts; the full multi-receipt history lives on
        // the events themselves.
        const firstMoneyOnRow = !row.payment || row.payment.amountPaid === 0;
        const payment = await tx.payment.upsert({
          where: {
            weekId_participationId: {
              weekId: row.week.id,
              participationId: input.participationId,
            },
          },
          create: {
            weekId: row.week.id,
            participationId: input.participationId,
            amountPaid: a.applied,
            method: input.method ?? null,
            paidAt: receivedAt,
          },
          update: {
            amountPaid: { increment: a.applied },
            ...(firstMoneyOnRow
              ? { paidAt: receivedAt, ...(input.method !== undefined ? { method: input.method } : {}) }
              : {}),
          },
        });
        await tx.paymentAllocation.create({
          data: { eventId: event.id, paymentId: payment.id, amount: a.applied },
        });
      }
      return {
        eventId: event.id,
        allocations: plan.result.allocations,
        totalApplied: plan.result.totalApplied,
        paidAt: receivedAt,
      };
    });

    revalidatePath("/admin/cycle");
    revalidatePath("/admin/payments");

    // 2.20 AUTOMATIC: the confirmation is the direct result of the action
    // the organizer just took — the ONLY message that sends itself. Runs
    // AFTER the transaction committed, and best-effort: a messaging failure
    // never fails the payment; the outcome (sent / skipped / failed) goes
    // back to the organizer and to MessageLog. Imported history never
    // reaches this — imports write receipts directly, never through here.
    let confirmation: SendOutcome | null = null;
    try {
      confirmation = await sendStatement({
        participationId: input.participationId,
        key: "PAYMENT_CONFIRMED",
        trigger: "AUTOMATIC",
        extras: {
          amountReceived: input.amount,
          weeksCovered: data.allocations.map((a) => a.weekNumber),
        },
      });
    } catch (e) {
      console.error("payment confirmation message failed:", e);
    }

    return { ok: true as const, data: { ...data, confirmation } };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return {
        ok: false as const,
        error: "This payment was already recorded (duplicate submission).",
      };
    }
    console.error("recordPayment failed:", e);
    return { ok: false as const, error: `Could not record the payment. ${errorMessage(e)}` };
  }
}

/**
 * The full derived picture for one member — computed from stored money and
 * the calendar on every call, never stored (2.14).
 */
export async function getMemberStanding(participationId: string) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    // A member's standing is their name and their money (2.4).
    if (await getSetting("presentationMode")) {
      return { ok: false as const, error: PRESENTATION_HIDDEN };
    }
    const loaded = await loadMemberWindow(prisma, participationId);
    if (!loaded) return { ok: false as const, error: "Participation not found." };
    const { participation, windowWeeks } = loaded;

    // All derivation lives in the pure, unit-tested computeStanding (2.14):
    // stored receipts in, current truth out. Elapsed weeks come from the
    // window's EXISTING rows — under 2.22/D-31 override weeks are generated
    // at add time, so rows cover the window; for pre-rule data the numbers
    // stay honest and missingWeekRows reports the gap.
    const today = new Date();
    const cycleWeek = currentWeekNumber(participation.cycle.startDate, today);
    const standing = computeStanding({
      weeklyAmount: participation.weeklyAmount,
      startWeek: participation.startWeek,
      weeksCommitted: participation.weeksCommitted,
      cycleWeek,
      today,
      windowWeeks: windowWeeks.map((w) => ({
        weekNumber: w.week.weekNumber,
        date: w.week.date,
        amountDue: w.allocation.amountDue,
        storedPaid: w.payment?.amountPaid ?? 0,
        isDeferred: w.isDeferred,
        isSkipped: w.allocation.isSkipped,
      })),
      totalPaid: participation.payments.reduce((sum, p) => sum + p.amountPaid, 0),
      pinnedByWeek: pinnedMapFromEvents(
        participation.paymentEvents
          .filter((e) => e.pinnedWeekId !== null)
          .map((e) => ({
            amount: e.amount,
            weekNumber: e.pinnedWeek?.weekNumber ?? null,
          })),
      ),
    });

    return {
      ok: true as const,
      data: {
        participationId: participation.id,
        person: {
          id: participation.person.id,
          nameAmharic: participation.person.nameAmharic,
          nameEnglishFirst: participation.person.nameEnglishFirst,
          nameEnglishLast: participation.person.nameEnglishLast,
        },
        weeklyAmount: participation.weeklyAmount,
        startWeek: participation.startWeek,
        weeksCommitted: participation.weeksCommitted,
        currentCycleWeek: cycleWeek,
        // 2.1: what they have SAVED, as a first-class figure beside what they
        // owe. Derived from the receipts (2.14), never stored.
        contribution: contribution({
          receipts: participation.paymentEvents.map((e) => ({ amount: e.amount })),
          weeklyAmount: participation.weeklyAmount,
          weeksCommitted: participation.weeksCommitted,
          overdue: standing.amountOutstanding,
        }),
        ...standing,
      },
    };
  } catch (e) {
    console.error("getMemberStanding failed:", e);
    return { ok: false as const, error: `Could not compute the member's standing. ${errorMessage(e)}` };
  }
}

export type MemberStanding = Extract<
  Awaited<ReturnType<typeof getMemberStanding>>,
  { ok: true }
>["data"];

export type AllocationPreview = Extract<
  Awaited<ReturnType<typeof previewAllocation>>,
  { ok: true }
>["data"];
