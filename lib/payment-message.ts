// THE PAYMENT MESSAGE — what the member is told a payment did.
//
// Phase 4 of the one-truth engine. The engine already names the event
// (`describePayment`); this composes the four placeholders the five approved
// templates carry, and nothing else. Pure, so every sentence a member can
// receive is testable without a database or a network.
//
// THE RULES THESE OBEY (docs/ONE_TRUTH_ENGINE.md §3.7, ruled 15 Aug 2026):
//
//   NO RECEIPT DATES, anywhere. A recorded date is not the date the money
//   moved, and `PaymentAllocation` is a REPLAY that `rebuild.ts` re-derives on
//   every edit — so a dated split can silently change while the member holds a
//   message asserting the old one. A message states facts that STAY TRUE.
//
//   ANCHOR TO THE WEEK: the member's own week number plus that week's
//   SCHEDULED date, both stable cycle facts.
//
//   NO RANGES. "week 14 (Aug 16), week 15 (Aug 23) and week 16 (Aug 30)",
//   never "14–16" — which is also two en dashes the v3 voice rules ban.

import { memberFullDate, ownWeekNumber, shortDate } from "./member-week-dates";
import { formatMoney } from "./format";
import {
  priorPaidOnCompletedWeek,
  type PaymentEventTruth,
  type PaymentMessageKey,
} from "./engine";
import type { MessageExtras } from "./messages";
import type { ConfigurableMessageKey } from "./messaging-config";
import { isChasedStatus } from "./derived";

/** A week as the composers need it: the member's own number and its date. */
export type MessageWeek = { weekNumber: number; date: Date };

/**
 * How many weeks `paymentBreakdown` names before it summarises.
 *
 * A long catch-up would otherwise run past WhatsApp's 1024-character body. The
 * overflow is STATED, never silently dropped: eight named weeks plus "and N
 * more weeks" is both true and short.
 */
export const BREAKDOWN_CAP = 8;

function ownLabel(week: MessageWeek, startWeek: number): string {
  return `week ${ownWeekNumber(week.weekNumber, startWeek)} (${shortDate(week.date)})`;
}

/**
 * "week 14 (Aug 16), week 15 (Aug 23) and week 16 (Aug 30)".
 *
 * ONE VARIABLE CARRIES THE WHOLE LIST — the GROUP_ANNOUNCEMENT precedent, whose
 * {{2}} is the organizer's entire free composition. A Meta template body is
 * fixed and its variable COUNT is fixed; the CONTENT length is not.
 *
 * SINGLE-LINE COMMA PROSE, deliberately: Meta rejects a parameter containing a
 * newline, a tab, or four consecutive spaces, so an itemised list must be
 * sentence-shaped rather than bulleted.
 */
