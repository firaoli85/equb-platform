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

import type { PlaceholderName } from "./messages";

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
  }),

  BEHIND_NOTICE: approved({
    key: "BEHIND_NOTICE",
    contentSid: "HX8bb8e24a790e8fafd81f232ecfe6e8dc",
    approvedBody:
      "Hi {{1}}, your Equb record as of week {{2}}: last payment week {{3}}, and {{4}} weeks behind, {{5}} outstanding. Please contact Firaoli with any questions.",
    variableOrder: ["name", "week", "lastPaymentWeek", "weeksBehind", "amountOwed"],
  }),

  LATE_NOTICE: approved({
    key: "LATE_NOTICE",
    contentSid: "HXc25be8d015fc1d36a6b0caf3ebf89823",
    approvedBody:
      "Hi {{1}}, your Equb week(s) {{2}} closed without a payment recorded. Your balance is {{3}} outstanding across {{4}} weeks. Please contact Firaoli if this does not match your records.",
    variableOrder: ["name", "lateWeeks", "amountOwed", "weeksBehind"],
  }),

  WINNER_ANNOUNCEMENT: approved({
    key: "WINNER_ANNOUNCEMENT",
    contentSid: "HX2774ec28d2785140d4610ba2f947f6e5",
    approvedBody:
      "Hi {{1}}, your Equb payout for week {{2}} is {{3}}. Your contributions continue to week {{4}}. Firaoli will arrange the handover.",
    variableOrder: ["name", "week", "payoutAmount", "finishWeek"],
  }),

  CYCLE_CLOSING_STATEMENT: approved({
    key: "CYCLE_CLOSING_STATEMENT",
    contentSid: "HX517e5e10d8f11e741789b5c6ebed9565",
    approvedBody:
      "Hi {{1}}, your Equb closing statement: you paid {{2}} of {{3}} weeks, {{4}} in total. Outstanding balance {{5}}. Please contact Firaoli to confirm.",
    variableOrder: ["name", "weeksPaid", "weeksTotal", "totalPaid", "amountOwed"],
  }),
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
