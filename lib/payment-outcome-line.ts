// WHAT HAPPENED TO THEIR MESSAGE, in one sentence, beside the payment.
//
// THE GAP THIS CLOSES. `recordPayment` has always returned its messaging
// outcome and no screen rendered it. On 16 August 2026 a part-payment-completed
// message was reported as "no message was sent" — it had been queued correctly,
// with the right body, and the only surface that said so was a page the
// organizer had no reason to open. A record that exists and cannot be reached
// from where the work happened is indistinguishable from a lost one.
//
// 2.10 — NEVER LEAVE DOUBT, and the moment doubt starts is the moment the
// payment is recorded, not whenever he next opens Messages.

import type { SendOutcome } from "./messaging-engine";

export type OutcomeLine = {
  /** `queued` earns the link to Messages; `bad` earns the red. */
  kind: "queued" | "plain" | "bad";
  text: string;
};

/**
 * ACCEPTED IS NOT DELIVERED, and this sentence must not say it is.
 *
 * The distinction cost the platform real trust: 75 log rows sat at ACCEPTED
 * while Twilio's own records showed most delivered and one dropped by Meta. A
 * status line that reported "Sent" for a handover would put that same
 * conflation in front of the organizer at the moment he is deciding whether the
 * member has been told.
 */
export function paymentOutcomeLine(outcome: SendOutcome | null): OutcomeLine | null {
  // NULL MEANS THE MESSAGING PATH THREW and recordPayment survived it — the
  // money is recorded and nothing is known about the message. Silence here
  // would be the exact failure this function exists to end.
  if (!outcome) {
    return {
      kind: "bad",
      text: "Their message could not be prepared. The payment is recorded; check the message log.",
    };
  }
  switch (outcome.status) {
    case "SENT":
      return { kind: "plain", text: "Their message was delivered." };
    case "ACCEPTED":
      return {
        kind: "plain",
        text: "Their message went to WhatsApp. Delivery is not confirmed yet.",
      };
    case "QUEUED":
      return { kind: "queued", text: "Their message is waiting for you to send it." };
    case "FAILED":
      return { kind: "bad", text: `Their message failed: ${outcome.error}` };
    case "SKIPPED":
      // A SKIP IS NOT A FAILURE AND IS NOT A SUCCESS. The reason is the whole
      // content — "marked no messages", "no phone number on file", "nothing to
      // confirm" are different facts and he acts on each differently.
      return { kind: "plain", text: `No message was sent: ${outcome.reason}` };
  }
}
