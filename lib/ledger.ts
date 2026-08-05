// The carried balance (2.18): what a PERSON still owes across cycles —
// people carry debts, cycles don't. DEBT entries raise it, PAYMENT entries
// settle it. Derived on every read, never stored (2.14).

export type LedgerEntryInput = { type: "DEBT" | "PAYMENT"; amount: number };

/** Cents still owed. Never negative — overpayments count as settled in full. */
export function ledgerBalance(entries: readonly LedgerEntryInput[]): number {
  const total = entries.reduce(
    (sum, e) => sum + (e.type === "DEBT" ? e.amount : -e.amount),
    0,
  );
  return Math.max(0, total);
}
