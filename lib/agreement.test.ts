import { describe, expect, it } from "vitest";
import {
  AGREEMENT_PLACEHOLDERS,
  AGREEMENT_V1_BODY,
  agreementClauses,
  agreementHash,
  agreementOutstanding,
  agreementRequirement,
  agreementValues,
  renderAgreement,
  requirementReason,
  SIGNATURE_NOTICE,
  unknownAgreementTokens,
  type AgreementTerms,
} from "./agreement";

// THE MEMBER AGREEMENT.
//
// The old app showed every member the same paragraph: "all 20 weeks",
// "starting May 17, 2026", "September 27, 2026" — hardcoded. A member who
// joined for ten weeks signed a document saying they would pay twenty. These
// pin that it is now THEIRS, that the fee rule it states is the current one,
// and that the gate behaves the way the ruling describes.

const TERMS: AgreementTerms = {
  memberName: "Henok Tesfaye",
  organizerName: "Firaoli",
  cycleName: "Cycle 1 2026",
  weeklyAmount: 50_000, // $500
  weeksCommitted: 10,
  startDate: new Date("2026-08-16T00:00:00Z"),
  finishDate: new Date("2026-10-18T00:00:00Z"),
  cycleEndDate: new Date("2026-09-27T00:00:00Z"),
  totalContribution: 500_000,
  payoutGross: 500_000,
  feeAmount: 10_000,
  payoutNet: 490_000,
  feePercent: 2,
};

const rendered = () => renderAgreement(AGREEMENT_V1_BODY, TERMS);

describe("the document is THIS member's, not a shared one", () => {
  it("states their own weekly amount, count and dates", () => {
    const text = rendered();
    expect(text).toContain("$500");
    expect(text).toContain("10 weeks");
    expect(text).toContain("August 16, 2026");
    expect(text).toContain("October 18, 2026");
  });

  // THE DEFECT, PINNED. The old paragraph said "all 20 weeks" to a ten-week
  // member. Nothing global may survive into the rendered text.
  it("contains no figure that is not theirs", () => {
    const text = rendered();
    expect(text).not.toContain("20 weeks");
    expect(text).not.toContain("May 17");
  });

  // UI_STANDARDS 8c: cycle week numbers are the organizer's frame. A member
  // reads dates and their own counts.
  it("never names a cycle week number", () => {
    expect(rendered()).not.toMatch(/\bweek \d+\b/i);
  });

  it("reads '1 week' for a one-week commitment, not '1 weeks'", () => {
    const one = renderAgreement(AGREEMENT_V1_BODY, { ...TERMS, weeksCommitted: 1 });
    expect(one).toContain("1 week,");
    expect(one).not.toContain("1 weeks");
  });

  // THREE DATES, NOT TWO — the substantive change. Their finish date is when
  // their payments stop; the equb's end is when a return is settled. For a
  // ten-week member of a twenty-week cycle those are different days, and the
  // old document used one pair for both facts.
  it("distinguishes their finish date from the equb's end date", () => {
    const text = rendered();
    // The weekday rides along — a member plans by "Sunday", not by a date.
    expect(text).toContain("finishing Sunday, October 18, 2026");
    expect(text).toContain("finishes on Sunday, September 27, 2026");
    expect(TERMS.finishDate.getTime()).not.toBe(TERMS.cycleEndDate.getTime());
  });
});

describe("the clauses the organizer asked to keep", () => {
  const text = rendered();

  it("keeps the substance of the paragraph members already sign", () => {
    expect(text).toContain("Henok Tesfaye"); // who
    expect(text).toContain("$500 every week"); // their amount
    expect(text).toContain("It is returned to me when the whole equb finishes"); // the wait
    expect(text).toContain("The management fee is taken off what is returned."); // the fee
    expect(text).toContain("not to disrupt the group by leaving mid-cycle"); // the promise
  });

  // DOMAIN_RULES rule 2. The old wording said only that the fee came off a
  // refund; it never said the fee is fixed by the COMMITMENT.
  it("says the fee is fixed by the commitment, not by attendance", () => {
    expect(text).toContain("fixed by what I committed to, not by how many weeks I end up paying");
    expect(text).toContain("If I stop early the fee does not shrink");
    expect(text).toContain("only if my weekly amount changes");
  });

  // NEW. The old paragraph covered stopping BEFORE a payout and said nothing
  // about stopping after one — the case that costs the group money, and
  // already how the platform behaves (2.18).
  it("covers stopping AFTER the payout, which the old paragraph did not", () => {
    expect(text).toContain("I still owe the rest of my weekly payments");
    expect(text).toContain("does not end when this equb does");
  });

  it("says what an equb is not", () => {
    expect(text).toContain("not a bank");
    expect(text).toContain("No payout is guaranteed");
  });
});

