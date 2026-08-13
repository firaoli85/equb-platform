import { createHash } from "node:crypto";
import { formatDateLongUTC, formatMoney } from "./format";

// THE MEMBER AGREEMENT — one member's own terms, in their own frame.
//
// WHAT THIS REPLACES. The old app showed every member the same paragraph:
// "all 20 weeks", "starting May 17, 2026", "September 27, 2026" — hardcoded.
// A member who joined for ten weeks signed a document saying they would pay
// twenty. The wording also predated the fee ruling, and said only that the fee
// came off a refund rather than that it is fixed by what was committed to.
//
// THREE DATES, NOT TWO, and that is the substantive change. Their FINISH date
// is when their own payments stop. The EQUB'S end date is when a return would
// be settled. For a ten-week member of a twenty-week cycle those are different
// days, and the old paragraph had no way to say so — it used one pair of dates
// for both facts.
//
// NEVER A WEEK NUMBER. UI_STANDARDS 8c: cycle week numbers are the organizer's
// frame. A member reads dates and their own counts.
//
// PURE. Terms in, text out. The action layer supplies the figures from the
// same functions the portal uses, so the document cannot disagree with what
// the member is shown later, and every clause here is unit-testable without a
// database.

/** The facts a member's agreement states. Every one is theirs, none global. */
export type AgreementTerms = {
  memberName: string;
  organizerName: string;
  cycleName: string;
  /** Cents. */
  weeklyAmount: number;
  weeksCommitted: number;
  /** The day their own first week falls on — a stored week row (rule 7). */
  startDate: Date;
  /** The day their own LAST week falls on. Not the cycle's end. */
  finishDate: Date;
  /** The day the whole equb finishes, when a return would be settled. */
  cycleEndDate: Date;
  /** Cents: what the whole commitment adds up to. */
  totalContribution: number;
  /** Cents: what they are entitled to when their number is drawn. */
  payoutGross: number;
  /** Cents: the management fee, fixed by the COMMITMENT (rule 2). */
  feeAmount: number;
  /** Cents: gross minus fee — what reaches their hand. */
  payoutNet: number;
  feePercent: number;
};

export type AgreementClause = { heading: string; body: string };

/**
 * THE CLAUSE TEMPLATE — the default wording, version 1.
 *
 * Organizer-editable from here on (2.6): this constant seeds the first
 * `AgreementVersion` row, and every later edit appends a new row rather than
 * changing this. So it is the STARTING POINT, never the live document.
 *
 * Placeholders are the same `{token}` shape the message templates use, so the
 * organizer edits one syntax across the platform rather than two.
 */
export const AGREEMENT_V1_BODY = `1. What I am joining
I, {memberName}, am joining the equb {cycleName}, run by {organizerName}.

2. What I pay, and until when
I agree to pay {weeklyAmount} every week for {weeksCommitted}, starting {startDate} and finishing {finishDate}. That is {totalContribution} in total.

3. What I receive
When my number is drawn I receive {payoutGross}, less the management fee of {feeAmount} — {payoutNet} in my hand. Whether my number comes up early or late, I keep paying my weekly amount until {finishDate}.

4. The management fee
The fee is {feeAmount}, which is {feePercent} of what I am entitled to. It is fixed by what I committed to, not by how many weeks I end up paying. If I stop early the fee does not shrink. It changes only if my weekly amount changes.

5. If I stop before my number is drawn
My money is not lost. It is returned to me when the whole equb finishes on {cycleEndDate} — not on the day I stop. The management fee is taken off what is returned.

6. If I stop after my number is drawn
I have already received the money, so I still owe the rest of my weekly payments to the group. That debt stays with me, and it does not end when this equb does.

7. Leaving affects everyone
An equb works because each member's payments fund the next member's turn. I agree not to disrupt the group by leaving mid-cycle, and to tell {organizerName} as early as I can if I am struggling to pay, so it can be arranged rather than chased.

8. What I will do
I will pay on time each week, keep my phone number up to date, and not let anyone else use my sign-in.

9. What this is not
An equb is an agreement of trust between its members. It is not a bank and it is not a licensed financial institution. No payout is guaranteed by anyone outside the group.

10. Messages
I agree to receive messages about my own equb — payment confirmations, reminders and my closing statement. I can ask {organizerName} to stop them at any time.`;

/**
 * Every value a clause may reference, filled from ONE member's terms.
 *
 * The return type is INFERRED so `AgreementPlaceholder` below reads the real
 * keys off it — the same discipline `placeholderValues` uses in lib/messages,
 * and for the same reason: a token nobody defines must be a compile error, not
 * a literal `{feeAmuont}` in a document somebody signs.
 */
