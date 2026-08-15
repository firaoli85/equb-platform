// THE META-APPROVED TEMPLATE REGISTRY.
//
// Seven WhatsApp Content templates, all category UTILITY: five approved by
// Meta on 7 August 2026, of which four were superseded on 13 August 2026 by
// the member-relative v2 set — which also brought the welcome and the group
// announcement in. Approved wording is CANONICAL from the moment it lands: it
// is the only text that may leave the platform under these ContentSids, and
// it cannot be changed without re-submission and re-approval.
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
// WHATSAPP_WELCOME WAS THE DRAFT THAT GRADUATED (13 Aug 2026): it sat in
// DRAFT_TEMPLATES — deliberately without a contentSid field — until Meta
// approved it, and now holds a real entry below. DRAFT_TEMPLATES itself is
// empty but its machinery stays: the next unsubmitted template belongs there,
// not here with a blank SID, which would be the dangerous shape.

import type { MessageExtras, PlaceholderName } from "./messages";
import { isMoneyPlaceholder, mayRenderAsNoValue, NO_VALUE } from "./placeholder-kinds";

/** The seven keys Meta has approved. Deliberately NOT `MessageKey`. */
export type ApprovedTemplateKey =
  | "PAYMENT_CONFIRMED"
  // ————— THE PHASE 4 PAYMENT SET (approved by Meta, 15 Aug 2026) —————
  //
  // WHICH of these documents a payment is decided by `paymentMessageFor()` in
  // lib/engine.ts, from what the payment actually did — never by a caller
  // choosing a name. The two v4s supersede PAYMENT_CONFIRMED and LATE_NOTICE
  // and are NOT deleted: the practice is one observed DELIVERED send on the
  // replacement before its predecessor is retired.
  | "PAYMENT_CONFIRMED_V4"
  | "PAYMENT_CONFIRMED_WITH_PARTIAL"
  | "PARTIAL_CONFIRMED"
  | "PARTIAL_COMPLETED"
  | "LATE_NOTICE_V4"
  | "BEHIND_NOTICE"
  | "LATE_NOTICE"
  | "WINNER_ANNOUNCEMENT"
  | "CYCLE_CLOSING_STATEMENT"
  | "WHATSAPP_WELCOME"
  | "GROUP_ANNOUNCEMENT";

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