describe("placeholders", () => {
  it("every token in the default body is one the values fill", () => {
    expect(unknownAgreementTokens(AGREEMENT_V1_BODY)).toEqual([]);
  });

  it("leaves nothing unsubstituted in the rendered document", () => {
    expect(rendered()).not.toMatch(/\{[a-zA-Z]+\}/);
  });

  // A DOCUMENT IS NOT A MESSAGE. A blank where a figure belongs is a sentence
  // that reads as complete and states nothing; a visible `{feeAmuont}` is a
  // typo the organizer catches in the preview. Nobody signs over a token.
  it("leaves an UNKNOWN token visible rather than blanking it", () => {
    const out = renderAgreement("The fee is {feeAmuont} in total.", TERMS);
    expect(out).toBe("The fee is {feeAmuont} in total.");
  });

  it("names the unknown token for the organizer", () => {
    expect(unknownAgreementTokens("a {feeAmuont} and a {memberName}")).toEqual(["feeAmuont"]);
  });

  it("offers the tokens the values actually define — the two cannot drift", () => {
    expect(AGREEMENT_PLACEHOLDERS).toContain("memberName");
    expect(AGREEMENT_PLACEHOLDERS).toContain("payoutNet");
    expect(AGREEMENT_PLACEHOLDERS).toEqual(Object.keys(agreementValues(TERMS)));
  });

  it("renders money and percent as a person reads them", () => {
    const v = agreementValues(TERMS);
    expect(v.weeklyAmount).toBe("$500");
    expect(v.payoutNet).toBe("$4,900");
    expect(v.feePercent).toBe("2%");
    // 2.5% survives; 2.00% does not become "2.00%".
    expect(agreementValues({ ...TERMS, feePercent: 2.5 }).feePercent).toBe("2.5%");
  });
});

describe("the hash is what proves which document was signed", () => {
  it("is stable for the same text", () => {
    expect(agreementHash(rendered())).toBe(agreementHash(rendered()));
  });

  it("is 64 hex characters", () => {
    expect(agreementHash(rendered())).toMatch(/^[0-9a-f]{64}$/);
  });

  // THE VERSION ALONE CANNOT DO THIS. Two members on the same wording have
  // different figures, and one member's figures change the day their terms do.
  it("differs when only a FIGURE differs, on identical wording", () => {
    const twelve = renderAgreement(AGREEMENT_V1_BODY, { ...TERMS, weeksCommitted: 12 });
    expect(agreementHash(twelve)).not.toBe(agreementHash(rendered()));
  });

  it("differs when only the WORDING differs, on identical figures", () => {
    const edited = renderAgreement(`${AGREEMENT_V1_BODY}\n\n11. Extra\nSomething new.`, TERMS);
    expect(agreementHash(edited)).not.toBe(agreementHash(rendered()));
  });

  // Line endings only. Trimming or collapsing whitespace would let two
  // genuinely different documents hash the same — the one failure a hash
  // must not have.
  it("ignores line endings and NOTHING else", () => {
    expect(agreementHash("a\r\nb")).toBe(agreementHash("a\nb"));
    expect(agreementHash("a b")).not.toBe(agreementHash("a  b"));
    expect(agreementHash(" a")).not.toBe(agreementHash("a"));
  });
});

describe("the clauses reach the screen from the SAME string that is hashed", () => {
  it("splits the rendered document into its ten clauses", () => {
    const clauses = agreementClauses(rendered());
    expect(clauses).toHaveLength(10);
    expect(clauses[0].heading).toBe("1. What I am joining");
    expect(clauses[9].heading).toBe("10. Messages");
  });

  it("carries the member's figures into the clause bodies", () => {
    const clauses = agreementClauses(rendered());
    expect(clauses[1].body).toContain("$500 every week for 10 weeks");
  });

  // Splitting for DISPLAY after hashing — rather than assembling for hashing
  // after display — is what stops the shown text and the proven text drifting.
  it("loses nothing: the clauses put back together are the hashed text", () => {
    const text = rendered();
    const rebuilt = agreementClauses(text)
      .map((c) => `${c.heading}\n${c.body}`)
      .join("\n\n");
    expect(rebuilt).toBe(text.trim());
  });
});

