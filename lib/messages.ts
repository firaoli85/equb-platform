// State-aware statements (2.21): a message carries the member's TRUE derived
// position — never a bare label. Pure and unit-tested: template body plus
// standing facts in, rendered text out. The action layer supplies FRESH
// standing at send time, so nothing rendered here can ever be stale.
//
// The send DECISIONS (2.20) are pure too: the automatic-vs-manual gate, the
// hardship flag, and the imported-history rule are tested law in this file,
// not UI behavior.

import { isChasedStatus } from "./derived";
import { formatDateLongUTC, formatMoney } from "./format";
import {
  memberFullDate,
  memberWeekLabelFull,
  memberWeeksListPhraseFromCycleWeeks,
  memberWeeksPhraseFromCycleWeeks,
  ownWeekNumber,
} from "./member-week-dates";
// The sentinel and the money classification live in a leaf module so the
// registry can import them as values without closing an import cycle.
import { NO_VALUE } from "./placeholder-kinds";
// The registry imports only a TYPE from this file (PlaceholderName), which is
// erased at build, so this is not a runtime cycle.
import {
  APPROVED_TEMPLATE_KEYS,
  APPROVED_TEMPLATES,
  DRAFT_TEMPLATES,
  type ApprovedTemplateKey,
} from "./whatsapp-templates";

export const MESSAGE_KEYS = [
  "PAYMENT_CONFIRMED",
  // THE PHASE 4 PAYMENT SET. Which one documents a payment is decided by
  // paymentMessageFor() in lib/engine.ts, never by a caller picking a name.
  "PAYMENT_CONFIRMED_V4",
  "PAYMENT_CONFIRMED_WITH_PARTIAL",
  "PARTIAL_CONFIRMED",
  "PARTIAL_COMPLETED",
  "LATE_NOTICE_V4",
  "BEHIND_NOTICE",
  "LATE_NOTICE",
  "WINNER_ANNOUNCEMENT",
  "CYCLE_CLOSING_STATEMENT",
  // The welcome — APPROVED and armed since 13 Aug 2026 (whatsapp_welcome,
  // v2 set). Listed after the five so `MANUAL_MESSAGE_KEYS[0]`, which is
  // what the batch composer opens on, stays the behind notice.
  "WHATSAPP_WELCOME",
  // The per-member BROADCAST (v2 set, 13 Aug 2026): one text the organizer
  // composes once, delivered individually so each member reads their own
  // name. Sent from the announcement card, never from the per-member panel
  // or the batch — see BROADCAST_MESSAGE_KEYS below.
  "GROUP_ANNOUNCEMENT",
  "LOCKOUT_NOTICE",
] as const;

/**
 * The types that send themselves as the direct result of an action that
 * just happened (2.20): the mark-paid confirmation, and the lockout notice
 * a member triggers with their own failed attempts. Everything else is a
 * judgement and must be MANUAL.
 */
export const AUTOMATIC_MESSAGE_KEYS = [
  // THE LEGACY KEY STAYS until one delivered send retires it (see
  // lib/whatsapp-templates.ts). Nothing routes to it any more — paymentMessageFor
  // names v4 — but a key that can still be sent by hand must still be allowed to.
  "PAYMENT_CONFIRMED",
  // THE ONE THAT ACTUALLY FIRES since 15 Aug 2026. A clean full payment routes
  // here, and the gate refuses an AUTOMATIC trigger for any key not on this
  // list, so leaving it off would have turned every confirmation into a skip.
  "PAYMENT_CONFIRMED_V4",
  "LOCKOUT_NOTICE",
] as const;

/**
 * The types that CHASE a member for money they have not paid. These are the
 * only ones deferral suppresses (organizer ruling, Aug 2026): a deferred week
 * is still owed, but the member is not chased for it. Statements — the
 * confirmation, the winner announcement, the closing statement — are NOT
 * chasing, so they always state the true amount owed, deferral included.
 */
export const CHASING_MESSAGE_KEYS = [
  "BEHIND_NOTICE",
  "LATE_NOTICE",
  // The v4 replacement chases the same money by the same rule, so deferral
  // must suppress it identically. Absent, a paused week would be chased by
  // the new notice and not the old — the two disagreeing about one member.
  "LATE_NOTICE_V4",
] as const;

/**
 * WHO ORIGINATES THE MESSAGE — a payment, or the organizer.
 *
 * EVENT-TRIGGERED IS NOT THE SAME QUESTION AS AUTO-SEND, and conflating them
 * is what this constant exists to stop. Two different questions were wearing
 * one name (`AUTOMATIC_MESSAGE_KEYS`), which is §5.10 in the message layer:
 *
 *   1. WHO ORIGINATES IT?  ← this constant
 *      A payment landing does. The organizer cannot CHOOSE to send a
 *      part-payment confirmation to someone who has not part paid, so these
 *      never belong in the per-member picker (`applicableTypes`).
 *
 *   2. DOES IT SEND ITSELF, or wait for him?  ← the phase-1 config gate
 *      (lib/messaging-config.ts, Settings → Messaging). PAYMENT_CONFIRMED
 *      auto-sends; the four new payment types QUEUE for review by default,
 *      because a wrong partial notice is worse than a missed one.
 *
 * An event-triggered type can therefore be queued rather than automatic —
 * which is exactly what the four new ones are, and what no single flag could
 * express. `AUTOMATIC_MESSAGE_KEYS` keeps answering question 2 only.
 *
 * LATE_NOTICE_V4 is deliberately ABSENT: a reminder is the organizer's
 * judgement about a member, so it stays in the picker where he chooses it.
 */
export const EVENT_TRIGGERED_KEYS = [
  "PAYMENT_CONFIRMED",
  "PAYMENT_CONFIRMED_V4",
  "PAYMENT_CONFIRMED_WITH_PARTIAL",
  "PARTIAL_CONFIRMED",
  "PARTIAL_COMPLETED",
] as const;