export function agreementValues(terms: AgreementTerms) {
  const weeks = terms.weeksCommitted;
  return {
    memberName: terms.memberName,
    organizerName: terms.organizerName,
    cycleName: terms.cycleName,
    weeklyAmount: formatMoney(terms.weeklyAmount),
    // "10 weeks", not "10" — the sentence reads as a count, and a bare number
    // beside a date is the shape that gets misread as a week NUMBER.
    weeksCommitted: `${weeks} ${weeks === 1 ? "week" : "weeks"}`,
    startDate: formatDateLongUTC(terms.startDate),
    finishDate: formatDateLongUTC(terms.finishDate),
    cycleEndDate: formatDateLongUTC(terms.cycleEndDate),
    totalContribution: formatMoney(terms.totalContribution),
    payoutGross: formatMoney(terms.payoutGross),
    feeAmount: formatMoney(terms.feeAmount),
    payoutNet: formatMoney(terms.payoutNet),
    // Trailing zeros dropped: "2%" reads as a rate, "2.00%" as a measurement.
    feePercent: `${Number(terms.feePercent.toFixed(2))}%`,
  };
}

export type AgreementPlaceholder = keyof ReturnType<typeof agreementValues>;

/** Every token the organizer may use, for the editor's own reference. */
export const AGREEMENT_PLACEHOLDERS: AgreementPlaceholder[] = Object.keys(
  agreementValues({
    memberName: "",
    organizerName: "",
    cycleName: "",
    weeklyAmount: 0,
    weeksCommitted: 1,
    startDate: new Date(0),
    finishDate: new Date(0),
    cycleEndDate: new Date(0),
    totalContribution: 0,
    payoutGross: 0,
    feeAmount: 0,
    payoutNet: 0,
    feePercent: 0,
  }),
) as AgreementPlaceholder[];

/**
 * The document this member signs — the template with THEIR figures in it.
 *
 * A token the values do not define is left ALONE rather than blanked. A
 * document is not a message: a blank where a figure should be is a sentence
 * that reads as complete and states nothing, whereas `{feeAmuont}` sitting
 * there is a typo the organizer sees the moment he previews it. Nobody signs
 * over a visible token; somebody would sign over a gap.
 */
export function renderAgreement(body: string, terms: AgreementTerms): string {
  const values = agreementValues(terms) as Record<string, string>;
  return body.replace(/\{([a-zA-Z]+)\}/g, (raw, token: string) =>
    Object.hasOwn(values, token) ? values[token] : raw,
  );
}

/** Any token in the body that no value fills — shown to the organizer. */
export function unknownAgreementTokens(body: string): string[] {
  const known = new Set<string>(AGREEMENT_PLACEHOLDERS);
  const found = [...body.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1]);
  return [...new Set(found.filter((t) => !known.has(t)))];
}

/**
 * The rendered document split into clauses, for the screen.
 *
 * The screen renders THESE, and the hash is taken over the rendered TEXT — so
 * what is displayed and what is proven come from one string. Splitting for
 * display after hashing, rather than assembling for hashing after display, is
 * what stops the two drifting.
 */
export function agreementClauses(rendered: string): AgreementClause[] {
  return rendered
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const newline = block.indexOf("\n");
      if (newline === -1) return { heading: "", body: block };
      return {
        heading: block.slice(0, newline).trim(),
        body: block.slice(newline + 1).trim(),
      };
    });
}

/**
 * SHA-256 of the exact document, hex.
 *
 * THE LOAD-BEARING FIELD. The version number says which WORDING; this proves
 * it character for character INCLUDING the figures, which the version alone
 * cannot — those are derived from a participation that can change the next
 * day. Together they answer "what exactly did this person agree to", which is
 * the question the old system could not answer at all.
 *
 * Normalised on line endings only. Nothing else is touched: trimming or
 * collapsing whitespace would make two genuinely different documents hash the
 * same, which is the one failure a hash must not have.
 */
export function agreementHash(rendered: string): string {
  return createHash("sha256").update(rendered.replace(/\r\n/g, "\n"), "utf8").digest("hex");
}

