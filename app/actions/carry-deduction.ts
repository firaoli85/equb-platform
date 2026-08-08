"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { refuseIfCycleClosed } from "@/lib/cycle-guard";
import {
  applyCarryDeduction,
  carryOffer,
  isCarryChoice,
  type CarryOffer,
} from "@/lib/carry-balance";
import { formatMoney } from "@/lib/format";
import { ledgerBalance } from "@/lib/ledger";
import { PRESENTATION_HIDDEN } from "@/lib/presentation";
import { Prisma } from "@/lib/generated/prisma/client";
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

/**
 * THE RE-READ MUST BE INSIDE THE TRANSACTION.
 *
 * This issued a query on the plain `prisma` client while being called from
 * inside `serializableTransaction`, under a comment claiming it re-read
 * "inside the transaction so a balance that moved since the panel rendered
 * cannot be over-deducted". It did not: a separate pooled connection in its
 * own autocommit snapshot registers NO read on ledger_entries, so Postgres SSI
 * had no read-set to conflict on.
 *
 * The consequence, on a member holding TWO numbers and therefore two payouts —
 * ordinary here, and four of the 27 live members are that shape: open both
 * collect panels and deduct the same $1,000 balance from each. The two
 * transactions touch different payout rows, so there is no write-write
 * conflict, and neither read the ledger transactionally. Both commit. Two
 * $1,000 PAYMENT entries against a $1,000 debt, `ledgerBalance` clamps the
 * negative to zero, and every surface reads "settled" while the member is
 * $1,000 short in cash.
 *
 * With the read inside the transaction the rw-dependency is detected, one side
 * aborts 40001, and the retry re-reads a zero balance and refuses.
 */
async function loadPayoutContext(
  db: Prisma.TransactionClient | typeof prisma,
  payoutId: string,
) {
  return db.payout.findUnique({
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
    // A read, outside any transaction — the plain client is right here.
    const payout = await loadPayoutContext(prisma, input.payoutId);
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
    // 2.4 — this names a member and moves their money. Every sibling action
    // (recordLedgerPayment, forgiveBalance) has this guard; this one did not.
    if (await getSetting("presentationMode")) {
      return { ok: false as const, error: PRESENTATION_HIDDEN };
    }
    const result = await serializableTransaction(async (tx) => {
      // 2.9/2.14: a CLOSED cycle's books are final. Resolved through
      // lib/cycle-guard so the check is one line and cannot be skipped
      // for want of plumbing — which is how 14 actions lost it.
      await refuseIfCycleClosed(tx, { payoutId: input.payoutId });
      const payout = await loadPayoutContext(tx, input.payoutId);
      if (!payout) return { ok: false as const, error: "Payout not found." };

      const participation = payout.luckyNumber.participation;
      const person = participation.person;
      const balance = ledgerBalance(person.ledgerEntries);

      // A COLLECTED payout is cash that has already left. Deducting from it
      // would write a ledger PAYMENT recording a settlement that never
      // happened — the member has the whole amount in hand AND the credit.
      //
      // The only thing stopping this was the Collections UI rendering the
      // collect panel behind `status === "PENDING"`, which is precisely the
      // UI-hiding this codebase forbids everywhere else.
      if (payout.status === "COLLECTED") {
        return {
          ok: false as const,
          error:
            `That payout has already been handed over, so there is nothing left to deduct ` +
            `from. Record the money against ${person.nameEnglishFirst}'s carried balance on ` +
            `their own page instead — it is the same ledger, reached from the person.`,
        };
      }

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
          // THE LINK BACK. Without it nothing could reverse this half, so
          // deleting, moving or resetting the payout left the balance reading
          // as settled while the money never left (lib/carry-reversal.ts).
          payoutId: payout.id,
        },
      });

      // THE INTENTION IS NOW SPENT — clear it.
      //
      // carryIntent is written once, when the organizer adds the member to the
      // cycle, and it decides only whether this offer arrives PRE-TICKED
      // (schema: "an INTENTION and nothing more"). Nothing ever cleared it:
      // not the deduction, not a full ledger payment, not forgiveness. So a
      // decision made about ONE debt kept re-arming itself, and a member who
      // later picked up an unrelated balance — a second cycle, a shortfall at
      // close — met a pre-ticked "deduct from payout" box for a choice the
      // organizer never made about that money. D-23 is explicit that the
      // system offers and the human decides; a stale tick is the system
      // deciding quietly.
      //
      // The RECORD of the choice is not lost: the audit entry below names it,
      // and the ledger entry above is the money half.
      await tx.participation.update({
        where: { id: participation.id },
        data: { carryIntent: null, carryIntentAt: null, carryIntentAmount: null },
      });

      await logAudit(tx, {
        entity: "Payout",
        entityId: payout.id,
        action: "update",
        summary:
          `${formatMoney(applied.data.deducted)} of ${person.nameEnglishFirst}'s carried balance ` +
          `deducted from their payout, confirmed by the organizer (D-23). ` +
          `Payout net ${formatMoney(payout.netAmount)} -> ${formatMoney(applied.data.netAfter)}; ` +
          `balance ${formatMoney(balance)} -> ${formatMoney(applied.data.balanceAfter)}.` +
          (participation.carryIntent
            ? ` The "${participation.carryIntent}" intention recorded when they joined is now ` +
              `spent and has been cleared, so a later unrelated balance cannot arrive pre-ticked.`
            : ""),
        before: {
          netAmount: payout.netAmount,
          carriedBalance: balance,
          carryIntent: participation.carryIntent,
        },
        after: {
          netAmount: applied.data.netAfter,
          carriedBalance: applied.data.balanceAfter,
          carryIntent: null,
        },
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
