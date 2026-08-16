// CLEARING A WEEK — which receipts go, and what else that touches.
//
// WHY THIS IS NOT "DELETE THE WEEK'S MONEY". A week has no money of its own. A
// `PaymentEvent` is a RECEIPT — one amount the member handed over — and
// `PaymentAllocation` records where that amount currently lands, oldest debt
// first (2.15). `rebuild.ts` deletes every allocation and replays the events on
// each edit, so the split is a REPLAY, not a stored fact.
//
// So "clear week 13" can only mean: delete the receipts whose money currently
// lands on week 13. And a receipt of $2,500 recorded when week 13 was owed $800
// lands $800 on week 13 and $1,700 on week 14 — deleting it takes both. That is
// not a bug to hide; it is what removing that receipt does, and the organizer
// has to be told before he presses it, not after (2.15: the allocation is shown
// before it is committed).
//
// NO NEGATIVE MONEY, EVER (Oli). Clearing DELETES receipts. Nothing here or in
// the action that uses it writes a compensating negative row: the equb has no
// such thing, and a negative receipt would be a second way to represent "this
// did not happen" that every total would then have to know about.

/** One receipt, with where its money currently sits. */
export type ClearableEvent = {
  eventId: string;
  amount: number;
  /** Week numbers this receipt's money currently lands on, and how much. */
  lands: { weekNumber: number; applied: number }[];
  /** Payout settlements are not ordinary money — see settlement-receipt.ts. */
  isPinned: boolean;
};

export type WeekClearPlan = {
  /** The receipts that would be deleted, oldest first. */
  eventIds: string[];
  /** Their total, in cents. What leaves the member's record. */
  totalRemoved: number;
  /** Every week that loses money, including ones he did not select. */
  weeksAffected: number[];
  /**
   * Weeks that lose money WITHOUT being asked to — the honest disclosure.
   *
   * Empty is the ordinary case and says so. Non-empty is the case that must be
   * on screen before he presses: a receipt that waterfalled past the week he is
   * clearing takes the later weeks with it.
   */
  weeksAffectedBeyondSelection: number[];
  /**
   * Settlement receipts found on these weeks, which are NOT deleted.
   *
   * A settlement is the winner's own week taken out of their payout, and the
   * payout's netAmount was decremented by exactly that amount. Deleting it
   * without putting that back charges the member twice, so the single-receipt
   * undo refuses it by name and so does this — but a bulk action must not fail
   * ENTIRELY because one receipt is special. It clears the rest and says which
   * it left.
   */
  skippedPinned: { eventId: string; amount: number }[];
};

/**
 * What clearing these weeks would do.
 *
 * PURE, so the preview the organizer reads and the deletion the server performs
 * are computed by the same function from the same facts. A preview that
 * described a different outcome than the commit would be worse than no preview.
 */
export function planWeekClear(input: {
  events: readonly ClearableEvent[];
  /** The weeks he ticked. */
  weekNumbers: readonly number[];
}): WeekClearPlan {
  const targets = new Set(input.weekNumbers);
  const hits = input.events.filter((e) => e.lands.some((l) => targets.has(l.weekNumber)));

  const skippedPinned = hits
    .filter((e) => e.isPinned)
    .map((e) => ({ eventId: e.eventId, amount: e.amount }));
  const removable = hits.filter((e) => !e.isPinned);

  const affected = new Set<number>();
  for (const e of removable) for (const l of e.lands) affected.add(l.weekNumber);

  return {
    eventIds: removable.map((e) => e.eventId),
    totalRemoved: removable.reduce((sum, e) => sum + e.amount, 0),
    weeksAffected: [...affected].sort((a, b) => a - b),
    weeksAffectedBeyondSelection: [...affected].filter((w) => !targets.has(w)).sort((a, b) => a - b),
    skippedPinned,
  };
}

/**
 * The sentence the organizer reads before he presses.
 *
 * IT NAMES THE SPILL. "3 receipts totalling $2,500" is the easy half; "week 14
 * loses money too" is the half he would otherwise discover afterwards, on a
 * screen he was not looking at.
 */
export function weekClearSummary(
  plan: WeekClearPlan,
  formatMoney: (cents: number) => string,
): string {
  if (plan.eventIds.length === 0) {
    return plan.skippedPinned.length > 0
      ? "Nothing can be cleared here — the only money on these weeks came from a payout settlement, which has to be undone from the draw."
      : "There is nothing recorded on these weeks.";
  }
  const receipts = `${plan.eventIds.length} receipt${plan.eventIds.length === 1 ? "" : "s"}`;
  const spill =
    plan.weeksAffectedBeyondSelection.length === 0
      ? ""
      : ` This also takes money off week${plan.weeksAffectedBeyondSelection.length === 1 ? "" : "s"} ` +
        `${plan.weeksAffectedBeyondSelection.join(", ")}, because a receipt that covered more than one week cannot be split.`;
  const pinned =
    plan.skippedPinned.length === 0
      ? ""
      : ` ${plan.skippedPinned.length} payout settlement${plan.skippedPinned.length === 1 ? " is" : "s are"} left in place — undo the draw to remove ${plan.skippedPinned.length === 1 ? "it" : "them"}.`;
  return (
    `${receipts} totalling ${formatMoney(plan.totalRemoved)} will be deleted.` +
    `${spill}${pinned} Each week is then recalculated from what is left.`
  );
}
