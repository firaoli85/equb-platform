// The carried balance (2.18): what a PERSON still owes across cycles —
// people carry debts, cycles don't. DEBT entries raise it; PAYMENT and
// FORGIVEN entries clear it. Derived on every read, never stored (2.14).
//
// The balance must be readable TWO YEARS LATER, so it is not a number — it is
// a story: where each debt came from, every payment against it, everything
// written off, and the running total after each event.

export type LedgerEntryType = "DEBT" | "PAYMENT" | "FORGIVEN";

export type LedgerEntryInput = { type: LedgerEntryType; amount: number };

/**
 * Cents still owed. Never negative — overpayment counts as settled in full,
 * not as credit the group owes back (that is a different decision, made
 * explicitly).
 *
 * FORGIVEN reduces the balance exactly like a payment. The DIFFERENCE between
 * them is historical, not arithmetic: one is money received, the other is a
 * decision the organizer made. The story keeps them apart; the total does not
 * need to.
 */
export function ledgerBalance(entries: readonly LedgerEntryInput[]): number {
  const total = entries.reduce(
    (sum, e) => sum + (e.type === "DEBT" ? e.amount : -e.amount),
    0,
  );
  return Math.max(0, total);
}

/** What has actually been received against the balance, ever. */
export function totalRepaid(entries: readonly LedgerEntryInput[]): number {
  return entries.filter((e) => e.type === "PAYMENT").reduce((s, e) => s + e.amount, 0);
}

/** What has been written off, ever — never conflated with money received. */
export function totalForgiven(entries: readonly LedgerEntryInput[]): number {
  return entries.filter((e) => e.type === "FORGIVEN").reduce((s, e) => s + e.amount, 0);
}

/** Everything that was ever owed, before anything was paid or written off. */
export function totalRaised(entries: readonly LedgerEntryInput[]): number {
  return entries.filter((e) => e.type === "DEBT").reduce((s, e) => s + e.amount, 0);
}

export type LedgerStoryEntry<T extends LedgerEntryInput = LedgerEntryInput> = T & {
  /** What the balance stood at immediately AFTER this entry. */
  balanceAfter: number;
};

export type LedgerStory<T extends LedgerEntryInput = LedgerEntryInput> = {
  entries: LedgerStoryEntry<T>[];
  balance: number;
  raised: number;
  repaid: number;
  forgiven: number;
};

/**
 * The balance with its history: oldest first, each entry carrying the running
 * total after it. This is what makes a balance readable long after the cycle
 * that created it is gone (2.9 — a readable archive).
 *
 * The caller supplies entries in the order they HAPPENED; this does not sort,
 * because "when it happened" is the caller's stored fact (occurredAt), not
 * something to be guessed here.
 */
export function ledgerStory<T extends LedgerEntryInput>(
  entries: readonly T[],
): LedgerStory<T> {
  let running = 0;
  const withRunning = entries.map((e) => {
    running += e.type === "DEBT" ? e.amount : -e.amount;
    // The displayed running total never goes below zero, for the same reason
    // the balance does not: a person cannot owe a negative amount.
    return { ...e, balanceAfter: Math.max(0, running) };
  });
  return {
    entries: withRunning,
    balance: ledgerBalance(entries),
    raised: totalRaised(entries),
    repaid: totalRepaid(entries),
    forgiven: totalForgiven(entries),
  };
}

/**
 * How much of a balance a write-off may clear. Forgiving more than is owed is
 * refused rather than silently capped — the organizer should see the real
 * figure, not have his number quietly changed.
 */
export function forgivenessRefusal(input: {
  balance: number;
  amount: number;
}): string | null {
  if (input.balance <= 0) return "This person carries no balance — there is nothing to forgive.";
  if (!Number.isSafeInteger(input.amount) || input.amount < 1) {
    return "Enter the amount to write off.";
  }
  if (input.amount > input.balance) {
    return `That is more than the ${input.balance} cents carried. Forgive the balance or less.`;
  }
  return null;
}
