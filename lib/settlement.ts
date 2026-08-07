// Settlement rules from the organizer's real practice (Aug 2026). Pure —
// no database, no I/O — so both new money rules are unit-tested law (2.24):
//
//  1. THE WINNER DOES NOT PAY THE WEEK THEY WIN. Their contribution for the
//     drawn week is deducted from the payout and the week is settled from
//     it — planWinnerWeekSettlement decides how much comes out of which
//     payout.
//
//  2. A PAID-OUT MEMBER CHANGING TERMS OWES (OR IS OWED) THE DIFFERENCE.
//     They hold money based on their OLD commitment; computeTermsSettlement
//     derives the gap between what they actually received and what the new
//     terms entitle them to, so the organizer settles it explicitly (2.18)
//     — never silently.

import { calculateFee, calculateGross, calculateNet } from "./money";

// ————————————————— 1. The winner's week —————————————————

export type WinnerWeekSettlementPlan = {
  /** How much to deduct from which payout, in order. */
  perPayout: { payoutId: string; deduct: number }[];
  totalSettled: number;
  /** What the payouts could not absorb — the caller must refuse if > 0. */
  unabsorbed: number;
};

/**
 * Settle the drawn week FROM the payout: whatever the member still owes on
 * that week comes out of their payout net(s), waterfalling across their
 * payouts in the given order. amountDue 0 (a SKIPPED week, or a week outside
 * their window) settles nothing. A DEFERRED week is still owed, so it settles
 * normally — deferral spares the chasing, not the debt.
 */
export function planWinnerWeekSettlement(input: {
  /** What this member owes on the drawn week (0 when excused). */
  amountDue: number;
  /** Receipts already recorded on that week's row. */
  alreadyPaidOnWeek: number;
  /** Their payouts from this draw, in deduction order. */
  payouts: readonly { payoutId: string; netAmount: number }[];
}): WinnerWeekSettlementPlan {
  const shortfall = Math.max(0, input.amountDue - input.alreadyPaidOnWeek);
  const perPayout: { payoutId: string; deduct: number }[] = [];
  let remaining = shortfall;
  for (const payout of input.payouts) {
    if (remaining === 0) break;
    const deduct = Math.min(remaining, Math.max(0, payout.netAmount));
    if (deduct > 0) {
      perPayout.push({ payoutId: payout.payoutId, deduct });
      remaining -= deduct;
    }
  }
  return { perPayout, totalSettled: shortfall - remaining, unabsorbed: remaining };
}

/**
 * A settlement receipt is PINNED to the drawn week: on any replay it
 * allocates to that week only — never oldest-first, never another week.
 * Anything that does not fit is unallocated and the caller must refuse
 * (money is never silently dropped).
 */
export function allocatePinned(
  amount: number,
  week: { amountDue: number; amountAlreadyPaid: number; isSkipped: boolean },
): { applied: number; unallocated: number } {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new RangeError(`pinned amount must be non-negative integer cents, got ${amount}`);
  }
  // Only a SKIPPED week owes nothing. A deferred week is still owed, so the
  // settlement lands on it exactly as it would on any other week.
  const owed = week.isSkipped ? 0 : Math.max(0, week.amountDue - week.amountAlreadyPaid);
  const applied = Math.min(amount, owed);
  return { applied, unallocated: amount - applied };
}

// ————————————————— 2. Terms change after a payout —————————————————

export type TermsSettlement = {
  oldEntitlementGross: number;
  newEntitlementGross: number;
  newFee: number;
  /** What the NEW terms entitle them to take home: gross − fee. */
  newEntitlementNet: number;
  /** What they actually got (payout nets + week contributions settled from them). */
  alreadyReceived: number;
  /**
   * alreadyReceived − newEntitlementNet.
   * Positive: they hold too much. Negative: they are owed more. 0: square.
   */
  gap: number;
  /** Weeks at the new weekly whose net entitlement equals what they took (fractional). */
  balancingWeeksExact: number;
  /** The nearest whole number of weeks to that figure (min 1). */
  balancingWeeksWhole: number;
};

/**
 * The real numbers behind a terms change for an already-drawn member:
 *   old entitlement = oldWeekly × oldWeeks
 *   new entitlement = newWeekly × newWeeks − fee at the new figure
 *   gap             = already received − new entitlement (net)
 */