export type MessageKey = (typeof MESSAGE_KEYS)[number];

export { NO_VALUE, MONEY_PLACEHOLDERS, isMoneyPlaceholder } from "./placeholder-kinds";

export function isMessageKey(value: string): value is MessageKey {
  return (MESSAGE_KEYS as readonly string[]).includes(value);
}

/**
 * The one text-to-everyone type. Sent per member — each recipient reads
 * their own name — from the announcement card alone, with the text as a
 * required extra composed at send time.
 */
export const BROADCAST_MESSAGE_KEYS = ["GROUP_ANNOUNCEMENT"] as const;

/**
 * The types the organizer sends by hand, per member or as a batch (2.20).
 * The automatic ones are absent on purpose: they fire from their own
 * events, never a batch button.
 */
export const MANUAL_MESSAGE_KEYS = MESSAGE_KEYS.filter(
  (k): k is MessageKey =>
    !(AUTOMATIC_MESSAGE_KEYS as readonly string[]).includes(k) &&
    // A PAYMENT ORIGINATES THESE, not the organizer (EVENT_TRIGGERED_KEYS).
    // Excluded on that axis rather than by being called "automatic", because
    // the four new ones are event-triggered AND queued — see the constant.
    !(EVENT_TRIGGERED_KEYS as readonly string[]).includes(k) &&
    // A broadcast is sent by hand, but never PER MEMBER by hand: it has its
    // own card, its own extras, and no per-member judgement to make. Listing
    // it here would put it on every profile with a preview it cannot render.
    !(BROADCAST_MESSAGE_KEYS as readonly string[]).includes(k),
);

// ————————————————— Facts: what a statement may say —————————————————

/**
 * The derived facts a template can reference — structurally satisfied by
 * getMemberStanding's payload (person + computeStanding, 2.14). Every number
 * is derived, never stored.
 */
export type StandingFacts = {
  name: string;
  weeklyAmount: number;
  weeksCommitted: number;
  currentCycleWeek: number;
  finishWeek: number;
  /**
   * The calendar date their own window ends (2.22: every member sees their own
   * finish DATE, always). Optional so older callers still render — the token
   * then falls back to the week number rather than printing nothing.
   */
  finishDate?: Date | null;
  /**
   * The calendar date their own window BEGINS — the day belonging to their
   * start week, from the stored row (2.14), never projected off a cycle start
   * date that may since have been corrected.
   *
   * Threaded exactly like finishDate above, and for the same reason: a member
   * never reads a cycle week number (UI_STANDARDS 8c), so "from week 14" is not
   * an available way to say this. Absent, the token renders as the no-value
   * sentinel rather than inventing a day.
   */
  startDate?: Date | null;
  /**
   * Where a member signs in — the `portalUrl` setting, read at send time.
   *
   * NOT A DERIVED FIGURE, and it sits here anyway. The welcome is the one
   * message that has to tell a member where to go, and the address has to be
   * identical in the PREVIEW the organizer reads and in the message that
   * leaves. Threading it through the one derivation both paths already share
   * (loadStandingFacts) is what makes those the same string; asking each of the
   * four render sites to fetch it themselves is how they stop being.
   */
  portalUrl?: string | null;
  weeksCredited: number;
  weeksBehind: number;
  amountOutstanding: number;
  totalPaid: number;
  lastPaymentWeek: number | null;
  /**
   * Per-week derived statuses; lets {lateWeeks} name the closed weeks — and,
   * since the v2 set, each week's STORED DATE (rule 7), so the my* tokens can
   * pair the member's own week numbers with real days. `date` is optional for
   * older callers; a my* token whose week lacks one renders the sentinel and
   * is REFUSED at the ContentVariables boundary rather than guessing a day.
   */
  weeks?: readonly { weekNumber: number; status: string; date?: Date }[];
};

/** Event facts that exist only at certain moments (a receipt, a draw). */
export type MessageExtras = {
  /** PAYMENT_CONFIRMED: the receipt amount, in cents. */
  amountReceived?: number;
  /** PAYMENT_CONFIRMED: the weeks this receipt landed on. */
  weeksCovered?: number[];
  /** WINNER_ANNOUNCEMENT: the net payout, in cents. */
  payoutNet?: number;
  /** WINNER_ANNOUNCEMENT: the week the number was drawn for. */
  drawnWeek?: number;
  /** LOCKOUT_NOTICE: how long the lock lasts, in minutes. */
  lockMinutes?: number;
  /** GROUP_ANNOUNCEMENT: the organizer's text, composed at send time. */
  announcementText?: string;

  // ————— THE PAYMENT EVENT (phase 4) —————
  //
  // COMPOSED BY THE CALLER, in lib/payment-message.ts, from the engine's
  // PaymentEventTruth. They arrive as finished phrases for the same reason
  // `announcementText` does: the sentence is domain logic, and re-deriving it
  // here would be a second implementation of what the engine already worked out.
  //
  // All four are NON-DASHABLE. Absent means the send is REFUSED at the
  // ContentVariables boundary, rather than Twilio filling the slot from its
  // approval sample and delivering an invented figure as fact.

  /** "week 14 (Aug 2), week 15 (Aug 9) and week 16 (Aug 16)" — never a range. */
  paymentBreakdown?: string;
  /** "$1,800 is still due for your week 14 (Aug 2)" — a whole sentence. */
  stillDueOnWeek?: string;
  /** "week 14 (Sunday, August 2)" — one week, full date. */
  partialWeekLabel?: string;
  /**
   * What the member had ALREADY paid toward the week this payment completed,
   * in cents. `amountDue − appliedToThatWeek`, never the receipt sum and never
   * the event total — see `priorPaidOnCompletedWeek` in lib/engine.ts.
   */
  priorPaidOnWeek?: number;
};

