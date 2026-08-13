// THE META-APPROVED TEMPLATE REGISTRY.
//
// Five WhatsApp Content templates were approved by Meta on 7 August 2026 under
// category UTILITY. From that moment the approved wording is CANONICAL: it is
// the only text that may leave the platform under these ContentSids, and it
// cannot be changed without re-submission and re-approval.
//
// WHY THIS FILE EXISTS AT ALL. The MessageTemplate rows in the database hold
// freeform text the organizer can edit from the app (2.20 — templates are
// configurable). That freedom is right for wording the organizer owns and
// WRONG for wording Meta owns: an edit here does not change what Meta
// approved, it only makes the database disagree with it. Twilio sends by
// ContentSid, so the approved sentence goes out regardless — and the organizer
// is left reading one thing in the app while members receive another.
//
// So the registry is the source of truth, the database mirrors it, and
// lib/whatsapp-templates.test.ts fails the build the moment the two drift.
//
// LOCKOUT_NOTICE IS DELIBERATELY ABSENT.
//
// It has no approved template and must never gain one by accident. A lockout
// notice is a SECURITY message triggered by failed PIN attempts — Meta's
// UTILITY category covers transactional account activity, and submitting a
// "your account is locked" template invites a rejection that puts the whole
// sender at risk. It is therefore UNDELIVERABLE BY DESIGN over WhatsApp.
// Twilio Verify is the right channel for it: it exists for exactly this class
// of message and needs no template approval. Until that is built, the lockout
// notice renders in the app and goes nowhere, which is the honest outcome.
//
// Adding LOCKOUT_NOTICE to this record without an approved ContentSid would
// make it look sendable. Do not.
//
// WHATSAPP_WELCOME IS DRAFTED AND ALSO ABSENT, for a different reason: it is
// written, agreed, and simply has not been SUBMITTED yet. It lives in
// DRAFT_TEMPLATES below, which has no contentSid field at all — see the comment
// there for why an entry with a blank one would be the dangerous shape.

import type { MessageExtras, PlaceholderName } from "./messages";
import { isMoneyPlaceholder, mayRenderAsNoValue, NO_VALUE } from "./placeholder-kinds";

/** The five keys Meta has approved. Deliberately NOT `MessageKey`. */
export type ApprovedTemplateKey =
  | "PAYMENT_CONFIRMED"
  | "BEHIND_NOTICE"
  | "LATE_NOTICE"
  | "WINNER_ANNOUNCEMENT"
  | "CYCLE_CLOSING_STATEMENT";

export type ApprovedTemplate = {
  key: ApprovedTemplateKey;
  /** The Meta ContentSid. What Twilio actually sends by. */
  contentSid: string;
  /**
   * The Meta-approved body, VERBATIM, with {{n}} placeholders.
   *
   * Character-for-character. PAYMENT_CONFIRMED contains an EM DASH (—,
   * U+2014), not a hyphen and not an en dash. Do not normalise punctuation,
   * do not re-wrap, do not "fix" spacing. Any change here is a change to a
   * document Meta holds, and the code cannot make it true.
   */
  approvedBody: string;
  /**
   * The ordered placeholder names behind {{1}}..{{n}}.
   *
   * Typed as `PlaceholderName`, which is read off `placeholderValues` itself
   * — so a name that function does not return is a COMPILE ERROR rather than
   * an empty ContentVariable at send time. That distinction matters more than
   * it looks: an absent variable is not a blank in the message, it is Twilio
   * substituting the SAMPLE value submitted at approval, so the member
   * receives a fabricated name and invented figures presented as fact.
   */
  variableOrder: readonly PlaceholderName[];
  /**
   * The `MessageExtras` keys a caller MUST supply for this template.
   *
   * NAMED BY THEIR EXTRAS KEY, not their placeholder name, because that is the
   * boundary where the fact still exists. By the time placeholderValues has
   * run, a missing `drawnWeek` has already become
   * `standing.currentCycleWeek` and is indistinguishable from a real
   * week — the evidence is destroyed before any placeholder-level guard can
   * see it. That is the invisible half of the message delivered on 8 Aug 2026:
   * "your Equb payout for week 12" named the CURRENT week, not the drawn one,
   * and only looked right because they happened to coincide.
   *
   * Typed against `keyof MessageExtras` for the same reason variableOrder
   * is typed against PlaceholderName: a mistyped key must be a compile error,
   * not a guard that silently never fires.
   */
  requiredExtras: readonly (keyof MessageExtras)[];
  /**
   * The same sentence with {name}-style tokens — what the database stores and
   * the organizer reads.
   *
   * DERIVED, never typed a second time. Two hand-written copies of one
   * sentence drift, and the drift is invisible until a member is reading the
   * wrong one.
   */
  namedBody: string;
};