// THE LIVE SET (all UTILITY): payment confirmation, welcome and group
// announcement from the 13 Aug 2026 v2 approval; behind, late and winner
// from the 14 Aug 2026 v3 rework; the closing statement unchanged since
// 7 Aug 2026. Superseded bodies live in docs/WHATSAPP_TEMPLATES.md's history
// section — the v1 AND v2 predecessors are already deleted from Twilio.
//
// v3 STANDING RULES (organizer, 14 Aug 2026), for ALL member-facing text:
//   - NO DASHES, em or en, in fixed template text (guarded in
//     lib/whatsapp-templates.test.ts; the two pre-v3 bodies that carry one
//     are Meta-frozen exemptions until resubmitted)
//   - maximally simple — "stupid-proof" — sentences
//   - weeks are the MEMBER'S counting language, dates in brackets as
//     reference; repetition of facts is good, not clutter
export const APPROVED_TEMPLATES: Record<ApprovedTemplateKey, ApprovedTemplate> = {
  PAYMENT_CONFIRMED: approved({
    key: "PAYMENT_CONFIRMED",
    contentSid: "HXf357ad3b5f22055d701a9e8f2b3816cc",
    // NOTE THE EM DASH after "Equb" (U+2014); the {{3}} phrase itself carries
    // EN dashes ("2–3 (Aug 23 – Aug 30)") from the composer.
    approvedBody:
      "Hi {{1}}, we received {{2}} for your Equb — recorded on your week(s) {{3}}. You have now paid {{4}} of your {{5}} weeks. Thank you.",
    variableOrder: ["name", "amountReceived", "myWeeksCovered", "weeksPaid", "weeksTotal"],
    requiredExtras: ["amountReceived", "weeksCovered"],
  }),

  // ————— THE PHASE 4 PAYMENT SET (approved 15 Aug 2026) —————
  //
  // Bodies and the rulings behind them: docs/ONE_TRUTH_ENGINE.md §3.7 and
  // docs/WHATSAPP_TEMPLATES.md. NO RECEIPT DATES anywhere — every reference is
  // the member's own week number plus that week's SCHEDULED date, both stable
  // cycle facts, because a message states what stays true.
  //
  // NOTHING CALLS THESE YET. The router that picks between them
  // (paymentMessageFor, lib/engine.ts) is not wired to the payment site until
  // 4b-ii, so landing them here changes no message any member receives.

  PAYMENT_CONFIRMED_V4: approved({
    key: "PAYMENT_CONFIRMED_V4",
    contentSid: "HX04d881604b2900ca7a3756e7ef8b4369",
    approvedBody:
      "Hi {{1}}, we received {{2}} for your Equb. That paid {{3}}. You have now paid {{4}} of your {{5}} weeks. Thank you.",
    variableOrder: ["name", "amountReceived", "paymentBreakdown", "weeksPaid", "weeksTotal"],
    requiredExtras: ["amountReceived", "paymentBreakdown"],
  }),

  PAYMENT_CONFIRMED_WITH_PARTIAL: approved({
    key: "PAYMENT_CONFIRMED_WITH_PARTIAL",
    contentSid: "HX42c594237ebb137ffe74f441dfce9ae7",
    approvedBody:
      "Hi {{1}}, we received {{2}} for your Equb. That paid {{3}}. {{4}}. You have now paid {{5}} of your {{6}} weeks. Thank you.",
    variableOrder: [
      "name",
      "amountReceived",
      "paymentBreakdown",
      "stillDueOnWeek",
      "weeksPaid",
      "weeksTotal",
    ],
    requiredExtras: ["amountReceived", "paymentBreakdown", "stillDueOnWeek"],
  }),

  PARTIAL_CONFIRMED: approved({
    key: "PARTIAL_CONFIRMED",
    contentSid: "HX594e2d89ff6ef2d43cf4e5fd23ddd44a",
    approvedBody:
      "Hi {{1}}, we received {{2}} for your Equb. That paid part of your {{3}}. {{4}}. You have now paid {{5}} of your {{6}} weeks. Thank you.",
    variableOrder: [
      "name",
      "amountReceived",
      "partialWeekLabel",
      "stillDueOnWeek",
      "weeksPaid",
      "weeksTotal",
    ],
    requiredExtras: ["amountReceived", "partialWeekLabel", "stillDueOnWeek"],
  }),

  PARTIAL_COMPLETED: approved({
    key: "PARTIAL_COMPLETED",
    contentSid: "HX1efe217e6afed58c5a2f3671351eaf7f",
    // {{3}} is the EXACT prior amount: amountDue minus what THIS payment
    // applied to that week — never the receipt sum, which reads a table
    // rebuild.ts deletes and re-creates on every edit.
    approvedBody:
      "Hi {{1}}, we received {{2}} for your Equb. You had already paid {{3}} toward your {{4}}, and it is now paid in full. You have now paid {{5}} of your {{6}} weeks. Thank you.",
    variableOrder: [
      "name",
      "amountReceived",
      "priorPaidOnWeek",
      "partialWeekLabel",
      "weeksPaid",
      "weeksTotal",
    ],
    requiredExtras: ["amountReceived", "priorPaidOnWeek", "partialWeekLabel"],
  }),

  LATE_NOTICE_V4: approved({
    key: "LATE_NOTICE_V4",
    contentSid: "HX946bc247a7e1b1bbf697e376bc9b0b63",
    // THE TRUST-LAW FIX. late_notice_v3 says "we did not receive your payment",
    // FALSE for anyone who part paid, and quoted the member's TOTAL where the
    // sentence named one week. Both are gone.
    approvedBody:
      "Hi {{1}}, this is a reminder about your Equb. {{2}}. You are paid up to your {{3}}, and the current week is {{4}}. Please contact Firaoli if this does not match your records.",
    variableOrder: ["name", "stillDueOnWeek", "myPaidUpToWeek", "myCurrentWeek"],
    requiredExtras: ["stillDueOnWeek"],
  }),

  BEHIND_NOTICE: approved({
    key: "BEHIND_NOTICE",
    // v3 (14 Aug 2026). {{4}} is the paid-up-to week — ALWAYS composable: a
    // member who has never paid gets "the start (Sunday, May 17)", their own
    // start date, which SUPERSEDES the v2 "—" sentinel for last-payment.
    // Non-dashable on purpose.
    contentSid: "HXf6fd58391615502d88ea81a812460bc7",
    approvedBody:
      "Hi {{1}}, you are {{2}} payments behind on your Equb. That is {{3}} to catch up. You are paid up to your week {{4}}, and the current week is week {{5}}. Please contact Firaoli with any questions.",
    variableOrder: ["name", "weeksBehind", "amountOwed", "myPaidUpToWeek", "myCurrentWeek"],
    requiredExtras: [],
  }),

  LATE_NOTICE: approved({
    key: "LATE_NOTICE",
    // v3 (14 Aug 2026). {{2}} stays non-dashable: no late weeks, no send.
    contentSid: "HX5888a36a63291feccee719a37dcaff64",
    approvedBody:
      "Hi {{1}}, we did not receive your payment for your week(s) {{2}}. That is {{3}} to catch up. You are paid up to your week {{4}}, and the current week is week {{5}}. Please contact Firaoli if this does not match your records.",
    variableOrder: ["name", "myLateWeeks", "amountOwed", "myPaidUpToWeek", "myCurrentWeek"],
    requiredExtras: [],
  }),

  WINNER_ANNOUNCEMENT: approved({
    key: "WINNER_ANNOUNCEMENT",
    // v3 (14 Aug 2026). {{5}} is PAYMENTS LEFT — committed minus paid, the
    // count still owed — NOT calendar weeks remaining: the two differ the
    // moment a member is behind or ahead (the 13-Aug finding), and this
    // sentence states the debt count with {{6}}, their finish date, as the
    // run-until anchor. D-38's resolution stands: the finish DATE is carried.
    // `payoutNet` remains required (caller-supplied, defect-producing);
    // everything else derives.
    contentSid: "HX4775224d54e9799a67c9b9ad5ccf6f63",
    approvedBody:
      "Hi {{1}}, congratulations! Your Equb payout is {{2}}. So far you have paid {{3}} of your {{4}} weeks. You have {{5}} payments left, and your weeks run until {{6}}. Firaoli will arrange the handover.",
    variableOrder: ["name", "payoutAmount", "weeksPaid", "weeksTotal", "paymentsLeft", "finishDate"],
    requiredExtras: ["payoutNet"],
  }),

  WHATSAPP_WELCOME: approved({
    key: "WHATSAPP_WELCOME",
    // ARMED (13 Aug 2026). The draft-and-refuse era is over: this entry is
    // what makes deliver() send it, and a successful send is what writes
    // `agreementRequiredAt` and gates the member's portal — the mechanism the
    // agreement build left waiting on exactly this SID. The two hard blocks
    // (no portal address; the PIN sentence being false) stay in
    // lib/welcome-send.ts and refuse BEFORE the network, as ever.
    contentSid: "HX90da7257223b48177b95dbbb132ea182",
    approvedBody:
      "Hi {{1}}, welcome to the Equb. Your commitment is {{2}} every week for {{3}}, starting {{4}} and finishing {{5}}. Your first step is to sign in and sign your agreement at {{6}} — your account opens once you have.",
    variableOrder: ["name", "weeklyAmount", "weeksCommitted", "startDate", "finishDate", "portalUrl"],
    requiredExtras: [],
  }),

  GROUP_ANNOUNCEMENT: approved({
    key: "GROUP_ANNOUNCEMENT",
    // A BROADCAST SENT PER MEMBER, individually — each recipient reads their
    // own name; there is no group-chat send on WhatsApp. The text is the
    // organizer's free composition at send time, so it is a REQUIRED extra:
    // an omitted text would deliver Twilio's approval sample as fact.
    contentSid: "HX4981b5b4c3e692a489dc084d52d375ce",
    approvedBody: "Hi {{1}}, a message from your Equb: {{2}}",
    variableOrder: ["name", "announcementText"],
    requiredExtras: ["announcementText"],
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

// ————————————————— THE DRAFT QUEUE (empty since 13 Aug 2026) —————————————————
//
// A template that is WRITTEN but not yet Meta-approved waits here, never in
// APPROVED_TEMPLATES. WHATSAPP_WELCOME lived in this queue until 13 Aug 2026,
// when Meta approved it and it moved into APPROVED_TEMPLATES above.
//
// WHY A DRAFT IS NEVER AN ENTRY ABOVE WITH AN EMPTY ContentSid.
//
// `APPROVED_TEMPLATES` means one thing — "Meta approved this exact wording" —
// and everything downstream reads it that way. `isApprovedTemplateKey` narrows
// to it, `deliver()` posts `APPROVED_TEMPLATES[key].contentSid` to Twilio, and
// `buildContentVariables` exists at all only because Twilio answers a MISSING
// variable by substituting the SAMPLE submitted at approval. A blank ContentSid
// would put a request on the wire with no template behind it, at the one layer
// whose failure mode is "a real member reads Sara and $7,000.00 as fact".
//
// So a draft has NO `contentSid` FIELD. Not empty — absent, so the send path
// cannot reach it even by mistake: `DraftTemplate` has nothing to read.
//
// This is the same ruling as LOCKOUT_NOTICE one step earlier. That one has no
// draft either, because it must never be submitted at all; a draft sits here
// only while it waits in the submission queue.

export type DraftTemplateKey = never;

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

// THE QUEUE IS EMPTY (13 Aug 2026): the welcome was submitted, approved, and
// moved into APPROVED_TEMPLATES above — the submitted wording was the
// commitment-first form, NOT the PIN-instructions draft that waited here;
// that draft is recorded in docs/WHATSAPP_TEMPLATES.md's history section as
// superseded-before-submission. The machinery stays for the next template
// that waits on Meta.
export const DRAFT_TEMPLATES: Record<DraftTemplateKey, DraftTemplate> = {};

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
  PAYMENT_CONFIRMED_V4: "which weeks a receipt paid, itemised, and how much arrived",
  PAYMENT_CONFIRMED_WITH_PARTIAL:
    "which weeks a receipt paid and what is still due on the one it part paid",
  PARTIAL_CONFIRMED: "how much of a week a receipt paid and what is still due on it",
  PARTIAL_COMPLETED: "what a member had already paid toward a week the receipt completed",
  LATE_NOTICE_V4: "what is still due on a specific week",
  WINNER_ANNOUNCEMENT: "what a payout is worth",
  BEHIND_NOTICE: "a member's arrears",
  LATE_NOTICE: "which weeks closed unpaid",
  CYCLE_CLOSING_STATEMENT: "a member's final position",
  WHATSAPP_WELCOME: "a member's commitment and where they sign in",
  GROUP_ANNOUNCEMENT: "whatever the organizer composed at send time",
};

/** The seven keys, for scripts and tests that iterate them. */
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
    `${where} for ${key} no longer matches the wording Meta approved (7 Aug 2026 set, reworked 13 Aug 2026). ` +
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
