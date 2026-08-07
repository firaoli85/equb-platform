"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { refuseIfCycleClosed } from "@/lib/cycle-guard";
import { carryChoiceSummary, isCarryChoice, type CarryChoice } from "@/lib/carry-balance";
import { forgivenessRefusal, ledgerBalance, ledgerStory } from "@/lib/ledger";
import { formatMoney } from "@/lib/format";
import { parseDateInput } from "@/lib/format";
import { MAX_MONEY_CENTS } from "@/lib/money";
import { PRESENTATION_HIDDEN } from "@/lib/presentation";
import { prisma, serializableTransaction } from "@/lib/prisma";
import { typedConfirmationRefusal } from "@/lib/typed-confirmation";
import { getSetting } from "@/lib/settings";

/**
 * Record a payment against a person's carried balance (2.18: the balance
 * belongs to the PERSON and survives cycles; paying it never requires being
 * in one). This is ledger money, not week money — it never touches the
 * allocation engine and never marks a week paid.
 */
export async function recordLedgerPayment(input: {
  personId: string;
  amount: number;
  /** How the money arrived. */
  method?: "ZELLE" | "CASH" | "OTHER" | null;
  /** The day it HAPPENED (YYYY-MM-DD), which may be long after the cycle. */
  occurredAt?: string | null;
  notes?: string;
}) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    if (await getSetting("presentationMode")) {
      return { ok: false as const, error: PRESENTATION_HIDDEN };
    }
    if (
      !Number.isSafeInteger(input.amount) ||
      input.amount < 1 ||
      input.amount > MAX_MONEY_CENTS
    ) {
      return { ok: false as const, error: "Amount must be a positive amount." };
    }

    const result = await serializableTransaction(async (tx) => {
      const person = await tx.person.findUnique({
        where: { id: input.personId },
        include: { ledgerEntries: true },
      });
      if (!person) return { error: "Person not found." as string };

      const owed = ledgerBalance(person.ledgerEntries);
      if (owed === 0) {
        return { error: "This person carries no balance — nothing to record against." };
      }

      const when = input.occurredAt ? parseDateInput(input.occurredAt) : null;
      if (input.occurredAt && !when) {
        return { error: "The date must be a valid day." as string };
      }
      await tx.ledgerEntry.create({
        data: {
          personId: person.id,
          type: "PAYMENT",
          amount: input.amount,
          description: `Payment against carried balance (${formatMoney(owed)} owed before)`,
          method: input.method ?? null,
          ...(when ? { occurredAt: when } : {}),
          notes: input.notes?.trim() || null,
        },
      });
      await logAudit(tx, {
        entity: "LedgerEntry",
        entityId: person.id,
        action: "create",
        summary: `Ledger payment ${formatMoney(input.amount)} from ${person.nameEnglishFirst} — balance was ${formatMoney(owed)}, now ${formatMoney(Math.max(0, owed - input.amount))}`,
      });
      return { error: null as string | null, remaining: Math.max(0, owed - input.amount) };
    });

    if (result.error) return { ok: false as const, error: result.error };
    revalidatePath(`/admin/people/${input.personId}`);
    return { ok: true as const, data: { remaining: result.remaining! } };
  } catch (e) {
    console.error("recordLedgerPayment failed:", e);
    return { ok: false as const, error: `Could not record the ledger payment. ${errorMessage(e)}` };
  }
}

/**
 * WRITE OFF a carried balance, in full or in part (2.2: real life, and it is
 * the organizer's call). Recorded as its own FORGIVEN entry so the history
 * shows plainly that nobody paid this — a write-off logged as a payment would
 * make the record lie.
 *
 * Requires a reason: two years from now the entry has to explain itself.
 */
export async function forgiveBalance(input: {
  personId: string;
  amount: number;
  reason: string;
  /**
   * The person's name, typed by the organizer.
   *
   * A write-off clears a real debt without anybody paying it. There is no
   * undo and no other record that the money was ever owed once the entry
   * says FORGIVEN, so the confirmation is checked here rather than only
   * in the browser.
   */
  typedName?: string;
}) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    if (await getSetting("presentationMode")) {
      return { ok: false as const, error: PRESENTATION_HIDDEN };
    }
    const reason = input.reason.trim();
    if (reason.length < 3) {
      return { ok: false as const, error: "Give a reason — the entry has to explain itself later." };
    }

    const result = await serializableTransaction(async (tx) => {
      const person = await tx.person.findUnique({
        where: { id: input.personId },
        include: { ledgerEntries: true },
      });
      if (!person) return { error: "Person not found." as string };

      const nameRefusal = typedConfirmationRefusal({
        typed: input.typedName,
        expected: person.nameEnglishFirst,
        whatItDoes:
          `this writes off money ${person.nameEnglishFirst} owes, without anyone paying it.`,
      });
      if (nameRefusal) return { error: nameRefusal as string };

      const owed = ledgerBalance(person.ledgerEntries);
      const refusal = forgivenessRefusal({ balance: owed, amount: input.amount });
      if (refusal) {
        return {
          error:
            input.amount > owed
              ? `That is more than the ${formatMoney(owed)} carried. Forgive ${formatMoney(owed)} or less.`
              : refusal,
        };
      }

      await tx.ledgerEntry.create({
        data: {
          personId: person.id,
          type: "FORGIVEN",
          amount: input.amount,
          description:
            input.amount >= owed
              ? `Balance of ${formatMoney(owed)} written off`
              : `${formatMoney(input.amount)} of ${formatMoney(owed)} written off`,
          notes: reason,
        },
      });
      await logAudit(tx, {
        entity: "LedgerEntry",
        entityId: person.id,
        action: "create",
        summary:
          `Carried balance FORGIVEN for ${person.nameEnglishFirst}: ${formatMoney(input.amount)} ` +
          `written off (was ${formatMoney(owed)}, now ${formatMoney(Math.max(0, owed - input.amount))}). ` +
          `Reason: "${reason}"`,
      });
      return { error: null as string | null, remaining: Math.max(0, owed - input.amount) };
    });

    if (result.error) return { ok: false as const, error: result.error };
    revalidatePath(`/admin/people/${input.personId}`);
    revalidatePath("/admin/balances");
    return { ok: true as const, data: { remaining: result.remaining! } };
  } catch (e) {
    console.error("forgiveBalance failed:", e);
    return { ok: false as const, error: `Could not write off the balance. ${errorMessage(e)}` };
  }
}