/**
 * Is there anything to chase this member ABOUT? Only a LATE week qualifies: by
 * definition it is unpaid, its window has closed, and it is neither deferred
 * nor skipped (2.16 — LATE is derived, and DEFERRED stands where LATE would).
 * A member whose entire shortfall sits on deferred weeks has nothing chaseable
 * — the debt is real and every statement still says so, but no reminder goes
 * out for it.
 */
export function hasChaseableWeeks(
  weeks: readonly { status: string }[] | undefined,
): boolean {
  // PART-PAID AND CHASED COUNTS (R2). A member owed $1,800 on a closed week
  // is chaseable; excluding them would drop a real debt off every chasing
  // path at once, which is exactly what the sixth state exists to prevent.
  return (weeks ?? []).some((w) => isChasedStatus(w.status));
}

/** "8" · "8–10" · "3, 8–10" — compact human form for a list of week numbers. */
export function formatWeekList(weeks: readonly number[]): string {
  const sorted = [...new Set(weeks)].sort((a, b) => a - b);
  if (sorted.length === 0) return NO_VALUE;
  const runs: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (const n of sorted.slice(1)) {
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    runs.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = n;
    prev = n;
  }
  runs.push(start === prev ? `${start}` : `${start}–${prev}`);
  return runs.join(", ");
}

/**
 * Every placeholder a template may use, filled from derived state. {amountOwed}
 * is the TRUE amount outstanding, deferred weeks included — a statement never
 * understates a debt just because we are not chasing it. Values
 * are display-ready strings; money renders through formatMoney. {week} is
 * the week most relevant to the message: the drawn week for a winner
 * announcement, the last week a receipt covered for a confirmation, and the
 * current cycle week otherwise.
 */
