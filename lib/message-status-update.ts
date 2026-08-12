// WHAT A STATUS CALLBACK IS ALLOWED TO CHANGE.
//
// Twilio delivers these AT LEAST ONCE and IN NO GUARANTEED ORDER. The same
// callback arrives twice; a `sent` overtakes a `failed` for the same message.
// Applied naively, that walks a dead message back to delivered — which is the
// same false claim this whole change exists to stop, arriving by a different
// route.
//
// Pure, so both properties can be proven without a database: applying the same
// callback twice changes nothing the second time, and a terminal row never
// regresses.

import { isTerminal, loggedStatusFor, type LoggedStatus } from "./twilio-status";

export type StatusUpdate =
  | {
      /** Write these fields to the row. */
      apply: true;
      status: LoggedStatus;
      error: string | null;
    }
  | {
      /** Leave the row exactly as it is, for the stated reason. */
      apply: false;
      reason: string;
    };

/**
 * The error text a failure callback should record.
 *
 * Twilio sends ErrorCode as a string and often sends no message at all, so the
 * code is the durable part — 63112 is the whole diagnosis. Named here rather
 * than assembled at the call site so the log reads consistently.
 */
export function callbackErrorText(
  errorCode: string | null | undefined,
  errorMessage: string | null | undefined,
): string | null {
  const code = errorCode?.trim();
  const detail = errorMessage?.trim();
  if (!code && !detail) return null;
  if (code && detail) return `Twilio ${code}: ${detail}`;
  if (code) return `Twilio error ${code} — the message was not delivered.`;
  return detail ?? null;
}

/**
 * Decide what a callback does to a row.
 *
 * @param current  the row's status right now
 * @param incoming Twilio's MessageStatus word from the callback
 */
export function statusUpdateFor(input: {
  current: LoggedStatus;
  incomingStatus: string;
  errorCode?: string | null;
  errorMessage?: string | null;
}): StatusUpdate {
  const incoming = loggedStatusFor(input.incomingStatus);

  // TERMINAL NEVER REGRESSES, and this is the out-of-order guard. A row that
  // Twilio already told us FAILED did fail; a later `sent` for the same SID is
  // an overtaking callback, not news. Same for a delivered row.
  if (isTerminal(input.current)) {
    // Re-applying the identical terminal state is the duplicate-callback case:
    // still a no-op, but worth distinguishing in the reason so a log reader can
    // tell a duplicate from a genuine conflict.
    if (incoming === input.current) {
      return { apply: false, reason: `Duplicate ${incoming} callback — already recorded.` };
    }
    return {
      apply: false,
      reason:
        `Ignored ${incoming} callback: this message is already ${input.current}, which is ` +
        `terminal. Twilio does not guarantee callback order, so a later word does not ` +
        `outrank an earlier terminal one.`,
    };
  }

  // The row is ACCEPTED. Anything Twilio says now is news — including another
  // ACCEPTED (queued → sending), which changes nothing but is not a conflict.
  if (incoming === "ACCEPTED") {
    return { apply: false, reason: `Still ${incoming} — no change.` };
  }

  return {
    apply: true,
    status: incoming,
    error: incoming === "FAILED" ? callbackErrorText(input.errorCode, input.errorMessage) : null,
  };
}
