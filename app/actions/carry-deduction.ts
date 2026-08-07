"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import {
  applyCarryDeduction,
  carryOffer,
  isCarryChoice,
  type CarryOffer,
} from "@/lib/carry-balance";
import { formatMoney } from "@/lib/format";
import { ledgerBalance } from "@/lib/ledger";
import { prisma, serializableTransaction } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";

// D-2 / D-23 — THE CARRIED BALANCE MEETS THE PAYOUT.
//
// Two actions, mirroring the two halves of lib/carry-balance.ts:
//   payoutCarryOffer   reads. Produces the offer, pre-ticked only when the
//                      organizer chose "deduct" when adding this member.
//   deductCarryFromPayout  writes. Requires a confirmation that comes from
//                      the organizer's own input, never a default.
//
// The deduction is a real ledger PAYMENT, not a quiet adjustment: the member
// paid the balance out of their payout, and the story on their page must read
// that way two years later (2.18).

/** Everything the collect panel needs to render the offer. */
export type PayoutCarryOffer = {
  payoutId: string;
  personId: string;
  personName: string;
  offer: CarryOffer;
};

async function loadPayoutContext(payoutId: string) {
  return prisma.payout.findUnique({
    where: { id: payoutId },
    select: {
      id: true,
      netAmount: true,
      status: true,
      luckyNumber: {
        select: {
          number: true,
          participation: {
            select: {
              id: true,
              carryIntent: true,
              carryIntentAt: true,
              carryIntentAmount: true,
              cycle: { select: { name: true } },
              person: {
                select: {
                  id: true,
                  nameEnglishFirst: true,
                  ledgerEntries: { select: { type: true, amount: true } },
                },
              },
            },
          },
        },
      },
    },
  });
}

/** What to offer for this payout — or why nothing is offered. */
export async function payoutCarryOffer(input: { payoutId: string }): Promise<
  { ok: true; data: PayoutCarryOffer } | { ok: false; error: string }
> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    // 2.4: an offer names a member and an amount.
    if (await getSetting("presentationMode")) {
      return { ok: false as const, error: "Hidden in presentation mode." };
    }
    const payout = await loadPayoutContext(input.payoutId);
    if (!payout) return { ok: false as const, error: "Payout not found." };

    const participation = payout.luckyNumber.participation;
    const person = participation.person;
    const balance = ledgerBalance(person.ledgerEntries);

    const intent = participation.carryIntent;
    return {
      ok: true as const,
      data: {
        payoutId: payout.id,
        personId: person.id,
        personName: person.nameEnglishFirst,
        offer: carryOffer({
          ledgerBalance: balance,
          payoutNet: payout.netAmount,
          intention:
            isCarryChoice(intent) && participation.carryIntentAt
              ? {
                  choice: intent,
                  amountAtChoice: participation.carryIntentAmount ?? 0,
                  decidedAt: participation.carryIntentAt,
                  cycleName: participation.cycle.name,
                }
              : null,
        }),
      },
    };
  } catch (e) {
    console.error("payoutCarryOffer failed:", e);
    return { ok: false as const, error: `Could not load the balance. ${errorMessage(e)}` };
  }
}

/**
 * Take part of a carried balance out of a payout.
 *
 * `confirmedByOrganizer` is threaded straight from the caller's input and is
 * never defaulted here — the guard test in lib/carry-balance.test.ts fails if
 * this file ever hardcodes it.
 */
export async function deductCarryFromPayout(input: {
  payoutId: string;
  amount: number;
  confirmedByOrganizer: boolean;
}) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const result = await serializableTransaction(async (tx) => {
      const payout = await loadPayoutContext(input.payoutId);
      if (!payout) return { ok: false as const, error: "Payout not found." };

      const participation = payout.luckyNumber.participation;
      const person = participation.person;
      const balance = ledgerBalance(person.ledgerEntries);

      // THE ONE gate. Re-read inside the transaction so a balance that moved
      // since the panel rendered cannot be over-deducted.
      const applied = applyCarryDeduction({
        confirmedByOrganizer: input.confirmedByOrganizer,
        amount: input.amount,
        ledgerBalance: balance,
        payoutNet: payout.netAmount,
      });
      if (!applied.ok) return applied;

      await tx.payout.update({
        where: { id: payout.id },
        data: { netAmount: applied.data.netAfter },
      });

      // A real ledger payment, so the person's story reads honestly: they
      // settled it out of their payout, on this date, for this cycle.
      await tx.ledgerEntry.create({
        data: {
          personId: person.id,
          type: "PAYMENT",
          amount: applied.data.deducted,
          description: `Deducted from payout — ${participation.cycle.name}, number #${payout.luckyNumber.number}`,
          occurredAt: new Date(),
        },
      });

      await logAudit(tx, {
        entity: "Payout",
        entityId: payout.id,
        action: "update",
        summary:
          `${formatMoney(applied.data.deducted)} of ${person.nameEnglishFirst}'s carried balance ` +
          `deducted from their payout, confirmed by the organizer (D-23). ` +
          `Payout net ${formatMoney(payout.netAmount)} -> ${formatMoney(applied.data.netAfter)}; ` +
          `balance ${formatMoney(balance)} -> ${formatMoney(applied.data.balanceAfter)}.`,
        before: { netAmount: payout.netAmount, carriedBalance: balance },
        after: { netAmount: applied.data.netAfter, carriedBalance: applied.data.balanceAfter },
      });

      return {
        ok: true as const,
        data: { ...applied.data, personId: person.id, personName: person.nameEnglishFirst },
      };
    });

    if (result.ok) {
      revalidatePath("/admin/collections");
      revalidatePath("/admin/waiting");
      revalidatePath("/admin/balances");
      revalidatePath(`/admin/people/${result.data.personId}`);
    }
    return result;
  } catch (e) {
    console.error("deductCarryFromPayout failed:", e);
    return { ok: false as const, error: `Could not record the deduction. ${errorMessage(e)}` };
  }
}
