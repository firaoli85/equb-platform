"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { ledgerBalance } from "@/lib/ledger";
import { formatMoney } from "@/lib/format";
import { MAX_MONEY_CENTS } from "@/lib/money";
import { PRESENTATION_HIDDEN } from "@/lib/presentation";
import { serializableTransaction } from "@/lib/prisma";
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

      await tx.ledgerEntry.create({
        data: {
          personId: person.id,
          type: "PAYMENT",
          amount: input.amount,
          description: `Payment against carried balance (${formatMoney(owed)} owed before)`,
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