/**
 * Turn the approved {{n}} body into the {name} form the app renders.
 *
 * Throws rather than guessing: a {{n}} with no name behind it means the
 * registry is wrong, and a registry that is wrong at module load is far
 * cheaper than one that is wrong at send time.
 */
export function toNamedBody(
  approvedBody: string,
  variableOrder: readonly PlaceholderName[],
): string {
  return approvedBody.replace(/\{\{(\d+)\}\}/g, (_raw, digits: string) => {
    const position = Number.parseInt(digits, 10);
    const name = variableOrder[position - 1];
    if (name === undefined) {
      throw new Error(
        `Template placeholder {{${position}}} has no name: variableOrder lists ` +
          `${variableOrder.length} (${variableOrder.join(", ")}).`,
      );
    }
    return `{${name}}`;
  });
}

/**
 * The inverse: turn a {name} body back into {{n}} form, for comparison against
 * what Meta approved.
 *
 * A token NOT in variableOrder is left exactly as it is, so it cannot silently
 * collapse into a positional slot — it will simply fail to match, which is the
 * correct outcome for a body that mentions a variable the template does not
 * carry.
 */
export function toApprovedBody(
  namedBody: string,
  variableOrder: readonly PlaceholderName[],
): string {
  return namedBody.replace(/\{([a-zA-Z]+)\}/g, (raw, token: string) => {
    const index = variableOrder.indexOf(token as PlaceholderName);
    return index === -1 ? raw : `{{${index + 1}}}`;
  });
}

/** One entry, with `namedBody` derived so the sentence is written once. */
function approved(
  entry: Omit<ApprovedTemplate, "namedBody">,
): ApprovedTemplate {
  return { ...entry, namedBody: toNamedBody(entry.approvedBody, entry.variableOrder) };
}

export const APPROVED_TEMPLATES: Record<ApprovedTemplateKey, ApprovedTemplate> = {
  PAYMENT_CONFIRMED: approved({
    key: "PAYMENT_CONFIRMED",
    contentSid: "HX87cb0a437434f7f9bba329958c74544a",
    // NOTE THE EM DASH after "Equb". U+2014.
    approvedBody:
      "Hi {{1}}, we received {{2}} for your Equb — recorded on week(s) {{3}}. You have paid {{4}} of {{5}} weeks. Thank you.",
    variableOrder: ["name", "amountReceived", "weeksCovered", "weeksPaid", "weeksTotal"],
    requiredExtras: ["amountReceived", "weeksCovered"],
  }),

  BEHIND_NOTICE: approved({
    key: "BEHIND_NOTICE",
    contentSid: "HX8bb8e24a790e8fafd81f232ecfe6e8dc",
    approvedBody:
      "Hi {{1}}, your Equb record as of week {{2}}: last payment week {{3}}, and {{4}} weeks behind, {{5}} outstanding. Please contact Firaoli with any questions.",
    variableOrder: ["name", "week", "lastPaymentWeek", "weeksBehind", "amountOwed"],
    requiredExtras: [],
  }),

  LATE_NOTICE: approved({
    key: "LATE_NOTICE",
    contentSid: "HXc25be8d015fc1d36a6b0caf3ebf89823",
    approvedBody:
      "Hi {{1}}, your Equb week(s) {{2}} closed without a payment recorded. Your balance is {{3}} outstanding across {{4}} weeks. Please contact Firaoli if this does not match your records.",
    variableOrder: ["name", "lateWeeks", "amountOwed", "weeksBehind"],
    requiredExtras: [],
  }),

  WINNER_ANNOUNCEMENT: approved({
    key: "WINNER_ANNOUNCEMENT",
    contentSid: "HX2774ec28d2785140d4610ba2f947f6e5",
    approvedBody:
      "Hi {{1}}, your Equb payout for week {{2}} is {{3}}. Your contributions continue to week {{4}}. Firaoli will arrange the handover.",
    variableOrder: ["name", "week", "payoutAmount", "finishWeek"],
    requiredExtras: ["drawnWeek", "payoutNet"],
  }),

  CYCLE_CLOSING_STATEMENT: approved({
    key: "CYCLE_CLOSING_STATEMENT",
    contentSid: "HX517e5e10d8f11e741789b5c6ebed9565",
    approvedBody:
      "Hi {{1}}, your Equb closing statement: you paid {{2}} of {{3}} weeks, {{4}} in total. Outstanding balance {{5}}. Please contact Firaoli to confirm.",
    variableOrder: ["name", "weeksPaid", "weeksTotal", "totalPaid", "amountOwed"],
    requiredExtras: [],
  }),
};