// The return type is INFERRED, not annotated `Record<string, string>`.
//
// That annotation erased the key names, so nothing downstream could tell
// {amountOwed} from {amuontOwed} until a member received a message with a
// literal token in it. `PlaceholderName` below reads the real keys off this
// object, which makes an invalid placeholder a compile error — and means the
// list can never drift from what this function actually returns, because
// there is no second list.
export function placeholderValues(standing: StandingFacts, extras: MessageExtras = {}) {
  const weeksPaid = Math.min(standing.weeksCredited, standing.weeksCommitted);
  const weeksLeft = Math.max(0, standing.weeksCommitted - weeksPaid);
  const lastCovered = extras.weeksCovered?.length
    ? Math.max(...extras.weeksCovered)
    : undefined;
  // Includes PART-PAID chased weeks (R2), so {myLateWeeks} and the amount
  // owed describe the same set. NOTE the message TEXT still says "we did not
  // receive your payment", which is false for a part payer — that wording is
  // Meta-frozen and is replaced in the messages phase. Behaviour here is
  // unchanged from before the sixth state: such a week was already LATE and
  // already named.
  const lateWeeks = (standing.weeks ?? [])
    .filter((w) => isChasedStatus(w.status))
    .map((w) => w.weekNumber);

  // ————— THE MEMBER-RELATIVE TOKENS (v2 set, 13 Aug 2026) —————
  //
  // Their own week numbers paired with stored dates — "2–3 (Aug 23 – Aug 30)"
  // — composed by lib/member-week-dates.ts. `startWeek` is derived, not a new
  // fact: their week 1 IS startWeek, and finishWeek = start + committed − 1.
  //
  // A week whose stored date is missing composes to the SENTINEL, never a
  // guessed day (rule 7) — and every my* token except myLastPaymentWeek is
  // non-dashable, so the send is refused at the ContentVariables boundary
  // with the reason, before anything reaches Twilio.
  const startWeek = standing.finishWeek - standing.weeksCommitted + 1;
  const weekDates = new Map(
    (standing.weeks ?? [])
      .filter((w): w is { weekNumber: number; status: string; date: Date } => w.date !== undefined)
      .map((w) => [w.weekNumber, w.date]),
  );
  const myPhrase = (cycleWeeks: readonly number[]): string => {
    if (cycleWeeks.length === 0) return NO_VALUE;
    try {
      return memberWeeksPhraseFromCycleWeeks({ cycleWeeks, startWeek, weekDates });
    } catch {
      // A named week with no stored date — refuse-at-boundary, never guess.
      return NO_VALUE;
    }
  };
  // The v3 forms (14 Aug 2026): plain enumeration, no ranges, no dashes.
  const myListPhrase = (cycleWeeks: readonly number[]): string => {
    if (cycleWeeks.length === 0) return NO_VALUE;
    try {
      return memberWeeksListPhraseFromCycleWeeks({ cycleWeeks, startWeek, weekDates });
    } catch {
      return NO_VALUE;
    }
  };
  // "13 (Sunday, August 9)" — one own week with its FULL date.
  const myFullLabel = (cycleWeek: number): string => {
    const date = weekDates.get(cycleWeek);
    if (!date) return NO_VALUE;
    try {
      return memberWeekLabelFull({ ownWeek: ownWeekNumber(cycleWeek, startWeek), date });
    } catch {
      return NO_VALUE;
    }
  };

  // PAID UP TO — the contiguous fully-PAID prefix of their own weeks. A gap
  // (an unpaid, late, deferred or part-paid week, or a missing row) ends the
  // prefix: "paid up to your week 11" promises every week through 11 is
  // settled, and nothing less. A member with no such prefix is paid up to
  // "the start (Sunday, May 17)" — their own start date — which is why this
  // token is ALWAYS composable and deliberately non-dashable (v3 rule: it
  // supersedes the v2 "—" sentinel for last-payment).
  let paidUpToCycleWeek: number | null = null;
  const ownWindowWeeks = (standing.weeks ?? [])
    .filter((w) => w.weekNumber >= startWeek && w.weekNumber <= standing.finishWeek)
    .sort((a, b) => a.weekNumber - b.weekNumber);
  for (const w of ownWindowWeeks) {
    if (w.weekNumber !== (paidUpToCycleWeek ?? startWeek - 1) + 1) break;
    if (w.status !== "PAID") break;
    paidUpToCycleWeek = w.weekNumber;
  }
  const startFullDate =
    standing.startDate ?? weekDates.get(startWeek) ?? null;
  const myPaidUpToWeek =
    paidUpToCycleWeek !== null
      ? myFullLabel(paidUpToCycleWeek)
      : startFullDate
        ? `the start (${memberFullDate(startFullDate)})`
        : NO_VALUE;

  return {
    name: standing.name,
    week: String(extras.drawnWeek ?? lastCovered ?? standing.currentCycleWeek),
    weeksPaid: String(weeksPaid),
    weeksTotal: String(standing.weeksCommitted),
    weeksLeft: String(weeksLeft),
    /**
     * PAYMENTS LEFT — committed minus paid, the COUNT STILL OWED. Same value
     * as {weeksLeft}, named for what it states: it is NOT calendar weeks
     * remaining, and the two split the moment a member is behind or ahead
     * (the 13-Aug finding). The v3 winner carries this one, with the finish
     * DATE as the run-until anchor beside it.
     */
    paymentsLeft: String(weeksLeft),
    weeksBehind: String(standing.weeksBehind),
    amountOwed: formatMoney(standing.amountOutstanding),
    lastPaymentWeek: standing.lastPaymentWeek === null ? NO_VALUE : String(standing.lastPaymentWeek),
    finishWeek: String(standing.finishWeek),
    finishDate: standing.finishDate ? formatDateLongUTC(standing.finishDate) : String(standing.finishWeek),
    // THE MEMBER'S OWN COUNT, PLURALISED — "10 weeks", never "10". The whole
    // point of the token is that it reads as a sentence a member holds in their
    // head ("I am paying for 10 weeks"), which is the frame UI_STANDARDS 8c
    // reserves for them. {weeksTotal} above is the same number as a bare
    // numeral, for templates that supply their own noun ("6 of 20 weeks").
    weeksCommitted: `${standing.weeksCommitted} ${standing.weeksCommitted === 1 ? "week" : "weeks"}`,
    startDate: standing.startDate ? formatDateLongUTC(standing.startDate) : NO_VALUE,
    // No .trim() and no String(): the setting is trimmed at the write
    // (updatePortalUrl), so an empty address is an empty string here, and the
    // sentinel is what a default-denied placeholder must be — the send is
    // refused for an empty portalUrl long before this renders.
    portalUrl: standing.portalUrl ? standing.portalUrl : NO_VALUE,
    weeklyAmount: formatMoney(standing.weeklyAmount),
    totalPaid: formatMoney(standing.totalPaid),
    amountReceived:
      extras.amountReceived === undefined ? NO_VALUE : formatMoney(extras.amountReceived),
    weeksCovered: extras.weeksCovered?.length ? formatWeekList(extras.weeksCovered) : NO_VALUE,
    lateWeeks: formatWeekList(lateWeeks),
    payoutAmount: extras.payoutNet === undefined ? NO_VALUE : formatMoney(extras.payoutNet),
    lockMinutes: extras.lockMinutes === undefined ? NO_VALUE : String(extras.lockMinutes),
    // ————— the member-relative tokens (v2) —————
    /** "2–3 (Aug 23 – Aug 30)" — the weeks THIS receipt covered, their numbering. */
    myWeeksCovered: extras.weeksCovered?.length ? myPhrase(extras.weeksCovered) : NO_VALUE,
    /**
     * "13 (Sunday, August 9)" — where they are today, in their own counting,
     * the v3 FULL-date form.
     *
     * CLAMPED to their own finish week. `currentCycleWeek` is the CYCLE's
     * calendar and keeps counting after a member's window ends — but their
     * record stops changing at their final week, so "the current week is
     * week 10" IS their frame's answer for a 10-week member at cycle week
     * 15. Unclamped, the lookup left their window, composed to the sentinel,
     * and the behind notice became permanently unsendable for exactly the
     * members most behind (every send a FAILED row, while the picker kept
     * offering it — the 14-Aug finding).
     */
    myCurrentWeek: myFullLabel(Math.min(standing.currentCycleWeek, standing.finishWeek)),
    /**
     * "11 (Sunday, July 26)", or "the start (Sunday, May 17)" for a member
     * with no fully-paid prefix — always composable, never dashed (v3).
     */
    myPaidUpToWeek,
    /**
     * "12 and 13 (Aug 2 and Aug 9)" — the LATE weeks, their numbering, the
     * v3 list form: no ranges, no dashes, dates grouped in one bracket.
     */
    myLateWeeks: lateWeeks.length === 0 ? NO_VALUE : myListPhrase(lateWeeks),
    /** The count beside the phrase — always the SAME set myLateWeeks names. */
    lateWeeksCount: String(lateWeeks.length),
    /** GROUP_ANNOUNCEMENT: the organizer's own words, required at the boundary. */
    // ————— the payment event (phase 4) —————
    //
    // SURFACED, NOT DERIVED. The caller composed these from the engine's event
    // (lib/payment-message.ts); this file hands them to the template, exactly
    // as it does the organizer's announcement text. Each renders the sentinel
    // when absent and none is dashable, so a missing one refuses the send
    // instead of inventing a week list or a remainder.
    paymentBreakdown: extras.paymentBreakdown ?? NO_VALUE,
    stillDueOnWeek: extras.stillDueOnWeek ?? NO_VALUE,
    partialWeekLabel: extras.partialWeekLabel ?? NO_VALUE,
    priorPaidOnWeek:
      extras.priorPaidOnWeek === undefined ? NO_VALUE : formatMoney(extras.priorPaidOnWeek),
    announcementText:
      extras.announcementText === undefined || extras.announcementText.trim() === ""
        ? NO_VALUE
        : extras.announcementText.trim(),
  };
}

