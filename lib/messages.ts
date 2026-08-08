// State-aware statements (2.21): a message carries the member's TRUE derived
// position — never a bare label. Pure and unit-tested: template body plus
// standing facts in, rendered text out. The action layer supplies FRESH
// standing at send time, so nothing rendered here can ever be stale.
//
// The send DECISIONS (2.20) are pure too: the automatic-vs-manual gate, the
// hardship flag, and the imported-history rule are tested law in this file,
// not UI behavior.

import { formatDateLongUTC, formatMoney } from "./format";
// The sentinel and the money classification live in a leaf module so the
// registry can import them as values without closing an import cycle.
import { NO_VALUE } from "./placeholder-kinds";
// The registry imports only a TYPE from this file (PlaceholderName), which is
// erased at build, so this is not a runtime cycle.
import {
  APPROVED_TEMPLATE_KEYS,
  APPROVED_TEMPLATES,
  type ApprovedTemplateKey,
} from "./whatsapp-templates";

export const MESSAGE_KEYS = [
  "PAYMENT_CONFIRMED",
  "BEHIND_NOTICE",
  "LATE_NOTICE",
  "WINNER_ANNOUNCEMENT",
  "CYCLE_CLOSING_STATEMENT",
  "LOCKOUT_NOTICE",
] as const;

/**
 * The types that send themselves as the direct result of an action that
 * just happened (2.20): the mark-paid confirmation, and the lockout notice
 * a member triggers with their own failed attempts. Everything else is a
 * judgement and must be MANUAL.
 */
export const AUTOMATIC_MESSAGE_KEYS = ["PAYMENT_CONFIRMED", "LOCKOUT_NOTICE"] as const;

/**
 * The types that CHASE a member for money they have not paid. These are the
 * only ones deferral suppresses (organizer ruling, Aug 2026): a deferred week
 * is still owed, but the member is not chased for it. Statements — the
 * confirmation, the winner announcement, the closing statement — are NOT
 * chasing, so they always state the true amount owed, deferral included.
 */
export const CHASING_MESSAGE_KEYS = ["BEHIND_NOTICE", "LATE_NOTICE"] as const;

export type MessageKey = (typeof MESSAGE_KEYS)[number];

export { NO_VALUE, MONEY_PLACEHOLDERS, isMoneyPlaceholder } from "./placeholder-kinds";

export function isMessageKey(value: string): value is MessageKey {
  return (MESSAGE_KEYS as readonly string[]).includes(value);
}

/**
 * The types the organizer sends by hand as a batch (2.20). The automatic
 * ones are absent on purpose: they fire from their own events, never a
 * batch button.
 */
