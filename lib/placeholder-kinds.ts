// WHAT KIND OF THING A PLACEHOLDER HOLDS.
//
// A LEAF MODULE, deliberately. `lib/messages.ts` imports the approved registry
// as a VALUE, and the registry needs these constants as VALUES to guard its
// ContentVariables. Putting them in either file would close a real runtime
// import cycle. The only thing this file imports is a TYPE, which is erased at
// build, so nothing points back.

import type { PlaceholderName } from "./messages";

/**
 * What a placeholder renders when the fact does not apply.
 *
 * It is a legitimate value in its place — {lastPaymentWeek} for a member who
 * has never paid is honestly "—" — and that is exactly what makes it
 * dangerous. It is not undefined, not null and not empty, so every ordinary
 * "is this missing?" test passes it straight through to the member.
 */
export const NO_VALUE = "—";

/**
 * The placeholders that carry MONEY.
 *
 * These may never render as {@link NO_VALUE} in a delivered statement.
 *
 * THE MESSAGE THAT PROVED IT, received by a real member:
 *
 *     "Hi Firaoli, your Equb payout for week 12 is —.
 *      Your contributions continue to week 20."
 *
 * Told he had won; not told how much. Nothing failed — the send succeeded, the
 * log said SENT, and the only way to find it was to read the message.
 *
 * Two of these five can actually reach the sentinel, and they are exactly the
 * two fed from `extras` rather than from standing: `amountReceived` and
 * `payoutAmount`. A caller that forgets its extras produces a hole where the
 * figure belongs. The other three come from `formatMoney` on a derived number
 * and are always a real amount, "$0" included.
 */
export const MONEY_PLACEHOLDERS = [
  "amountOwed",
  "weeklyAmount",
  "totalPaid",
  "amountReceived",
  "payoutAmount",
] as const satisfies readonly PlaceholderName[];

export function isMoneyPlaceholder(name: string): boolean {
  return (MONEY_PLACEHOLDERS as readonly string[]).includes(name);
}

/**
 * The ONLY placeholder that may legitimately render as {@link NO_VALUE}.
 *
 * WHY THIS IS AN ALLOWLIST AND NOT A BLOCKLIST. Guarding money alone left the
 * same hole open in two more places, because the sentinel is not a money
 * problem — it is a MISSING FACT problem, and money was simply where it was
 * noticed first:
 *
 *   PAYMENT_CONFIRMED {{3}} weeksCovered
 *     "we received $750 for your Equb — recorded on week(s) —."
 *     Reachable today: nothing guards it. A confirmation that cannot say which
 *     weeks the money landed on is the one question the message exists to
 *     answer.
 *
 *   LATE_NOTICE {{2}} lateWeeks
 *     "your Equb week(s) — closed without a payment recorded."
 *     Usually unreachable, because sendDecision refuses a chasing message with
 *     no LATE week — but only when `weeks` is supplied. A caller that omits
 *     them skips that gate entirely and lands here.
 *
 * `lastPaymentWeek` is the exception and the reason a blocklist looked
 * sufficient: for a member who has never paid, "—" is the honest answer and
 * reads correctly in the sentence.
 *
 * Default-deny, so a placeholder added later is guarded by not being listed
 * rather than by somebody remembering to list it.
 */
export const DASHABLE_PLACEHOLDERS = [
  "lastPaymentWeek",
  // The v2 form of the same fact — "1 (Aug 16)", or honestly "—" for a
  // member who has never paid. Same sentence, same legitimacy.
  "myLastPaymentWeek",
] as const satisfies readonly PlaceholderName[];

/** True when this placeholder is allowed to be the sentinel in a real send. */
export function mayRenderAsNoValue(name: string): boolean {
  return (DASHABLE_PLACEHOLDERS as readonly string[]).includes(name);
}