/** Shown in the template editor so the organizer knows what can be said. */
/**
 * Every placeholder name a template may use, read off `placeholderValues`
 * itself so the two can never disagree.
 *
 * A WhatsApp Content template maps {{1}}..{{n}} to an ordered variable list,
 * and a name that does not resolve is not a broken word on screen — it is a
 * missing ContentVariable, which Twilio fills from the SAMPLE submitted at
 * approval time. The member then receives a fabricated name and invented
 * figures presented as fact. Typing the name wrong must therefore fail the
 * build (see lib/whatsapp-templates.ts).
 */
export type PlaceholderName = keyof ReturnType<typeof placeholderValues>;

export const PLACEHOLDER_DOCS: { token: string; description: string }[] = [
  { token: "{name}", description: "The member's first name" },
  { token: "{week}", description: "The relevant week — drawn week, confirmed week, or current week" },
  { token: "{weeksPaid}", description: "Weeks fully covered by their money so far" },
  { token: "{weeksTotal}", description: "Weeks they committed to" },
  { token: "{weeksLeft}", description: "Weeks still to pay" },
  { token: "{paymentsLeft}", description: "Payments still owed — committed minus paid, NOT calendar weeks remaining" },
  { token: "{weeksBehind}", description: "How many weeks behind they are" },
  { token: "{amountOwed}", description: "Amount outstanding right now" },
  { token: "{lastPaymentWeek}", description: "The week of their last recorded payment" },
  { token: "{finishWeek}", description: "The week their own window ends" },
  { token: "{finishDate}", description: "The calendar date their own window ends" },
  { token: "{startDate}", description: "The calendar date their own window begins" },
  { token: "{weeksCommitted}", description: "Their own count, in words — “10 weeks”" },
  { token: "{portalUrl}", description: "Where a member signs in (Settings → Messaging)" },
  { token: "{weeklyAmount}", description: "Their weekly contribution" },
  { token: "{totalPaid}", description: "Everything they have paid this cycle" },
  { token: "{amountReceived}", description: "The payment just recorded (confirmation only)" },
  { token: "{weeksCovered}", description: "The weeks that payment landed on (confirmation only)" },
  { token: "{lateWeeks}", description: "Weeks unpaid after their window closed" },
  { token: "{payoutAmount}", description: "The net payout (winner announcement only)" },
  { token: "{lockMinutes}", description: "How long the PIN lock lasts (lockout notice only)" },
  // ————— the member-relative tokens (v2 set) —————
  { token: "{myWeeksCovered}", description: "The weeks a receipt covered, in the member's own numbering with dates — “2–3 (Aug 23 – Aug 30)”" },
  { token: "{myCurrentWeek}", description: "Where the member is today, their own numbering with the full date — “13 (Sunday, August 9)”" },
  { token: "{myPaidUpToWeek}", description: "The last week they are fully paid through — “11 (Sunday, July 26)”, or “the start (Sunday, May 17)” before any full week" },
  { token: "{myLateWeeks}", description: "The late weeks, their own numbering with dates — “12 and 13 (Aug 2 and Aug 9)”" },
  { token: "{lateWeeksCount}", description: "How many weeks are late — always the same set {myLateWeeks} names" },
  { token: "{announcementText}", description: "The announcement's own words (group announcement only)" },
];

const KNOWN_TOKENS = new Set(PLACEHOLDER_DOCS.map((p) => p.token.slice(1, -1)));

/**
 * Fill {placeholders}. An unknown token is left literally in the text — the
 * preview shows the mistake instead of hiding it (2.10: never leave doubt).
 */
export function renderTemplate(body: string, values: Record<string, string>): string {
  return body.replace(/\{([a-zA-Z]+)\}/g, (raw, token: string) =>
    Object.hasOwn(values, token) ? values[token] : raw,
  );
}

/** Tokens in a body that no placeholder fills — for the editor's warning. */
export function unknownPlaceholders(body: string): string[] {
  const found = new Set<string>();
  for (const match of body.matchAll(/\{([a-zA-Z]+)\}/g)) {
    if (!KNOWN_TOKENS.has(match[1])) found.add(match[1]);
  }
  return [...found];
}

// ————————————————— Default templates (organizer-editable rows) —————————————————

/**
 * Seed wording for the five message types (2.11's table, in statement form).
 * These become editable MessageTemplate ROWS on first use — the organizer's
 * wording always wins; this constant is only the starting point.
 */
/**
 * THE FIVE APPROVED BODIES ARE NOT WRITTEN HERE. They are read off
 * APPROVED_TEMPLATES, which is the source of truth (lib/whatsapp-templates.ts).
 *
 * THE BUG THIS CLOSES, which had not bitten yet only because all six rows
 * happen to exist. `deliver()` falls back to DEFAULT_TEMPLATES when a
 * MessageTemplate row is absent. Twilio sends by ContentSid, so what the member
 * RECEIVES is always Meta's approved sentence — but the fallback body is what
 * gets written to MessageLog. A missing row therefore did not fail: it
 * delivered the approved text and permanently recorded different text as the
 * thing that was said. The message log is the organizer's proof of what was
 * said to whom; a log that disagrees with what was sent is worse than no log,
 * because it is trusted.
 *
 * One sentence, written once, in the file Meta's wording belongs in.
 */
/**
 * The organizer-facing LABEL for each type. Ours, not Meta's — Meta approved
 * the sentence a member reads, never what the admin screen calls it — so these
 * stay here and are safe to reword.
 */
