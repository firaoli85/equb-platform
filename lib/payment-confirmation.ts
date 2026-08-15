// WHAT A MEMBER IS TOLD WHEN THEIR MONEY LANDS — the last mile of the
// one-truth engine (docs/ONE_TRUTH_ENGINE.md phase 4b-ii).
//
// THE BUG THIS EXISTS TO END. Every recorded payment fired one hard-coded
// template: "we received $200 for your Equb — recorded on your week 14. Thank
// you." True of a full payment, and a lie of a partial one — Markos paid $200
// of a $2,000 week and was thanked as though the week were settled, then chased
// for it days later. The allocation had always been right; only the sentence
// was wrong, and the sentence is the part the member actually holds.
//
// SO THE MESSAGE IS ROUTED, NOT ASSUMED. The engine already names what a
// payment did (`describePayment`); `paymentMessageFor` picks the one template
// that documents it, `paymentMessageExtras` composes its phrases, and this
// reads the organizer's setting to decide whether it goes now or waits.
//
// THE TWO AXES, BOTH READ HERE (the 4b-i ruling):
//   WHO ORIGINATES IT   — a payment does. That is why this function exists at
//                         all, and why none of these four types appears in the
//                         per-member picker (`EVENT_TRIGGERED_KEYS`).
//   DOES IT SEND ITSELF — the phase-1 config gate, per key, below. Event-
//                         triggered says nothing about automatic: a clean
//                         confirmation self-sends exactly as it always has,
//                         and every message about money still owed WAITS.

import {
  describePayment,
  paymentMessageFor,
  type PaymentEventTruth,
  type PaymentMessageKey,
} from "./engine";
import { configKeyForPaymentMessage, paymentMessageExtras } from "./payment-message";
import {
  loadStandingFacts,
  queueStatement,
  recordUnsentMessage,
  sendStatement,
  type SendOutcome,
} from "./messaging-engine";
import { getMessagingConfig } from "./settings";

/** A week of the member's window as it stood BEFORE this payment. */
export type WeekBeforePayment = {
  weekNumber: number;
  date: Date;
  amountDue: number;
  covered: number;
  isDeferred: boolean;
  isSkipped: boolean;
};

/**
 * Why a queued message is waiting, in the organizer's words.
 *
 * NAMES THE SETTING THAT PARKED IT. "Waiting for review" tells him nothing he
 * can act on; this tells him which switch decided, so the queue is never a
 * mystery he has to go looking for the cause of (2.10).
 */
function queueReasonFor(key: PaymentMessageKey): string {
  return key === "PAYMENT_CONFIRMED_V4"
    ? "Payment confirmations are set to send by hand (Settings → Messaging)."
    : "Messages about money still owed are set to send by hand (Settings → Messaging).";
}

export type PaymentConfirmation = {
  outcome: SendOutcome;
  /** Which template the routing picked, or null when nothing was to be said. */
  key: PaymentMessageKey | null;
  /** The event the routing read — returned so the caller can show its reasoning. */
  event: PaymentEventTruth | null;
};

/**
 * Tell one member what their payment did, or park the sentence for review.
 *
 * NEVER THROWS AND NEVER FAILS THE PAYMENT. The money is already recorded when
 * this runs; a messaging problem is reported, logged, and survived. Callers get
 * an outcome they can show, never an exception.
 */
export async function confirmPayment(input: {
  participationId: string;
  /** The receipt amount, in cents. */
  amount: number;
  receivedAt: Date;
  weeklyAmount: number;
  /** The member's first week of the cycle — what their own numbering counts from. */
  startWeek: number;
  /** Their window as it stood before this payment, captured in the transaction. */
  weeksBefore: readonly WeekBeforePayment[];
}): Promise<PaymentConfirmation> {
  // POST-COMMIT STANDING, read once. `weeksBehindAfter` is a fact about the
  // member AFTER the money landed, so it cannot come from the before-state the
  // transaction captured, and it must not be guessed — the engine's own rule.
  // The same load also proves the participation still exists.
  const loaded = await loadStandingFacts(input.participationId);
  if (!loaded) {
    return {
      outcome: { status: "SKIPPED", reason: "Participation not found." },
      key: null,
      event: null,
    };
  }

  const event = describePayment({
    amount: input.amount,
    today: input.receivedAt,
    weeklyAmount: input.weeklyAmount,
    weeksBefore: input.weeksBefore,
    weeksBehindAfter: loaded.standing.weeksBehind,
  });

  const key = paymentMessageFor(event);
  if (key === null) {
    // A REAL ANSWER, not a hole. A payment that allocated nothing — every week
    // of the window already settled, or the commit refusal in 2.15 — has
    // nothing to confirm, and a confirmation would describe a week it did not
    // touch.
    return {
      outcome: {
        status: "SKIPPED",
        reason: "This payment did not land on any week, so there is nothing to confirm.",
      },
      key: null,
      event,
    };
  }

  const composed = paymentMessageExtras({
    key,
    event,
    dateByWeek: new Map(input.weeksBefore.map((w) => [w.weekNumber, w.date])),
    startWeek: input.startWeek,
  });
  if (!composed.ok) {
    // A COMPOSITION FAILURE IS VISIBLE OR IT IS NOTHING. This is BEFORE
    // deliver(), so nothing downstream would have written a row: the money
    // would be recorded, the member told nothing, and the log silent. On
    // 15 Aug 2026 that combination was indistinguishable from a payment that
    // never tried, and it is the worst outcome in the whole message path.
    console.error(`[confirmPayment] ${key}: ${composed.error}`);
    await recordUnsentMessage({
      personId: loaded.participation.person.id,
      phone: loaded.participation.person.phone,
      key,
      status: "FAILED",
      reason: composed.error,
      trigger: "AUTOMATIC",
    });
    return {
      outcome: { status: "FAILED", body: "", error: composed.error },
      key,
      event,
    };
  }

  // ————— THE CONFIG GATE (phase 1), asked per routed key —————
  const config = await getMessagingConfig();
  const auto = config.message[configKeyForPaymentMessage(key)].auto;

  const outcome = auto
    ? await sendStatement({
        participationId: input.participationId,
        key,
        trigger: "AUTOMATIC",
        extras: composed.extras,
      })
    : await queueStatement({
        participationId: input.participationId,
        key,
        extras: composed.extras,
        reason: queueReasonFor(key),
      });

  return { outcome, key, event };
}