export const MANUAL_MESSAGE_KEYS = MESSAGE_KEYS.filter(
  (k): k is MessageKey => !(AUTOMATIC_MESSAGE_KEYS as readonly string[]).includes(k),
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
  weeksCredited: number;
  weeksBehind: number;
  amountOutstanding: number;
  totalPaid: number;
  lastPaymentWeek: number | null;
  /** Per-week derived statuses; lets {lateWeeks} name the closed weeks. */
  weeks?: readonly { weekNumber: number; status: string }[];
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
  return (weeks ?? []).some((w) => w.status === "LATE");
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
  const lateWeeks = (standing.weeks ?? [])
    .filter((w) => w.status === "LATE")
    .map((w) => w.weekNumber);
  return {
    name: standing.name,
    week: String(extras.drawnWeek ?? lastCovered ?? standing.currentCycleWeek),
    weeksPaid: String(weeksPaid),
    weeksTotal: String(standing.weeksCommitted),
    weeksLeft: String(weeksLeft),
    weeksBehind: String(standing.weeksBehind),
    amountOwed: formatMoney(standing.amountOutstanding),
    lastPaymentWeek: standing.lastPaymentWeek === null ? NO_VALUE : String(standing.lastPaymentWeek),
    finishWeek: String(standing.finishWeek),
    finishDate: standing.finishDate ? formatDateLongUTC(standing.finishDate) : String(standing.finishWeek),
    weeklyAmount: formatMoney(standing.weeklyAmount),
    totalPaid: formatMoney(standing.totalPaid),
    amountReceived:
      extras.amountReceived === undefined ? NO_VALUE : formatMoney(extras.amountReceived),
    weeksCovered: extras.weeksCovered?.length ? formatWeekList(extras.weeksCovered) : NO_VALUE,
    lateWeeks: formatWeekList(lateWeeks),
    payoutAmount: extras.payoutNet === undefined ? NO_VALUE : formatMoney(extras.payoutNet),
    lockMinutes: extras.lockMinutes === undefined ? NO_VALUE : String(extras.lockMinutes),
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
  { token: "{weeksBehind}", description: "How many weeks behind they are" },
  { token: "{amountOwed}", description: "Amount outstanding right now" },
  { token: "{lastPaymentWeek}", description: "The week of their last recorded payment" },
  { token: "{finishWeek}", description: "The week their own window ends" },
  { token: "{finishDate}", description: "The calendar date their own window ends" },
  { token: "{weeklyAmount}", description: "Their weekly contribution" },
  { token: "{totalPaid}", description: "Everything they have paid this cycle" },
  { token: "{amountReceived}", description: "The payment just recorded (confirmation only)" },
  { token: "{weeksCovered}", description: "The weeks that payment landed on (confirmation only)" },
  { token: "{lateWeeks}", description: "Weeks unpaid after their window closed" },
  { token: "{payoutAmount}", description: "The net payout (winner announcement only)" },
  { token: "{lockMinutes}", description: "How long the PIN lock lasts (lockout notice only)" },
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
  BEHIND_NOTICE: "Behind notice",
  LATE_NOTICE: "Late notice",
  WINNER_ANNOUNCEMENT: "Winner announcement",
  CYCLE_CLOSING_STATEMENT: "Cycle closing statement",
};

const APPROVED_DEFAULTS = Object.fromEntries(
  APPROVED_TEMPLATE_KEYS.map((key) => [
    key,
    { name: TEMPLATE_NAMES[key], body: APPROVED_TEMPLATES[key].namedBody },
  ]),
) as Record<ApprovedTemplateKey, { name: string; body: string }>;

export const DEFAULT_TEMPLATES: Record<MessageKey, { name: string; body: string }> = {
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
  /** The cycle has been closed, so a closing statement is real. */
  cycleClosed: boolean;
  /** 2.28: they have asked to receive nothing. */
  noMessages: boolean;
  /** No number on file — nothing can be delivered anywhere. */
  hasPhone: boolean;
}): ApplicableType[] {
  const blockedForAll = !state.hasPhone
    ? `${state.name} has no phone number on file, so nothing can be delivered.`
    : state.noMessages
      ? `${state.name} is marked as receiving no messages (2.28).`
      : null;

  const chasing = (key: MessageKey) =>
    (CHASING_MESSAGE_KEYS as readonly string[]).includes(key);

  return MANUAL_MESSAGE_KEYS.map((key): ApplicableType => {
    if (blockedForAll) {
      return { key, applicable: false, reason: blockedForAll, chasing: chasing(key) };
    }
    switch (key) {
      case "BEHIND_NOTICE":
        return state.weeksBehind > 0
          ? { key, applicable: true, reason: null, chasing: true }
          : {
              key,
              applicable: false,
              // Named precisely: "not applicable" invites the organizer to
              // wonder whether the screen is wrong.
              reason: `${state.name} is not behind on any week whose window has closed.`,
              chasing: true,
            };
      case "LATE_NOTICE":
        return state.amountOutstanding > 0
          ? { key, applicable: true, reason: null, chasing: true }
          : {
              key,
              applicable: false,
              reason: `${state.name} owes nothing right now.`,
              chasing: true,
            };
      case "WINNER_ANNOUNCEMENT":
        return state.drawnWeek !== null
          ? { key, applicable: true, reason: null, chasing: false }
          : {
              key,
              applicable: false,
              reason: `${state.name}'s number has not been drawn yet, so there is no payout to announce.`,
              chasing: false,
            };
      case "CYCLE_CLOSING_STATEMENT":
        return state.cycleClosed
          ? { key, applicable: true, reason: null, chasing: false }
          : {
              key,
              applicable: false,
              reason: "The cycle is still running — the closing statement is sent when it ends.",
              chasing: false,
            };
      default:
        return { key, applicable: false, reason: "Not sent by hand.", chasing: chasing(key) };
    }
  });
}
