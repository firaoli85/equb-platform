// WHAT A SETTLEMENT RECEIPT IS, AND WHY IT IS NOT AN ORDINARY RECEIPT.
//
// When a member is drawn, the week they win is not paid out of their pocket —
// it is settled FROM their payout (rule 6). The system records that as a
// PaymentEvent pinned to that one week, and decrements Payout.netAmount by
// exactly the same figure. Two rows, one movement of money.
//
// So a settlement receipt is HALF of a pair. Change one half and the other
// half has to move with it, or money is created or destroyed:
//
//   shrink the receipt, leave the payout    → the difference vanishes
//   delete the receipt, leave the payout    → the week is owed AND the payout
//                                             stays reduced: charged twice
//
// The organizer cannot be expected to know that from a receipt row that looks
// exactly like every other receipt row. So the rule is stated here once,
// tested here, and enforced by both the edit and the delete paths.
//
// IDENTIFICATION IS STRUCTURAL, NEVER TEXTUAL. `pinnedWeekId != null` is the
// definition (see the schema comment on PaymentEvent). The UI used to sniff
// the notes for "settled from the payout" — and the same Save button that
// edits the amount can empty the notes, so a single edit could make a
// settlement receipt stop looking like one while the money link survived.

export type SettlementReceiptFields = {
  pinnedWeekId: string | null;
  settlementPayoutId: string | null;
};

/** A receipt that came out of a payout rather than out of a member's pocket. */
export function isSettlementReceipt(receipt: SettlementReceiptFields): boolean {
  return receipt.pinnedWeekId !== null && receipt.settlementPayoutId !== null;
}

/**
 * Why this receipt cannot be deleted from the receipts list, or null.
 *
 * Refuse rather than silently repair: a settlement receipt is a consequence of
 * a draw, and the honest way to remove it is to undo the thing that made it.
 */
export function settlementReceiptDeleteRefusal(
  receipt: SettlementReceiptFields,
): string | null {
  if (!isSettlementReceipt(receipt)) return null;
  return (
    "That receipt is a payout settlement, not a payment — it is the winner's own week " +
    "taken out of their payout. Deleting it here would leave the week owed AND the " +
    "payout reduced by the same money. Undo the draw, or remove that winner from the " +
    "week, to reverse it properly."
  );
}

/**
 * Why this receipt's AMOUNT cannot be edited from the receipts list, or null.
 *
 * The date, the method and the notes are description — they are still editable,
 * because correcting them harms nothing. The amount is the money link, and it
 * only ever moves as a pair with the payout: that happens on the participation
 * save (which resizes the receipt and moves the payout together) and nowhere
 * else.
 */
export function settlementReceiptAmountRefusal(args: {
  receipt: SettlementReceiptFields;
  amountBefore: number;
  amountAfter: number;
}): string | null {
  if (!isSettlementReceipt(args.receipt)) return null;
  if (args.amountBefore === args.amountAfter) return null;
  return (
    "That receipt is a payout settlement, not a payment — it is the winner's own week " +
    "taken out of their payout, and the payout was reduced by exactly this figure. " +
    "Changing it here would move one half of that pair and leave the other behind. " +
    // ONE destination, not two. This used to add "To correct the payout itself,
    // edit the payout on Collections" — and Collections had no settlement
    // awareness, so following that advice invented exactly the money this
    // refusal exists to protect. Editing the weekly amount is the only path
    // that moves both halves, so it is the only one named.
    "To change what the week costs, edit their weekly amount on the participation — " +
    "that resizes this receipt and moves the payout with it, as one operation. " +
    "The date, method and notes on this row can still be corrected."
  );
}