// ————————————————— DRAFTED, NOT SUBMITTED —————————————————
//
// WHATSAPP_WELCOME is the sixth Content template. Its wording is agreed and it
// has NOT been sent to Meta, so no ContentSid exists for it and nothing can
// carry it to a member yet.
//
// WHY IT IS NOT A SIXTH ENTRY ABOVE WITH AN EMPTY ContentSid.
//
// `APPROVED_TEMPLATES` means one thing — "Meta approved this exact wording" —
// and everything downstream reads it that way. `isApprovedTemplateKey` narrows
// to it, `deliver()` posts `APPROVED_TEMPLATES[key].contentSid` to Twilio, and
// `buildContentVariables` exists at all only because Twilio answers a MISSING
// variable by substituting the SAMPLE submitted at approval. A blank ContentSid
// would put a request on the wire with no template behind it, at the one layer
// whose failure mode is "a real member reads Sara and $7,000.00 as fact".
//
// So the draft has NO `contentSid` FIELD. Not empty — absent, so the send path
// cannot reach it even by mistake: `DraftTemplate` has nothing to read.
//
// This is the same ruling as LOCKOUT_NOTICE one step earlier. That one has no
// draft either, because it must never be submitted at all; this one has a draft
// because it is waiting in a queue.

export type DraftTemplateKey = "WHATSAPP_WELCOME";

export type DraftTemplate = {
  key: DraftTemplateKey;
  /**
   * The body AS IT WILL BE SUBMITTED, in {{n}} form.
   *
   * Written here rather than only in docs/WHATSAPP_TEMPLATES.md so the sentence
   * exists once. The doc is what a person reads before submitting; this is what
   * the app renders and logs, and two hand-typed copies of one sentence drift.
   */
  draftBody: string;
  variableOrder: readonly PlaceholderName[];
  /** Derived from draftBody, exactly as an approved entry's namedBody is. */
  namedBody: string;
};

function draft(entry: Omit<DraftTemplate, "namedBody">): DraftTemplate {
  return { ...entry, namedBody: toNamedBody(entry.draftBody, entry.variableOrder) };
}

export const DRAFT_TEMPLATES: Record<DraftTemplateKey, DraftTemplate> = {
  WHATSAPP_WELCOME: draft({
    key: "WHATSAPP_WELCOME",
    // Six variables, each separated by fixed text, opening and closing on fixed
    // text — the two shape rules in docs/WHATSAPP_TEMPLATES.md that would
    // otherwise burn the template name on a rejection.
    // "WHEN YOU SIGN IN", NOT "THE FIRST TIME YOU SIGN IN".
    //
    // The organizer may send this to a member who has been in the group for
    // months and has signed in many times — that is the intended way to bring
    // an existing member into signing. For them the agreement arrives on their
    // NEXT visit, not their first, and "the first time you sign in" describes
    // a moment that is already years behind them. The PIN sentence already
    // covers both cases the same way; this one now does too.
    draftBody:
      "Hi {{1}}, welcome to your Equb. You are saving {{2}} a week for {{3}}, from {{4}} to {{5}}. " +
      "Sign in at {{6}} with your phone number. If you have set your own PIN use it, otherwise your " +
      "PIN is the last 4 digits of your phone number. When you sign in you will be asked to read " +
      "and sign your agreement.",
    variableOrder: ["name", "weeklyAmount", "weeksCommitted", "startDate", "finishDate", "portalUrl"],
  }),
};

