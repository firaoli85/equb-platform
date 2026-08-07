// D-23 / 2.18 — A CARRIED BALANCE IS NEVER TAKEN AUTOMATICALLY.
//
// This is the least-defended important protection in the platform, so it lives
// here as pure, tested law rather than as a branch in a wizard. A member who
// owes money from a previous cycle must never discover it was quietly removed
// from the payout they were counting on.
//
// THE SHAPE OF THE PROTECTION. Two functions, and the split between them IS
// the rule:
//
//   carryOffer()            decides what to OFFER. It can never apply
//                           anything — it returns a description, and the
//                           `deducted` amount does not exist in its result
//                           type. There is no code path from an intention to
//                           a smaller payout that does not pass through the
//                           second function.
//
//   applyCarryDeduction()   performs the arithmetic, and REQUIRES an explicit
//                           organizer confirmation in its input. Without
//                           `confirmedByOrganizer: true` it refuses; the
//                           refusal is a value, not an exception, so a caller
//                           cannot ignore it by not catching.
//
// An "intention" recorded when the member was added to the cycle changes only
// whether the offer arrives PRE-TICKED. It never changes whether a
// confirmation is required.

export type CarryChoice = "leave" | "deduct" | "settle-now";

export function isCarryChoice(value: unknown): value is CarryChoice {
  return value === "leave" || value === "deduct" || value === "settle-now";
}

/** What the organizer chose when this member was added to this cycle. */
export type CarryIntention = {
  choice: CarryChoice;
  /** The balance at the moment the choice was made — it may have moved since. */
  amountAtChoice: number;
  decidedAt: Date;
  /** The cycle it was decided for, for the "where this came from" sentence. */
  cycleName: string;
};

/**
 * The OFFER. Deliberately has no field that could be mistaken for an applied
 * deduction — the only numbers here are `balance` and `suggested`, and
 * `suggested` is a proposal.
 */
export type CarryOffer =
  | {
      kind: "none";
      /** Why nothing is offered — shown so silence is never a mystery. */
      reason: string;
    }
  | {
      kind: "offer";
      /** What they still carry, right now — not what it was at the choice. */
      balance: number;
      /** The most that could come out of this payout. */
      maxDeductible: number;
      /** What the tick-box proposes. Always ≤ maxDeductible. */
      suggested: number;
      /** True only when the organizer already chose "deduct" for this cycle. */
      preTicked: boolean;
      /** "You chose this when adding them to Cycle 2." — or null. */
      origin: string | null;
      /** The payout net if the organizer confirms the suggestion. */
      netIfApplied: number;
    };

/**
 * What to offer when a payout is about to be handed over.
 *
 * Nothing is offered when there is no balance, or no payout to take it from.
 * A "leave" or "settle-now" intention still produces an offer — the organizer
 * may change his mind at the table, and 2.2 says his discretion is a feature —
 * but it arrives UNTICKED, so the default action is to hand over the full
 * amount.
 */
export function carryOffer(input: {
  /** The person's live ledger balance in cents. */
  ledgerBalance: number;
  /** The payout's net, in cents, after any winner-week settlement. */
  payoutNet: number;
  /** The recorded intention for this cycle, if one was made. */
  intention?: CarryIntention | null;
}): CarryOffer {
  const balance = Math.max(0, Math.trunc(input.ledgerBalance));
  const payoutNet = Math.max(0, Math.trunc(input.payoutNet));
  const intention = input.intention ?? null;

  if (balance === 0) {
    return { kind: "none", reason: "They carry no balance." };
  }
  if (payoutNet === 0) {
    return {
      kind: "none",
      reason: "There is nothing left in this payout to deduct from.",
    };
  }

  // Never take more than the payout holds, and never more than is owed. A
  // deduction that overdraws a payout would create money that does not exist.
  const maxDeductible = Math.min(balance, payoutNet);
  const preTicked = intention?.choice === "deduct";

  return {
    kind: "offer",
    balance,
    maxDeductible,
    suggested: maxDeductible,
    preTicked,
    origin: preTicked ? originSentence(intention!) : null,
    netIfApplied: payoutNet - maxDeductible,
  };
}

/** Where a pre-ticked offer came from, in the organizer's own history. */
export function originSentence(intention: CarryIntention): string {
  return `You chose this when adding them to ${intention.cycleName}.`;
}

/**
 * Why a deduction cannot go through, or null when it can.
 *
 * `confirmedByOrganizer` is the whole point: it is a required field, and a
 * `false` value refuses. There is no default, so a caller that forgets it
 * fails to type-check rather than silently deducting.
 */
export function deductionRefusal(input: {
  confirmedByOrganizer: boolean;
  amount: number;
  ledgerBalance: number;
  payoutNet: number;
}): string | null {
  if (!input.confirmedByOrganizer) {
    return "A carried balance is never taken automatically — the organizer must confirm this deduction.";
  }
  if (!Number.isSafeInteger(input.amount) || input.amount < 1) {
    return "Enter how much of the balance to take from this payout.";
  }
  if (input.amount > input.ledgerBalance) {
    return "That is more than they carry.";
  }
  if (input.amount > input.payoutNet) {
    return "That is more than this payout holds.";
  }
  return null;
}

export type AppliedDeduction = {
  /** What actually came out. */
  deducted: number;
  /** The payout net after the deduction. */
  netAfter: number;
  /** The ledger balance after it. */
  balanceAfter: number;
};

/**
 * THE ONLY PLACE a payout is reduced by a carried balance.
 *
 * Returns a refusal instead of throwing, so the caller must handle it to get
 * at the numbers. `confirmedByOrganizer` has no default anywhere in this file.
 */
export function applyCarryDeduction(input: {
  confirmedByOrganizer: boolean;
  amount: number;
  ledgerBalance: number;
  payoutNet: number;
}): { ok: true; data: AppliedDeduction } | { ok: false; error: string } {
  const refusal = deductionRefusal(input);
  if (refusal !== null) return { ok: false as const, error: refusal };
  return {
    ok: true as const,
    data: {
      deducted: input.amount,
      netAfter: input.payoutNet - input.amount,
      balanceAfter: input.ledgerBalance - input.amount,
    },
  };
}

/** How the choice is recorded in the audit trail — one wording, one place. */
export function carryChoiceSummary(choice: CarryChoice): string {
  switch (choice) {
    case "leave":
      return "left on the ledger — the balance stands unchanged";
    case "deduct":
      return (
        "to be DEDUCTED from their payout in this cycle — an INTENTION only. " +
        "The deduction is offered when they are paid out and requires confirmation; " +
        "it is never applied automatically (D-23)"
      );
    case "settle-now":
      return "to be settled now — the organizer records a payment or a write-off separately";
  }
}