export function paymentBreakdown(
  weeks: readonly MessageWeek[],
  startWeek: number,
  cap: number = BREAKDOWN_CAP,
): string {
  const sorted = [...weeks].sort((a, b) => a.weekNumber - b.weekNumber);
  if (sorted.length === 0) return "";
  const labels = sorted.slice(0, cap).map((w) => ownLabel(w, startWeek));
  const hidden = sorted.length - labels.length;
  if (hidden > 0) {
    // TRUE, AND SHORT. "and 4 more weeks" tells the member the list continues;
    // a silent truncation would read as a complete list that is missing money.
    return `${labels.join(", ")} and ${hidden} more week${hidden === 1 ? "" : "s"}`;
  }
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/**
 * "$1,800 is still due for your week 14 (Aug 16)".
 *
 * A WHOLE SENTENCE, so the template needs no glue around it and the clause can
 * never read as a fragment when the figure is long.
 */
export function stillDueOnWeek(
  remainder: number,
  week: MessageWeek,
  startWeek: number,
): string {
  return `${formatMoney(remainder)} is still due for your ${ownLabel(week, startWeek)}`;
}

/** "week 14 (Sunday, August 16)" — one week, the full-date form. */
export function weekLabelFull(week: MessageWeek, startWeek: number): string {
  return `week ${ownWeekNumber(week.weekNumber, startWeek)} (${memberFullDate(week.date)})`;
}

/**
 * What LATE_NOTICE_V4 chases — the OLDEST week the member is actually behind on.
 *
 * WHY THIS EXISTS AT ALL. `late_notice_v3` opened "we did not receive your
 * payment", which is false for anyone who part paid, and then quoted their
 * WHOLE outstanding total where the sentence named one week. v4 says what is
 * owed on ONE named week, so the figure and the week finally agree — and that
 * requires composing the phrase from that week's own remainder, which is what
 * this does.
 *
 * THE SAME WEEKS THE GATE READS. `isChasedStatus` is the predicate
 * `hasChaseableWeeks` uses to decide whether the notice may go at all, so the
 * week named here is by construction one of the weeks that justified sending
 * it. A deferred week is not among them (D-42): the money is still owed and
 * every statement says so, but nobody is chased for it.
 *
 * OLDEST FIRST, matching 2.15's waterfall — the week their next payment will
 * land on is the week the notice should be about.
 *
 * Returns null when nothing is chaseable, which is a real answer: the gate will
 * refuse the send for the same reason, and inventing a week here would put a
 * figure in a message the platform was right not to send.
 */
export function lateNoticeExtras(input: {
  weeks: readonly {
    weekNumber: number;
    date: Date;
    amountDue: number;
    coveredAtCurrentRate: number;
    status: string;
  }[];
  startWeek: number;
}): MessageExtras | null {
  const chased = [...input.weeks]
    .filter((w) => isChasedStatus(w.status))
    .sort((a, b) => a.weekNumber - b.weekNumber)[0];
  if (!chased) return null;
  const remainder = Math.max(0, chased.amountDue - chased.coveredAtCurrentRate);
  if (remainder <= 0) return null;
  return {
    stillDueOnWeek: stillDueOnWeek(
      remainder,
      { weekNumber: chased.weekNumber, date: chased.date },
      input.startWeek,
    ),
  };
}

// ————————————————— THE TWO AXES, READ (phase 4b-ii) —————————————————

/**
 * WHICH SETTING DECIDES whether this payment message sends itself.
 *
 * The second of the two axes 4b-i separated (lib/messages.ts,
 * `EVENT_TRIGGERED_KEYS`). All four keys here are event-triggered — a payment
 * originates them, the organizer never picks them off a list — and that says
 * nothing about whether they auto-send. This says it.
 *
 * ONE SWITCH PER DECISION THE ORGANIZER MAKES, not one per template. He makes
 * two:
 *
 *   "Does a clean confirmation go out on its own?"   → PAYMENT_CONFIRMED
 *   "Does a notice about money still owed?"          → PARTIAL_CONFIRMED
 *
 * Three templates share the second because they are one decision: each of them
 * tells a member something about a week that was not paid in full when the
 * money arrived, and a wrong one of those is worse than a late one. Splitting
 * them into three switches would offer a distinction he has never asked to
 * make, and §3.0 rule 7 is explicit that a setting exists to answer a question
 * somebody actually has.
 *
 * PARTIAL_COMPLETED sits under the partial switch for the same reason, even
 * though its week ends up fully paid: what makes it delicate is the figure it
 * quotes for what was ALREADY paid, which is the one number in the whole set a
 * member can check against their own memory.
 */
export function configKeyForPaymentMessage(key: PaymentMessageKey): ConfigurableMessageKey {
  return key === "PAYMENT_CONFIRMED_V4" ? "PAYMENT_CONFIRMED" : "PARTIAL_CONFIRMED";
}

export type PaymentExtrasResult =
  | { ok: true; extras: MessageExtras }
  | { ok: false; error: string };

/**
 * The placeholders one routed payment message carries — composed once, here.
 *
 * PURE, AND THE ONLY PLACE THESE PHRASES ARE BUILT. The send path SURFACES
 * these values (`placeholderValues`) and never re-derives them; re-deriving
 * would be a second implementation of a sentence a member is about to be held
 * to.
 *
 * A MISSING WEEK DATE IS A REFUSAL, never a blank. Every phrase here names a
 * week, and a week with no stored date cannot be named — so this returns the
 * reason rather than a sentence with a hole in it, and the caller records a
 * failure the organizer can find. That is the same rule the ContentVariables
 * boundary enforces one layer down, asked at the point the evidence still
 * exists.
 */
export function paymentMessageExtras(input: {
  key: PaymentMessageKey;
  event: PaymentEventTruth;
  /** Every week of the member's window, by number, with its SCHEDULED date. */
  dateByWeek: ReadonlyMap<number, Date>;
  /** The member's first week of the cycle — what `ownWeekNumber` counts from. */
  startWeek: number;
}): PaymentExtrasResult {
  const { key, event, dateByWeek, startWeek } = input;

  function week(weekNumber: number): MessageWeek | null {
    const date = dateByWeek.get(weekNumber);
    return date ? { weekNumber, date } : null;
  }

  // The weeks this payment SETTLED, in one list: settled outright and finished
  // off are both "that paid …" to a member, and the breakdown states them in
  // week order rather than in two groups nobody asked for.
  const settled = [...event.fullWeeks, ...event.completedWeeks].sort((a, b) => a - b);

  const amountReceived = event.amount;

  if (key === "PAYMENT_CONFIRMED_V4" || key === "PAYMENT_CONFIRMED_WITH_PARTIAL") {
    const weeks: MessageWeek[] = [];
    for (const n of settled) {
      const w = week(n);
      if (!w) return { ok: false, error: `Week ${n} has no stored date, so it cannot be named.` };
      weeks.push(w);
    }
    if (weeks.length === 0) {
      return { ok: false, error: `${key} needs at least one week it paid, and none were given.` };
    }
    const breakdown = paymentBreakdown(weeks, startWeek);
    if (key === "PAYMENT_CONFIRMED_V4") {
      return { ok: true, extras: { amountReceived, paymentBreakdown: breakdown } };
    }
    if (event.partialWeek === null) {
      return { ok: false, error: `${key} needs a part-paid week, and there is none.` };
    }
    const partial = week(event.partialWeek);
    if (!partial) {
      return {
        ok: false,
        error: `Week ${event.partialWeek} has no stored date, so it cannot be named.`,
      };
    }
    return {
      ok: true,
      extras: {
        amountReceived,
        paymentBreakdown: breakdown,
        stillDueOnWeek: stillDueOnWeek(event.remainder, partial, startWeek),
      },
    };
  }

  if (key === "PARTIAL_CONFIRMED") {
    if (event.partialWeek === null) {
      return { ok: false, error: `${key} needs a part-paid week, and there is none.` };
    }
    const partial = week(event.partialWeek);
    if (!partial) {
      return {
        ok: false,
        error: `Week ${event.partialWeek} has no stored date, so it cannot be named.`,
      };
    }
    return {
      ok: true,
      extras: {
        amountReceived,
        partialWeekLabel: weekLabelFull(partial, startWeek),
        stillDueOnWeek: stillDueOnWeek(event.remainder, partial, startWeek),
      },
    };
  }

  // PARTIAL_COMPLETED — the one week that was already part paid and is now
  // finished. The router only picks it when there is EXACTLY one, so the
  // subtraction below is about the week the sentence names.
  const completedWeek = event.completedWeeks[0];
  if (completedWeek === undefined) {
    return { ok: false, error: `${key} needs a completed week, and there is none.` };
  }
  const finished = week(completedWeek);
  if (!finished) {
    return { ok: false, error: `Week ${completedWeek} has no stored date, so it cannot be named.` };
  }
  // amountDue − applied, from the engine. NEVER the receipt sum, which reads a
  // table rebuild.ts deletes and re-creates on every edit, and never the event
  // total, which is wrong by exactly the unallocated remainder.
  const prior = priorPaidOnCompletedWeek(event);
  if (prior === null) {
    return { ok: false, error: `${key} cannot say what was already paid toward week ${completedWeek}.` };
  }
  return {
    ok: true,
    extras: {
      amountReceived,
      priorPaidOnWeek: prior,
      partialWeekLabel: weekLabelFull(finished, startWeek),
    },
  };
}