/**
 * Does this member have to sign before reaching their portal?
 *
 * THE WHOLE GATE, in one pure function so every caller asks it the same way.
 *
 *   requiredAt === null  → no welcome was ever sent. NOT gated. This is the
 *                          state all 27 existing members are in, and it needs
 *                          no exemption list and no date comparison.
 *   a signature NEWER    → satisfied.
 *   a signature OLDER    → gated again. Sending a second welcome after
 *                          changing their terms sets a later `requiredAt`, so
 *                          the old signature no longer answers it. That is the
 *                          entire "changed terms" mechanism — no re-sign flow.
 */
export function agreementOutstanding(input: {
  requiredAt: Date | null;
  lastSignedAt: Date | null;
}): boolean {
  if (input.requiredAt === null) return false;
  if (input.lastSignedAt === null) return true;
  return input.lastSignedAt.getTime() < input.requiredAt.getTime();
}

/**
 * WHY a signature is owed, or null. **The gate's only owner.**
 *
 * There are now TWO ROUTES into being required to sign, and they are
 * independent — neither is a special case of the other:
 *
 *   `welcome-sent`         the organizer sent WHATSAPP_WELCOME, which sets
 *                          `agreementRequiredAt`. {@link agreementOutstanding}
 *                          owns this half and is unchanged.
 *
 *   `no-payment-recorded`  nothing has ever been received against this
 *                          participation. A member who has committed and paid
 *                          nothing has agreed to nothing either, and the
 *                          portal shows an empty account that says nothing
 *                          about what they owe. Signing is what turns a name
 *                          in the directory into a member.
 *
 * WHY THE SECOND ROUTE IS BOUNDED, and this is the load-bearing part. It
 * applies ONLY to a live participation in a running cycle:
 *
 *   a member who has PAID ANYTHING     — the route does not reach them, ever.
 *                                        This is what keeps all 27 existing
 *                                        members out of it: they have all paid.
 *   a STOPPED participation            — they cannot pay now, so "has paid
 *                                        nothing" would be a permanent
 *                                        sentence rather than a prompt.
 *   a member of a CLOSED cycle         — 2.18: closed members keep access to
 *                                        their own record. Locking them out of
 *                                        the history the platform kept FOR them
 *                                        is the opposite of what that says.
 *
 * The last two are why this cannot be a two-line addition to
 * `agreementOutstanding`: that function answers a question about two
 * timestamps, and these are facts about a participation.
 *
 * ONCE THEY SIGN, THE SECOND ROUTE IS DONE WITH THEM — it asks for a
 * signature, not for a payment, so any signature satisfies it. A later
 * welcome can still gate them again through the first route, which is the
 * changed-terms mechanism and is meant to keep working.
 */
export type AgreementRequirement = "welcome-sent" | "no-payment-recorded";

export function agreementRequirement(input: {
  requiredAt: Date | null;
  lastSignedAt: Date | null;
  /** Has any money ever been received against THIS participation? */
  hasEverPaid: boolean;
  /** Their participation is ACTIVE — not stopped, not closed out. */
  participationLive: boolean;
  /** Their cycle is still running. */
  cycleOpen: boolean;
}): AgreementRequirement | null {
  // THE WELCOME ROUTE IS ASKED FIRST, and deliberately without any of the
  // bounds below. A member who was sent the welcome was asked, personally, by
  // the organizer — stopping or the cycle closing does not un-ask it, and
  // silently dropping that requirement would lose a decision he made.
  if (agreementOutstanding({ requiredAt: input.requiredAt, lastSignedAt: input.lastSignedAt })) {
    return "welcome-sent";
  }
  if (input.hasEverPaid) return null;
  if (input.lastSignedAt !== null) return null;
  if (!input.participationLive || !input.cycleOpen) return null;
  return "no-payment-recorded";
}

/**
 * What to tell a member gated by {@link agreementRequirement}, above the
 * document. Two routes, two true sentences — a member who was never sent
 * anything must not be told to check a message that does not exist.
 */
export function requirementReason(requirement: AgreementRequirement): string {
  return requirement === "welcome-sent"
    ? "You were sent a welcome message. Please read your agreement and sign it to open your account."
    : "There is no payment recorded on your account yet. Please read your agreement and sign it — " +
      "once you have, your account opens and your weeks appear here as they are paid.";
}

/**
 * What the signing screen says it is recording, in the member's own words.
 *
 * ONE SENTENCE, and it is honest. It names what is kept and does not imply
 * anything more — in particular there is no MAC address here, because a web
 * page cannot read one and a record must not claim what it cannot hold.
 */
export const SIGNATURE_NOTICE =
  "When you sign, we record the date and time, your IP address, and what device and browser " +
  "you used — along with an exact copy of the words above, so it is always clear what you agreed to.";
