import { logAudit } from "./audit";
import { formatMoney } from "./format";
import type { Prisma } from "./generated/prisma/client";

// REVERSING A CARRY DEDUCTION (D-23, 2.18).
//
// A deduction is ONE fact expressed in TWO rows: `Payout.netAmount` goes down,
// and a `LedgerEntry` of type PAYMENT says the member settled that much of
// their carried balance out of it. Both halves have to move together, in both
// directions.
//
// THE DEFECT THIS CLOSES. Only the payout half was reversible. Five paths
// destroy or reset a payout —
//
//   deletePayout · removeWinnerFromWeek · undoDraw · movePayoutToWeek (which
//   writes netAmount back to gross − fee) · assignPayoutManually's replace ·
//   removal from the cycle
//
// — and every one of them left the PAYMENT entry standing. The member's
// balance still read as settled while the payout was gone or restored to full:
// they collected the whole amount AND kept the credit. Nothing in the repo
// ever deleted or updated a LedgerEntry, so there was no path back.
//
// The asymmetry was visible inside `deletePayout` itself, which calls
// `unsettlePayout` to reverse the winner-week settlement — because that half
// has a foreign key — and did nothing for the carry deduction, because that
// half had none. It has one now (LedgerEntry.payoutId), and this is its
// mirror of `unsettlePayout`.
//
// WHY DELETE RATHER THAN WRITE A COMPENSATING ENTRY. The payment is not being
// refunded; it is being un-done, because the payout it came out of is being
// un-done in the same transaction. `unsettlePayout` deletes the settlement
// receipt for exactly this reason. The audit entry keeps the story.
//
// THE PAYOUT'S NET IS NOT TOUCHED HERE. Every caller is already writing it:
// deleting the row, resetting it to gross − fee, or taking a figure the
// organizer typed. Restoring it here would fight them.

export async function reverseCarryDeduction(
  tx: Prisma.TransactionClient,
  payoutId: string,
  reason: string,
): Promise<{ restored: number; entries: number }> {
  const entries = await tx.ledgerEntry.findMany({
    where: { payoutId, type: "PAYMENT" },
    include: { person: { select: { nameEnglishFirst: true } } },
  });
  if (entries.length === 0) return { restored: 0, entries: 0 };

  let restored = 0;
  for (const entry of entries) {
    await tx.ledgerEntry.delete({ where: { id: entry.id } });
    restored += entry.amount;
    await logAudit(tx, {
      entity: "LedgerEntry",
      entityId: entry.personId,
      action: "delete",
      summary:
        `${formatMoney(entry.amount)} of ${entry.person.nameEnglishFirst}'s carried balance is ` +
        `OWED AGAIN: it had been deducted from a payout, and ${reason}. Without this the ` +
        `balance would read as settled while the money never left.`,
      before: { amount: entry.amount, description: entry.description, payoutId },
    });
  }
  return { restored, entries: entries.length };
}

/** The clause a caller appends to its own audit summary. */
export function carryReversalClause(result: { restored: number; entries: number }): string {
  if (result.entries === 0) return "";
  return (
    ` ${formatMoney(result.restored)} of carried balance that had been deducted from this ` +
    `payout is owed again.`
  );
}