// THE GATE. Sending the welcome is what requires a signature (organizer
// ruling) — no date comparison, no exemption list.
describe("who has to sign", () => {
  const at = (iso: string) => new Date(iso);

  // THE 27 EXISTING MEMBERS. None has been sent a welcome, so none is gated,
  // and nothing had to be written for them at all.
  it("does not gate a member who was never sent a welcome", () => {
    expect(agreementOutstanding({ requiredAt: null, lastSignedAt: null })).toBe(false);
  });

  it("gates a member sent one who has not signed", () => {
    expect(agreementOutstanding({ requiredAt: at("2026-08-12T10:00:00Z"), lastSignedAt: null })).toBe(
      true,
    );
  });

  it("lets through a member who signed after being asked", () => {
    expect(
      agreementOutstanding({
        requiredAt: at("2026-08-12T10:00:00Z"),
        lastSignedAt: at("2026-08-12T10:05:00Z"),
      }),
    ).toBe(false);
  });

  // THE WHOLE "CHANGED TERMS" MECHANISM, and the reason there is no re-sign
  // flow to build: a second welcome sets a later moment, so the earlier
  // signature stops answering it.
  it("gates again when a NEW welcome is sent after an old signature", () => {
    expect(
      agreementOutstanding({
        requiredAt: at("2026-09-01T09:00:00Z"),
        lastSignedAt: at("2026-08-12T10:05:00Z"),
      }),
    ).toBe(true);
  });

  // A signature at the same instant counts — the requirement is "signed since
  // being asked", and being asked and signing cannot be ordered inside one
  // millisecond.
  it("counts a signature at the same moment as the request", () => {
    const moment = at("2026-08-12T10:00:00Z");
    expect(agreementOutstanding({ requiredAt: moment, lastSignedAt: moment })).toBe(false);
  });
});

describe("what the screen tells them is being recorded", () => {
  it("names what is kept, in one sentence", () => {
    expect(SIGNATURE_NOTICE).toContain("date and time");
    expect(SIGNATURE_NOTICE).toContain("IP address");
    expect(SIGNATURE_NOTICE).toContain("device and browser");
    expect(SIGNATURE_NOTICE).toContain("exact copy of the words above");
  });

  // A web page cannot read a MAC address on any browser. A record must not
  // claim what it cannot hold, and the notice must not either.
  it("claims no MAC address", () => {
    expect(SIGNATURE_NOTICE.toLowerCase()).not.toContain("mac");
  });
});

// THE SECOND ROUTE (organizer ruling, Aug 2026): no payment recorded → the
// agreement is required → the portal is gated until they sign. Sending the
// welcome is one route to being gated; having paid nothing is another.
describe("agreementRequirement — the two routes, and the bounds on the second", () => {
  const at = (iso: string) => new Date(iso);
  // A live member of the running cycle who has paid and was never welcomed —
  // the state all 27 existing members are in. Everything below perturbs this.
  const settled = {
    requiredAt: null as Date | null,
    lastSignedAt: null as Date | null,
    hasEverPaid: true,
    participationLive: true,
    cycleOpen: true,
  };

  // THE CRITICAL PROPERTY, the one the rollout hangs on: a paying member with
  // no welcome is not gated by either route. If this fails, the existing 27
  // lock out on deploy.
  it("does not reach a member who has paid anything and was never welcomed", () => {
    expect(agreementRequirement(settled)).toBeNull();
  });

  it("gates a live unpaid member of the running cycle — the new route", () => {
    expect(agreementRequirement({ ...settled, hasEverPaid: false })).toBe("no-payment-recorded");
  });

  // FALSIFIABLE each way: drop either guard in the implementation and its
  // line here fails alone, naming the bound that was lost.
  it("never reaches a stopped member, or a member of a closed cycle (2.18)", () => {
    expect(
      agreementRequirement({ ...settled, hasEverPaid: false, participationLive: false }),
    ).toBeNull();
    expect(agreementRequirement({ ...settled, hasEverPaid: false, cycleOpen: false })).toBeNull();
  });

  it("is satisfied by ANY signature — it asks for a signature, not a payment", () => {
    expect(
      agreementRequirement({
        ...settled,
        hasEverPaid: false,
        lastSignedAt: at("2026-08-13T10:00:00Z"),
      }),
    ).toBeNull();
  });

  // The welcome route is untouched by every bound above: he asked personally,
  // and stopping does not un-ask it.
  it("the welcome route still fires whatever the payment or participation state", () => {
    const asked = { ...settled, requiredAt: at("2026-08-12T10:00:00Z") };
    expect(agreementRequirement(asked)).toBe("welcome-sent");
    expect(
      agreementRequirement({ ...asked, hasEverPaid: false, participationLive: false, cycleOpen: false }),
    ).toBe("welcome-sent");
  });

  // …and wins when both apply: the member was ASKED, and that is the request
  // the organizer is waiting on.
  it("reports welcome-sent when both routes are open", () => {
    expect(
      agreementRequirement({
        ...settled,
        requiredAt: at("2026-08-12T10:00:00Z"),
        hasEverPaid: false,
      }),
    ).toBe("welcome-sent");
  });

  // A member gated by the second route was never sent anything — the screen
  // must not tell them to check a message that does not exist.
  it("each route gets its own true sentence", () => {
    expect(requirementReason("welcome-sent")).toContain("welcome message");
    expect(requirementReason("no-payment-recorded")).not.toContain("message");
    expect(requirementReason("no-payment-recorded")).toContain("no payment recorded");
  });
});