const TEMPLATE_NAMES: Record<ApprovedTemplateKey, string> = {
  PAYMENT_CONFIRMED: "Payment confirmation",
  PAYMENT_CONFIRMED_V4: "Payment confirmation",
  PAYMENT_CONFIRMED_WITH_PARTIAL: "Payment confirmation, with a part-paid week",
  PARTIAL_CONFIRMED: "Part-payment confirmation",
  PARTIAL_COMPLETED: "Week completed confirmation",
  LATE_NOTICE_V4: "Late notice",
  BEHIND_NOTICE: "Behind notice",
  LATE_NOTICE: "Late notice",
  WINNER_ANNOUNCEMENT: "Winner announcement",
  CYCLE_CLOSING_STATEMENT: "Cycle closing statement",
  WHATSAPP_WELCOME: "Welcome message",
  GROUP_ANNOUNCEMENT: "Group announcement",
};

/**
 * What each message type is CALLED, for every screen that shows one.
 *
 * The template NAMES above cover the five Meta owns; a log row can carry any
 * key, including LOCKOUT_NOTICE, so this covers all of them and is the single
 * place a type's display name lives. Two screens naming the same message type
 * differently is how a log stops being searchable.
 */
export const LABELS_BY_KEY: Record<MessageKey, string> = {
  ...TEMPLATE_NAMES,
  LOCKOUT_NOTICE: "Lockout notice",
};

const APPROVED_DEFAULTS = Object.fromEntries(
  APPROVED_TEMPLATE_KEYS.map((key) => [
    key,
    { name: TEMPLATE_NAMES[key], body: APPROVED_TEMPLATES[key].namedBody },
  ]),
) as Record<ApprovedTemplateKey, { name: string; body: string }>;

export const DEFAULT_TEMPLATES: Record<MessageKey, { name: string; body: string }> = {
  // Seven of the eight keys are Meta-approved now (v2 set, 13 Aug 2026) —
  // welcome and group announcement included — so their bodies all read off
  // the one registry. Only LOCKOUT_NOTICE remains ours alone.
  ...APPROVED_DEFAULTS,
  // LOCKOUT_NOTICE is deliberately absent from the registry — it has no
  // approved template and must never look sendable (see the header of
  // lib/whatsapp-templates.ts). Its wording is ours, so it is written here.
  LOCKOUT_NOTICE: {
    name: "Lockout notice",
    body:
      "{name}, your Equb account is locked for {lockMinutes} minutes after too many " +
      "PIN attempts. It will unlock automatically — or contact Firaoli if you need help.",
  },
};

/**
 * Render one message type against a member's real standing. `body` is the
 * organizer's edited wording; omitted, the default applies.
 */
export function renderMessage(
  key: MessageKey,
  standing: StandingFacts,
  extras: MessageExtras = {},
  body?: string,
): string {
  return renderTemplate(body ?? DEFAULT_TEMPLATES[key].body, placeholderValues(standing, extras));
}

// ————————————————— The send gate (2.20 / 2.21, as law) —————————————————

export type SendTrigger = "AUTOMATIC" | "MANUAL" | "IMPORT";

export type SendDecision = { send: true } | { send: false; reason: string };

/**
 * May this message leave? One pure decision, tested:
 *  - IMPORT (back-filled history) never sends anything (2.21) — checked
 *    first, before every other consideration.
 *  - The hardship flag beats both triggers — a "no messages" person
 *    receives nothing, ever (2.20).
 *  - AUTOMATIC is legal only for the direct-result-of-an-action types
 *    (payment confirmation, lockout notice). Every other type is a
 *    judgement and must arrive as MANUAL (previewed, organizer pressed send).
 */
export function sendDecision(input: {
  key: MessageKey;
  trigger: SendTrigger;
  noMessages: boolean;
  hasPhone: boolean;
  /**
   * The member's derived weeks. Supplied for the chasing types so a member
   * whose whole shortfall is DEFERRED is left out of the chasing (2.2 —
   * organizer discretion, made law). Omitted, no deferral filtering happens.
   */
  weeks?: readonly { status: string }[];
}): SendDecision {
  if (input.trigger === "IMPORT") {
    return { send: false, reason: "Imported history never sends messages (2.21)." };
  }
  if (input.noMessages) {
    return { send: false, reason: "This person is marked “no messages” (hardship)." };
  }
  if (!input.hasPhone) {
    return { send: false, reason: "No phone number on file." };
  }
  if (
    input.trigger === "AUTOMATIC" &&
    !(AUTOMATIC_MESSAGE_KEYS as readonly string[]).includes(input.key)
  ) {
    return {
      send: false,
      reason:
        "Only the payment confirmation and the lockout notice send automatically — everything else needs the organizer to press send (2.20).",
    };
  }
  if (
    (CHASING_MESSAGE_KEYS as readonly string[]).includes(input.key) &&
    input.weeks !== undefined &&
    !hasChaseableWeeks(input.weeks)
  ) {
    const deferred = input.weeks.filter((w) => w.status === "DEFERRED").length;
    return {
      send: false,
      reason:
        deferred > 0
          ? `Nothing to chase — ${deferred === 1 ? "their unpaid week is" : `all ${deferred} of their unpaid weeks are`} deferred. The money is still owed and every statement says so; they are simply not chased for it.`
          : "Nothing to chase — no week has closed unpaid.",
    };
  }
  return { send: true };
}

// ————————————— Which types apply to ONE member, right now —————————————
//
// The batch composer sends one type to everyone it applies to. The case it
// cannot serve is the common one: the organizer is looking at Tsion's profile,
// sees she is six weeks behind, and wants to send HER a notice — which meant
// leaving her page, opening Messages, and unchecking twenty-six people.
//
// Offering all four manual types on her profile would be the same failure in
// reverse: a winner announcement for someone never drawn renders a payout of
// zero and a drawn week of nothing. So the offer is derived from her state,
// with the reason attached to every type that is NOT offered — a greyed
// option with no explanation is a bug report waiting to be filed.

