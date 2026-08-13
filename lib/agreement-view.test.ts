import { describe, expect, it } from "vitest";
import { signingState } from "./agreement-view";

// THE FOUR CASES, AND THE THREE WAYS A THREE-CASE VERSION GETS THEM WRONG.
//
// Every test below names the plausible implementation it kills. That matters
// here more than usual: the obvious shapes for "has this member signed" are a
// boolean on the signature and a boolean on the requirement, and BOTH answer
// most rows correctly while being wrong about the 27 members who are live
// right now.

const MAY = new Date("2026-05-17T14:00:00.000Z");
const JUNE = new Date("2026-06-21T14:00:00.000Z");

describe("no welcome has been sent", () => {
  // KILLS `signedAt === null ? "waiting" : "signed"`. That version reads the
  // signature and never the requirement, so it would put all 27 existing
  // members — who have never been asked for anything — into the state that
  // says their portal is closed until they sign.
  it("is NOT ASKED, not 'not signed'", () => {
    expect(signingState({ requiredAt: null, signedAt: null })).toBe("not-asked");
  });

  // KILLS any version that looks at the signature FIRST. `agreementRequiredAt`
  // is the only thing that creates a requirement (organizer ruling: sending
  // the welcome is what asks for one), so a signature with no live request
  // behind it cannot promote a member into a gated state.
  it("stays NOT ASKED even when a signature exists", () => {
    expect(signingState({ requiredAt: null, signedAt: MAY })).toBe("not-asked");
  });
});

describe("a welcome has been sent", () => {
  it("is WAITING while nothing is signed", () => {
    expect(signingState({ requiredAt: MAY, signedAt: null })).toBe("waiting");
  });

  it("is SIGNED once they sign", () => {
    expect(signingState({ requiredAt: MAY, signedAt: JUNE })).toBe("signed");
  });

  // THE BOUNDARY `agreementOutstanding` OWNS. Equal timestamps are satisfied,
  // not outstanding. A `<=` where the gate has `<` would gate a member the
  // portal itself lets through — the two would disagree about the same row,
  // which is the failure this module exists to make impossible.
  it("is SIGNED when the signature lands at the very instant it was asked for", () => {
    expect(signingState({ requiredAt: MAY, signedAt: MAY })).toBe("signed");
  });
});

describe("asked again after signing", () => {
  // KILLS a three-state version that collapses this into "waiting". The
  // organizer is looking at a row with a signature ON IT: told only
  // "waiting", he reasonably concludes the app lost the signature. The state
  // has to be distinguishable so the screen can say the earlier signature was
  // against earlier terms.
  it("is WAITING AGAIN, distinguishable from never having signed", () => {
    expect(signingState({ requiredAt: JUNE, signedAt: MAY })).toBe("waiting-again");
    expect(signingState({ requiredAt: JUNE, signedAt: MAY })).not.toBe("waiting");
  });

  // A REAL COMPARISON, NOT A CALENDAR ONE. A second welcome sent minutes
  // after a signature is the whole "their terms changed" mechanism, and a
  // day-granularity comparison would report it as satisfied.
  it("catches a re-ask one millisecond after the signature", () => {
    const signed = new Date("2026-06-21T14:00:00.000Z");
    const askedAgain = new Date("2026-06-21T14:00:00.001Z");
    expect(signingState({ requiredAt: askedAgain, signedAt: signed })).toBe("waiting-again");
  });
});

describe("the two callers speak two different types", () => {
  // The directory hands over Prisma `Date`s; the profile hands over the ISO
  // strings `getMemberAgreementState` serialises them into. If those answered
  // differently the list and the profile would contradict each other for the
  // same member — so this pins that one function normalises both.
  it("answers identically for ISO strings and Dates", () => {
    for (const [requiredAt, signedAt, expected] of [
      [null, null, "not-asked"],
      [MAY, null, "waiting"],
      [MAY, JUNE, "signed"],
      [JUNE, MAY, "waiting-again"],
    ] as const) {
      expect(signingState({ requiredAt, signedAt })).toBe(expected);
      expect(
        signingState({
          requiredAt: requiredAt === null ? null : requiredAt.toISOString(),
          signedAt: signedAt === null ? null : signedAt.toISOString(),
        }),
        `${expected} must not depend on whether the caller kept Dates`,
      ).toBe(expected);
    }
  });

  // `undefined` reaches this from `map.get()` on the grouped signature read in
  // listPeople — a member with no signature row at all. Treated as absent, the
  // same as null; anything else would throw or, worse, produce an Invalid Date
  // whose comparisons are all false and would silently read as SIGNED.
  it("treats a missing signature the same as none", () => {
    expect(signingState({ requiredAt: MAY, signedAt: undefined })).toBe("waiting");
    expect(signingState({ requiredAt: undefined, signedAt: undefined })).toBe("not-asked");
  });
});
