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