export const DRAFT_TEMPLATE_KEYS = Object.keys(DRAFT_TEMPLATES) as DraftTemplateKey[];

/** Is this key drafted-but-unsubmitted? The counterpart of isApprovedTemplateKey. */
export function isDraftTemplateKey(key: string): key is DraftTemplateKey {
  return Object.hasOwn(DRAFT_TEMPLATES, key);
}

/**
 * Why a drafted template did not leave — for the organizer, who pressed send.
 *
 * "No Meta-approved WhatsApp template" is the true sentence for LOCKOUT_NOTICE
 * and a misleading one here: it reads as a permanent property of the message,
 * when in fact this template is finished and queued behind a submission. The
 * organizer's next action differs completely between those two states, so the
 * two states get different sentences.
 */
export function draftNotSubmittedRefusal(key: DraftTemplateKey): string {
  return (
    `${key} is written but has not been submitted to Meta, so no approved template exists to ` +
    `carry it and nothing was sent. WhatsApp delivers this kind of message only as an approved ` +
    `template — see docs/WHATSAPP_TEMPLATES.md for the exact wording to submit. ` +
    `Until it is approved, sending it also requires nobody's signature: the agreement is owed by ` +
    `a member who was TOLD, and this member was not told.`
  );
}

export type RequiredExtrasResult =
  | { ok: true }
  | { ok: false; missing: (keyof MessageExtras)[]; error: string };

/**
 * Does this caller carry the facts this template cannot derive?
 *
 * CHECKED AT THE EXTRAS BOUNDARY, BEFORE RENDERING. That placement is the
 * whole point. `placeholderValues` resolves {week} as
 * `drawnWeek ?? lastCovered ?? standing.currentCycleWeek` — so a caller that
 * omits `drawnWeek` does not produce a blank to be caught later, it produces a
 * PLAUSIBLE WRONG NUMBER. Once that has happened there is nothing left to
 * detect: "12" is a valid string and every downstream guard passes it.
 *
 * `null` counts as absent as well as `undefined`. A caller that looked the
 * fact up, found nothing, and passed the miss along is in exactly the position
 * this refuses — it has no value to state and must not state one anyway.
 */
export function checkRequiredExtras(
  key: ApprovedTemplateKey,
  extras: MessageExtras | undefined,
): RequiredExtrasResult {
  const required = APPROVED_TEMPLATES[key].requiredExtras;
  if (required.length === 0) return { ok: true };

  const supplied = extras ?? {};
  const missing = required.filter((name) => {
    const value = supplied[name];
    return value === undefined || value === null;
  });
  if (missing.length === 0) return { ok: true };

  return {
    ok: false,
    missing,
    error:
      `Cannot send ${key}: the caller did not supply ` +
      `${missing.map((m) => `extras.${m}`).join(" or ")}. ` +
      `${key} states ${FACT_DESCRIPTIONS[key]}, and ${missing.length === 1 ? "that fact is" : "those facts are"} ` +
      `not derivable from the member's standing — ${missing.length === 1 ? "it" : "they"} must come from the draw. ` +
      `WITHOUT ${missing.length === 1 ? "it" : "them"} the message does not fail: ` +
      `{week} silently falls back to the member's CURRENT cycle week and {payoutAmount} renders as "${NO_VALUE}", ` +
      `so a real member is told a confident, wrong figure. ` +
      `Fix the CALLER: derive the extras with winnerExtrasForParticipation (lib/winner-extras.ts), ` +
      `which is what app/actions/messages.ts and app/actions/member-messaging.ts both use. Nothing was sent.`,
  };
}