/**
 * EVERYONE who carries a balance, largest first — money owed TO the organizer,
 * in one place, beside "who is waiting" (money owed BY him). Balances live on
 * the PERSON, so this survives every cycle deletion (2.18).
 */
export async function listCarriedBalances() {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    if (await getSetting("presentationMode")) {
      return { ok: false as const, error: PRESENTATION_HIDDEN };
    }
    const people = await prisma.person.findMany({
      where: { ledgerEntries: { some: {} } },
      include: { ledgerEntries: { orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }] } },
    });

    const rows = people
      .map((person) => {
        const story = ledgerStory(person.ledgerEntries);
        return {
          personId: person.id,
          name: person.nameEnglishFirst,
          nameAmharic: person.nameAmharic,
          balance: story.balance,
          raised: story.raised,
          repaid: story.repaid,
          forgiven: story.forgiven,
          /** Where it came from — the descriptions of the DEBT entries. */
          origins: person.ledgerEntries
            .filter((e) => e.type === "DEBT")
            .map((e) => e.description),
          oldest: person.ledgerEntries[0]?.occurredAt.toISOString() ?? null,
        };
      })
      .filter((r) => r.balance > 0)
      .sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));

    return {
      ok: true as const,
      data: {
        rows,
        total: rows.reduce((s, r) => s + r.balance, 0),
      },
    };
  } catch (e) {
    console.error("listCarriedBalances failed:", e);
    return { ok: false as const, error: `Could not load the balances. ${errorMessage(e)}` };
  }
}

/**
 * Record what the organizer DECIDED about a carried balance when adding
 * someone to a new cycle (2.18: never silently carried, deducted or ignored).
 *
 * Nothing about the balance changes here — that is the point. "deduct" is an
 * INTENTION, and the deduction itself is still offered, never automatic, when
 * the payout is handed over (D-23). This writes the decision into the record
 * so it can be read back later.
 */
export async function recordCarryDecision(input: {
  personId: string;
  /** The participation the decision belongs to — the intention is per cycle. */
  participationId: string;
  cycleName: string;
  choice: CarryChoice;
  balance: number;
}) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    if (!isCarryChoice(input.choice)) {
      return { ok: false as const, error: "Choose what happens to the carried balance." };
    }
    const person = await prisma.person.findUnique({
      where: { id: input.personId },
      select: { id: true, nameEnglishFirst: true },
    });
    if (!person) return { ok: false as const, error: "Person not found." };

    // D-2: PERSISTED, not just audited. Previously this wrote a log line and
    // nothing else, so "deduct it from their payout" could be chosen and then
    // never resurface — the decision was made and silently lost.
    //
    // D-23 still holds: these columns only pre-tick the offer. Nothing reads
    // them as permission to deduct (lib/carry-balance.ts owns that, and a
    // guard test fails if any other path tries).
    await serializableTransaction(async (tx) => {
      // 2.9/2.14: a CLOSED cycle's books are final. Resolved through
      // lib/cycle-guard so the check is one line and cannot be skipped
      // for want of plumbing — which is how 14 actions lost it.
      await refuseIfCycleClosed(tx, { participationId: input.participationId });
      await tx.participation.update({
        where: { id: input.participationId },
        data: {
          carryIntent: input.choice,
          carryIntentAt: new Date(),
          carryIntentAmount: input.balance,
        },
      });
      await logAudit(tx, {
        entity: "Person",
        entityId: person.id,
        action: "update",
        summary:
          `${person.nameEnglishFirst} added to ${input.cycleName} carrying ` +
          `${formatMoney(input.balance)}: ${carryChoiceSummary(input.choice)}.`,
      });
    });
    revalidatePath("/admin/collections");
    revalidatePath(`/admin/people/${person.id}`);
    return { ok: true as const };
  } catch (e) {
    console.error("recordCarryDecision failed:", e);
    return { ok: false as const, error: `Could not record the decision. ${errorMessage(e)}` };
  }
}
