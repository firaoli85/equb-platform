// Lucky-number assignment rules: auto by default, full manual control always
// (2.23). Numbers are PER CYCLE; the @@unique([cycleId, number]) constraint
// remains the durable backstop underneath these checks.

/**
 * Validate organizer-typed numbers BEFORE saving: right count for the
 * contribution's split, positive whole numbers, no duplicates, none already
 * used in this cycle. Returns a plain-language reason or null when valid.
 */
export function validateManualNumbers(input: {
  numbers: readonly number[];
  requiredCount: number;
  taken: ReadonlySet<number>;
}): string | null {
  const { numbers, requiredCount, taken } = input;
  if (numbers.length !== requiredCount) {
    return `This contribution splits into ${requiredCount} number${requiredCount === 1 ? "" : "s"} — enter exactly ${requiredCount}.`;
  }
  for (const n of numbers) {
    if (!Number.isSafeInteger(n) || n < 1) {
      return `"${n}" is not a valid lucky number — use positive whole numbers.`;
    }
  }
  const seen = new Set<number>();
  for (const n of numbers) {
    if (seen.has(n)) return `Number ${n} is entered twice.`;
    seen.add(n);
  }
  for (const n of numbers) {
    if (taken.has(n)) return `Number ${n} is already taken in this cycle.`;
  }
  return null;
}

/**
 * Auto-assignment: reuse the preferred (carried-over) numbers when the whole
 * set is free and matches the needed count; otherwise the next FREE
 * SEQUENTIAL values counting up from 1 (1, 2, 3, …, skipping anything
 * taken) — the organizer never types a number unless he wants a specific
 * one, and gaps left by edits are reused naturally.
 */
export function chooseAutoNumbers(input: {
  count: number;
  taken: ReadonlySet<number>;
  preferred?: readonly number[];
}): number[] {
  const { count, taken, preferred } = input;
  if (
    preferred &&
    preferred.length === count &&
    new Set(preferred).size === count &&
    preferred.every((n) => Number.isSafeInteger(n) && n >= 1 && !taken.has(n))
  ) {
    return [...preferred];
  }
  const chosen: number[] = [];
  for (let candidate = 1; chosen.length < count; candidate++) {
    if (!taken.has(candidate)) chosen.push(candidate);
  }
  return chosen;
}