/** What each template asserts, for a refusal that explains itself. */
const FACT_DESCRIPTIONS: Record<ApprovedTemplateKey, string> = {
  PAYMENT_CONFIRMED: "which weeks a receipt landed on and how much arrived",
  WINNER_ANNOUNCEMENT: "the week a number was drawn and what that payout is worth",
  BEHIND_NOTICE: "a member's arrears",
  LATE_NOTICE: "which weeks closed unpaid",
  CYCLE_CLOSING_STATEMENT: "a member's final position",
};

/** The five keys, for scripts and tests that iterate them. */
export const APPROVED_TEMPLATE_KEYS = Object.keys(
  APPROVED_TEMPLATES,
) as ApprovedTemplateKey[];

/**
 * The message a drift failure must show.
 *
 * "Expected X to equal Y" tells the reader the strings differ and nothing they
 * can act on. What they need to know is that the wording is Meta's, that
 * changing it does not change what Meta holds, and that re-approval is the
 * only route — otherwise the natural next step is to "fix" the guard.
 */
export function driftMessage(key: string, where: string): string {
  return (
    `${where} for ${key} no longer matches the wording Meta approved on 7 August 2026. ` +
    `It needs RE-SUBMISSION and RE-APPROVAL before it can send.\n` +
    `WhatsApp sends this template by ContentSid, so editing the text here does NOT change ` +
    `what members receive — it only makes the app disagree with what is actually sent.\n` +
    `To change the wording: submit the new text to Meta, wait for approval, then update ` +
    `contentSid and approvedBody in lib/whatsapp-templates.ts together.\n` +
    `To restore it: run scripts/sync-approved-templates.mts, which rewrites the database ` +
    `row from the registry.`
  );
}

/**
 * Why the organizer cannot edit this wording — in HIS words, not a test's.
 *
 * `driftMessage` above is for whoever reads a failing build: it names files
 * and a sync script. This is for the person holding the editor, and it has to
 * answer the only two questions he actually has — why the box will not save,
 * and what he would have to do to change the sentence.
 *
 * IT IS NOT A WARNING. The editor used to accept any wording for these five
 * keys and save it, and the app then showed one sentence while members
 * received another — the previews, the message log and the compose screen all
 * quoting text Twilio never sent. 2.20 exists so "the system never speaks to a
 * member without the organizer knowing exactly what it said", and a saved edit
 * that changes nothing is the exact opposite of that. So it is refused.
 */
export function approvedWordingRefusal(key: ApprovedTemplateKey): string {
  return (
    `This wording belongs to Meta, not to the app. WhatsApp sends ${key} by its approved ` +
    `template, so changing the text here would not change one word of what members receive — ` +
    `it would only make this screen disagree with what was actually sent. ` +
    `To change it, the new wording has to be submitted to Meta and approved first.`
  );
}

/**
 * The line the editor shows ON a locked template, before he tries to edit it.
 *
 * Shorter than the refusal because it is read every time, not once.
 */
export const APPROVED_WORDING_NOTE =
  "Meta owns this wording. It is what members receive, word for word, and it can only be " +
  "changed by submitting new wording to Meta for approval.";

/**
 * The ContentVariables Twilio needs, keyed "1", "2", … in variableOrder order.
 *
 * WHY THIS REFUSES INSTEAD OF FILLING GAPS. Twilio does not fail on a missing
 * variable — it substitutes the SAMPLE VALUE submitted at approval. Ours are
 * "Sara", "$7,000.00", "11–12". So an incomplete set does not produce a blank
 * or an error: it delivers a fabricated name and invented arrears to a real
 * member, formatted exactly like fact, and the member has no way to tell.
 *
 * That is the single worst thing this platform could do, and a partial object
 * is the only way to reach it. So there is no partial object: either every
 * name in variableOrder resolved, or nothing sends.
 *
 * `"—"` IS A VALUE, NOT A GAP. placeholderValues returns it for data that
 * genuinely does not apply — lastPaymentWeek for a member who has never paid
 * is legitimately "—", and "no payment recorded yet" is exactly what the
 * member should read. Only absent and empty-string count as missing.
 */