export function computeTermsSettlement(input: {
  oldWeeklyAmount: number;
  oldWeeksCommitted: number;
  newWeeklyAmount: number;
  newWeeksCommitted: number;
  feePercent: number;
  alreadyReceived: number;
}): TermsSettlement {
  const oldGross = calculateGross(input.oldWeeklyAmount, input.oldWeeksCommitted);
  const newGross = calculateGross(input.newWeeklyAmount, input.newWeeksCommitted);
  const newFee = calculateFee(newGross, input.feePercent);
  const newNet = calculateNet(newGross, newFee);

  // Weeks w where net(newWeekly × w) = received → w = received / (weekly × (1 − fee)).
  const basisPoints = Math.round(input.feePercent * 100);
  const netPerWeek = (input.newWeeklyAmount * (10_000 - basisPoints)) / 10_000;
  const exact = netPerWeek > 0 ? input.alreadyReceived / netPerWeek : 0;

  return {
    oldEntitlementGross: oldGross,
    newEntitlementGross: newGross,
    newFee,
    newEntitlementNet: newNet,
    alreadyReceived: input.alreadyReceived,
    gap: input.alreadyReceived - newNet,
    balancingWeeksExact: exact,
    balancingWeeksWhole: Math.max(1, Math.round(exact)),
  };
}

// ————————— Idempotency: prior settlements on the ledger (audit H4) —————————
//
// Recognition is keyed by a MACHINE TAG in LedgerEntry.notes, never by the
// human description. The description is organizer-facing prose containing a
// cycle NAME, and names are editable free text — matching on them would break
// the moment a cycle is renamed (re-charging a settled gap), could collide
// between names, and could be spoofed by a hand-typed entry. The tag carries
// the cycle ID, which never changes.

export type SettlementKind = "debt" | "credit" | "returned";

/** The tag written into LedgerEntry.notes so a settlement can be recognised. */
export function settlementLedgerTag(cycleId: string, kind: SettlementKind): string {
  return `settlement:${cycleId}:${kind}`;
}

/** The human-facing opening of a settlement's description (2.18: the story). */
export function settlementDescriptionPrefix(cycleName: string): string {
  return `Settlement in ${cycleName}:`;
}

/**
 * What earlier terms settlements for THIS cycle already recognised:
 *   debt     → +amount  (an obligation was recognised)
 *   credit   → −amount  (money owed back to them was recognised)
 *   returned → 0        (cash PAYS a recognised debt; it does not un-recognise it)
 * Untagged entries — ordinary carried balances, manual ledger payments — are
 * ignored entirely. Feeding (total gap − recognised) into the settlement makes
 * a repeated edit charge only the DIFFERENCE, and a reversal self-cancels.
 */
export function settledSoFarFromLedger(
  entries: readonly {
    type: "DEBT" | "PAYMENT" | "FORGIVEN";
    amount: number;
    notes: string | null;
  }[],
  cycleId: string,
): number {
  const debt = settlementLedgerTag(cycleId, "debt");
  const credit = settlementLedgerTag(cycleId, "credit");
  let recognised = 0;
  for (const entry of entries) {
    const tag = entry.notes?.trim();
    if (!tag) continue;
    // The TYPE must agree with the tag. `notes` is also a free-text field the
    // organizer can write through recordLedgerPayment, so a tag alone is not
    // proof — a hand-typed "settlement:…:debt" on a PAYMENT row would
    // otherwise be counted as a recognised obligation.
    if (tag === debt && entry.type === "DEBT") recognised += entry.amount;
    else if (tag === credit && entry.type === "PAYMENT") recognised -= entry.amount;
  }
  return recognised;
}

/**
 * Resizing a win-week settlement when the weekly changes: the settled week
 * now costs `newWeeklyAmount`, and the DIFFERENCE must go back to the payout
 * the settlement came from — without the credit, that cash simply vanishes
 * from the books and every later gap is computed off a false total.
 */
export function resizeWinnerWeekSettlement(
  eventAmount: number,
  newWeeklyAmount: number,
): { resized: number; credit: number } {
  const resized = Math.min(eventAmount, newWeeklyAmount);
  return { resized, credit: eventAmount - resized };
}

// ————————————————— Confirmation (type the member's name) —————————————————

/**
 * Does the typed confirmation match the member? Case- and whitespace-
 * insensitive against the English first name, "first last", or the Amharic
 * name — the organizer types whichever name they know them by.
 */
export function nameConfirmed(
  typed: string,
  person: { nameEnglishFirst: string; nameEnglishLast?: string | null; nameAmharic: string },
): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const candidate = norm(typed);
  if (candidate.length === 0) return false;
  const options = [
    person.nameEnglishFirst,
    `${person.nameEnglishFirst} ${person.nameEnglishLast ?? ""}`,
    person.nameAmharic,
  ].map(norm);
  return options.includes(candidate);
}