export type ApplicableType = {
  key: MessageKey;
  /** Whether it can be sent to this member now. */
  applicable: boolean;
  /** Why not, in the organizer's words. Null when it applies. */
  reason: string | null;
  /**
   * Why it is being OFFERED — the counterpart of `reason`, and a separate
   * field for a reason worth stating.
   *
   * `reason` answers "why can I not send this", and the UI files it under
   * "Not applicable right now". A note answers "why is this one here", which
   * is a different question and belongs on the card the organizer is about to
   * press. Overloading `reason` would have put an explanation inside a
   * refusal list, where it reads as a complaint about a type that is in fact
   * ready to send.
   *
   * Null for the ordinary case: a type that applies for the obvious reason
   * does not need a sentence about it.
   */
  note: string | null;
  /** True when it is a chase, which deferral and hardship suppress. */
  chasing: boolean;
};

/** What this member's state has to say about each manual message type. */
export function applicableTypes(state: {
  name: string;
  /** Weeks whose window has CLOSED with money still owed. */
  weeksBehind: number;
  amountOutstanding: number;
  /** Their number has been drawn — a winner announcement has something to say. */
  drawnWeek: number | null;
  /**
   * The CYCLE has been closed (2.9) — its own status, never inferred from the
   * absence of a participation. Those were treated as the same fact and are
   * not: a member who stopped early has no live participation while the cycle
   * runs on without them, and reading one as the other is what made the
   * closing statement unsendable in BOTH states (see lib/messaging-subject.ts).
   *
   * It no longer gates the closing statement. It words the refusal for the
   * three types that a finished cycle has genuinely taken away.
   */
  cycleClosed: boolean;
  /**
   * What the caller resolved this member's statements to be ABOUT — "live",
   * "ended", or "none" (lib/messaging-subject.ts). It arrives with the
   * participation id it was derived beside, which is what stops the two from
   * disagreeing.
   */
  participation: "live" | "ended" | "none";
  /** 2.28: they have asked to receive nothing. */
  noMessages: boolean;
  /** No number on file — nothing can be delivered anywhere. */
  hasPhone: boolean;
  /**
   * WHEN THE WELCOME WAS LAST SENT — `Participation.agreementRequiredAt`,
   * because sending it IS what sets that column. Null means never welcomed.
   *
   * Read from the requirement rather than from the message log on purpose:
   * the log records attempts, including ones that failed at Twilio, and a
   * welcome that did not arrive has still gated the member — the requirement
   * is what actually happened to them.
   */
  welcomeSentAt: Date | null;
  /**
   * Has ANY money ever been received against this participation?
   *
   * Not a status: it only adds a sentence. A member with no payment at all is
   * a state the chasing templates render honestly but ambiguously — the
   * approved BEHIND_NOTICE says "last payment week —", and a dash is a
   * character the organizer has to interpret. This is what lets the panel say
   * it in words before he sends it.
   */
  hasEverPaid: boolean;
}): ApplicableType[] {
  const blockedForAll = !state.hasPhone
    ? `${state.name} has no phone number on file, so nothing can be delivered.`
    : state.noMessages
      ? `${state.name} is marked as receiving no messages (2.28).`
      : state.participation === "none"
        ? // A MEMBER WITH NO PARTICIPATION IS NOT A MEMBER WHOSE CYCLE ENDED.
          // The old code could not tell those apart — it had one boolean for
          // both — so it told the organizer "the cycle is still running" about
          // someone in no cycle at all, and offered a closing statement it had
          // no id to send. Every statement is a position in a cycle (2.21); with
          // no cycle there is no position, and that is its own sentence.
          `${state.name} is not in a cycle — not the running one, and not a closed one whose records are still here. A statement states where a member stands in a cycle (2.21), so there is nothing to state.`
        : null;

  // WHAT A FINISHED PARTICIPATION TAKES AWAY, and what it does not.
  //
  // The batch prepares against the ACTIVE cycle and keeps the
  // ACTIVE-participation filter for every type EXCEPT the closing statement
  // (app/actions/messages.ts). The per-member path says the same thing here
  // rather than inventing a second rule: once a participation is over, the
  // three below have nothing true left to say, and the closing statement is
  // precisely the one that does.
  const notLive =
    state.participation === "live"
      ? null
      : state.cycleClosed
        ? `${state.name}'s cycle has closed. The closing statement is the statement for a finished cycle — anything still owed is now a carried balance on ${state.name} (2.18/2.19).`
        : `${state.name} has stopped contributing to this cycle, so they are not chased for its weeks (rule 17). The closing statement still applies — the batch keeps them in that one too (2.18).`;

  const chasing = (key: MessageKey) =>
    (CHASING_MESSAGE_KEYS as readonly string[]).includes(key);

  // A MEMBER WHO HAS NEVER PAID AT ALL, said in words rather than as a dash.
  //
  // `lastPaymentWeek` renders as "—" for them, which is honest and is the one
  // placeholder allowed to be the sentinel (lib/placeholder-kinds.ts). Honest
  // is not the same as legible: the organizer reading a preview cannot tell a
  // dash that means "never paid" from a dash that means something went wrong,
  // and this is the message he is about to send to a real person.
  const neverPaidNote = state.hasEverPaid
    ? null
    : `${state.name} has no payment recorded at all — not a late one, none. The dash in ` +
      `“last payment week” is that, and the figures below are their whole position.`;

  return MANUAL_MESSAGE_KEYS.map((key): ApplicableType => {
    if (blockedForAll) {
      return { key, applicable: false, reason: blockedForAll, note: null, chasing: chasing(key) };
    }
    if (notLive && key !== "CYCLE_CLOSING_STATEMENT") {
      return { key, applicable: false, reason: notLive, note: null, chasing: chasing(key) };
    }
    switch (key) {
      case "BEHIND_NOTICE":
        return state.weeksBehind > 0
          ? { key, applicable: true, reason: null, note: neverPaidNote, chasing: true }
          : {
              key,
              applicable: false,
              // Named precisely: "not applicable" invites the organizer to
              // wonder whether the screen is wrong.
              //
              // AND IT SAYS WHICH OF THE TWO SILENCES THIS IS. "Not behind"
              // covers a member who has paid everything and a member who has
              // paid nothing whose first week has not closed yet — opposite
              // situations, and the second is the one that needs him.
              reason: state.hasEverPaid
                ? `${state.name} is not behind on any week whose window has closed.`
                : `${state.name} has paid nothing yet, and no week of theirs has closed its ` +
                  `payment window — so there is no missed week to state. This becomes ` +
                  `sendable the day their first week closes.`,
              note: null,
              chasing: true,
            };
      // ONE RULE FOR BOTH. v4 supersedes v3 and is offered on exactly the
      // same condition; giving it its own branch is how the two would drift.
      case "LATE_NOTICE":
      case "LATE_NOTICE_V4":
        return state.amountOutstanding > 0
          ? { key, applicable: true, reason: null, note: neverPaidNote, chasing: true }
          : {
              key,
              applicable: false,
              reason: `${state.name} owes nothing right now.`,
              note: null,
              chasing: true,
            };
      case "WHATSAPP_WELCOME":
        // OFFERED TO A MEMBER WHO HAS NOT BEEN WELCOMED, AND ONLY THEN.
        //
        // This type used to be unconditionally applicable, on the reasoning
        // that a second send is a deliberate second requirement against
        // current terms and therefore never wrong. That is still true of what
        // a second send DOES. It was the wrong shape for the screen: a list
        // that offers the welcome identically to all 27 members says nothing
        // about which of them has actually been let in, and the one fact the
        // organizer needs here — has this person been asked to sign — was the
        // one thing the panel would not tell him.
        //
        // So the state is shown instead of hidden (organizer ruling): not
        // welcomed is an action, welcomed is a record with a date on it.
        //
        // RE-SENDING STAYS POSSIBLE, DELIBERATELY. It is the whole re-sign
        // mechanism — change someone from 10 weeks to 12, send again, they
        // sign the new terms — and it lives in its own control: the “Send the
        // welcome again” card the profile renders directly below this list
        // (resendWelcome, whose server precondition is the mirror image of
        // this one), and the batch for re-issuing to many at once.
        //
        // The two things that genuinely stop a FIRST send — no sign-in
        // address, and the phone-digit PIN switched off — are PLATFORM
        // settings, not this member's state, so they are not decided here.
        // They live in one pure rule (lib/welcome-send.ts) that the send path
        // and every caller of this function ask separately.
        if (state.welcomeSentAt === null) {
          return {
            key,
            applicable: true,
            reason: null,
            note:
              `Not welcomed yet — sending this asks ${state.name} to read and sign their ` +
              `agreement before they can use the portal.`,
            chasing: false,
          };
        }
        return {
          key,
          applicable: false,
          reason:
            `${state.name} was welcomed on ${formatDateLongUTC(state.welcomeSentAt)}, so their ` +
            `signature is already required. To ask again — after changing their terms — use ` +
            `“Send the welcome again” below, which says what a second send does before you press it.`,
          note: null,
          chasing: false,
        };
      case "WINNER_ANNOUNCEMENT":
        return state.drawnWeek !== null
          ? { key, applicable: true, reason: null, note: null, chasing: false }
          : {
              key,
              applicable: false,
              reason: `${state.name}'s number has not been drawn yet, so there is no payout to announce.`,
              note: null,
              chasing: false,
            };
      case "CYCLE_CLOSING_STATEMENT": {
        // A CLOSING STATEMENT STATES A FINAL POSITION. It is offered exactly
        // when there IS one.
        //
        // The old rule required `cycleClosed`, which the profile derived as
        // "there is no active participation" — two mutually exclusive halves,
        // so the statement could not be sent at any moment of a cycle's life.
        //
        // The first repair removed the check ALTOGETHER, and that was worse
        // than the bug: at week 1 of a running cycle the type became
        // applicable to a contributing member, and the message reads "your
        // Equb closing statement: you paid 0 of 20 weeks, $0.00 in total" —
        // a false statement, delivered to a real member, in Meta's approved
        // wording. A gap that blocks a true message is cheaper than one that
        // sends a false one.
        //
        // TWO STATES HAVE A FINAL POSITION, and they are exactly the two the
        // batch reaches:
        //   the CYCLE has closed          → everyone's position is final;
        //   the MEMBER's participation has ended while it runs on (2.18) →
        //     theirs is final even though the cycle's is not.
        // A live member of a running cycle has neither, and is told so.
        //
        // On closing day itself the organizer uses the batch, which is what
        // app/actions/cycle-close.ts instructs and the only path that has ever
        // worked before the status flips.
        if (state.cycleClosed || state.participation === "ended") {
          return { key, applicable: true, reason: null, note: neverPaidNote, chasing: false };
        }
        return {
          key,
          applicable: false,
          reason:
            `${state.name} is still contributing to a cycle that is still running. A closing ` +
            `statement states their FINAL position, so it is sent when the cycle ends — from ` +
            `“Send to many”, which reaches everyone at once.`,
          note: null,
          chasing: false,
        };
      }
      default:
        return {
          key,
          applicable: false,
          reason: "Not sent by hand.",
          note: null,
          chasing: chasing(key),
        };
    }
  });
}