export type ContentVariablesResult =
  | { ok: true; variables: Record<string, string> }
  | { ok: false; error: string; missing: string[] };

export function buildContentVariables(
  key: ApprovedTemplateKey,
  values: Readonly<Record<string, string>>,
): ContentVariablesResult {
  const template = APPROVED_TEMPLATES[key];
  const variables: Record<string, string> = {};
  const missing: string[] = [];

  // A MONEY PLACEHOLDER MAY NEVER BE THE DASH.
  //
  // THE BUG THIS CLOSES, from a message a real member received:
  //
  //   "Hi Firaoli, your Equb payout for week 12 is —."
  //
  // {payoutAmount} is fed from `extras.payoutNet`, and a caller that omitted
  // the extras got the NO_VALUE sentinel instead of a figure. Every check
  // above passed it: "—" is not undefined, not null, and not empty. So the
  // send succeeded, the log recorded it as SENT, and the member was told they
  // had won without being told how much.
  //
  // That failure is worse than a refusal precisely because it LOOKS FINE.
  // Nothing alerts, nothing retries, and the only way to discover it is for
  // someone to read the delivered message.
  //
  // "—" stays legitimate in ONE place: {lastPaymentWeek} for a member who has
  // never paid is honestly a dash and reads correctly. Everywhere else it is a
  // hole — see DASHABLE_PLACEHOLDERS for the two further templates guarding
  // money alone had left open.
  // Placeholders that came back as the sentinel where a fact belongs.
  const dashed: string[] = [];

  template.variableOrder.forEach((name, index) => {
    const value = values[name];
    if (value === undefined || value === null || value === "") {
      missing.push(name);
      return;
    }
    // Default-deny: only lastPaymentWeek may honestly be a dash. Guarding
    // MONEY alone left weeksCovered and lateWeeks open, and the sentinel is a
    // missing-fact problem rather than a money one — money was just where it
    // was noticed. See DASHABLE_PLACEHOLDERS.
    if (value === NO_VALUE && !mayRenderAsNoValue(name)) {
      dashed.push(name);
      return;
    }
    // Position, not name: Twilio keys ContentVariables by the {{n}} slot.
    variables[String(index + 1)] = value;
  });

  if (missing.length > 0 || dashed.length > 0) {
    const names = [...missing, ...dashed];
    // Money is called out separately because it is the more alarming shape of
    // the same fault — a member told a figure exists without being told what
    // it is — and because that is the one that actually reached someone.
    const dashedMoney = dashed.filter(isMoneyPlaceholder);
    const dashedOther = dashed.filter((n) => !isMoneyPlaceholder(n));
    return {
      ok: false,
      missing: names,
      error:
        `Cannot send ${key}: ` +
        (missing.length > 0
          ? `${missing.length === 1 ? "variable" : "variables"} ${missing.join(", ")} had no value. `
          : "") +
        (dashedMoney.length > 0
          ? `${dashedMoney.join(", ")} is a money figure and rendered as "${NO_VALUE}" — the ` +
            `amount was never supplied, so the message would tell the member a figure exists ` +
            `without saying what it is. `
          : "") +
        (dashedOther.length > 0
          ? `${dashedOther.join(", ")} rendered as "${NO_VALUE}", which leaves a hole where a ` +
            `fact belongs in a sentence that otherwise reads normally. `
          : "") +
        `Twilio substitutes the approval SAMPLE for a missing variable, so sending would ` +
        `deliver invented figures to a real member. Nothing was sent.`,
    };
  }
  return { ok: true, variables };
}

/**
 * Does this message key have a Meta-approved template?
 *
 * A type guard, so the compiler narrows `MessageKey` to
 * `ApprovedTemplateKey` and a caller cannot reach APPROVED_TEMPLATES with a
 * key that is not in it. LOCKOUT_NOTICE is the one that returns false, and it
 * must keep returning false — see the header.
 */
export function isApprovedTemplateKey(key: string): key is ApprovedTemplateKey {
  return Object.hasOwn(APPROVED_TEMPLATES, key);
}
