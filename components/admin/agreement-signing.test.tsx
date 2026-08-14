import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgreementSigningCard, SigningChip, type MemberSigningView } from "./agreement-signing";
import { PeopleDirectory, type DirectoryRow } from "@/app/admin/(protected)/people/people-directory";

// THE ORGANIZER'S VIEW OF SIGNING, ASSERTED ON RENDERED HTML.
//
// There is no jsdom in this repo, and none is needed: every state below is
// reachable from props alone, so the markup IS the test. What is being pinned
// is the WORDING and the TONE, because both were the requirement — a state
// this screen states as a bare "Signed: no" is a state the organizer has to
// interpret, and the four cases interpret in opposite directions.
//
// EVERY TEST NAMES WHAT IT KILLS. These could not have passed before because
// no surface rendered signing state at all; what makes them worth keeping is
// that each one fails on a specific plausible rewrite of this component.

const state = (over: Partial<MemberSigningView> = {}): MemberSigningView => ({
  requiredAt: null,
  signedAt: null,
  version: null,
  device: null,
  ip: null,
  hasOwnPin: false,
  ...over,
});

const card = (over: Partial<MemberSigningView> = {}) =>
  renderToStaticMarkup(<AgreementSigningCard personName="Tsion" state={state(over)} />);

/** The tone classes `Pill` paints — the only honest way to assert "warning". */
const AMBER = "text-amber-700";
const RED = "text-red-700";
const EMERALD = "text-emerald-700";
const GREY = "text-gray-600";

const ASKED = "2026-08-10T15:30:00.000Z";
const SIGNED_BEFORE = "2026-08-09T18:05:00.000Z";
const SIGNED_AFTER = "2026-08-11T18:05:00.000Z";

describe("never sent a welcome — the state all 27 existing members are in", () => {
  it("says what is true in the ruling's own words", () => {
    const out = card();
    expect(out).toContain("No agreement has been asked for. Sending the welcome is what asks for one.");
  });

  // KILLS a version that reuses the waiting copy with a null date in it. "Not
  // signed" and "not asked" are opposite facts, and the second must not
  // borrow the first's language — nobody is locked out here.
  it("never says their portal is closed, because it is not", () => {
    const out = card();
    expect(out).not.toContain("portal is closed");
    expect(out).not.toContain("has not signed");
    expect(out).toContain("portal is open");
  });

  // THE GUARD THE RULING ASKED FOR. An amber or red chip here would invent a
  // problem on every row of a directory where nothing is wrong, and would
  // teach the organizer to ignore the colour on the rows where something is.
  it("renders as a fact, not a warning and not an error", () => {
    for (const out of [card({ hasOwnPin: true }), card({ hasOwnPin: false })]) {
      expect(out).toContain("Not asked");
      expect(out).not.toContain(AMBER);
      expect(out).not.toContain(RED);
      expect(out).not.toContain('role="alert"');
      expect(out.toLowerCase()).not.toContain("warning");
      expect(out.toLowerCase()).not.toContain("overdue");
    }
  });
});

describe("asked, and nothing signed", () => {
  it("says when it was asked and that they have not signed", () => {
    const out = card({ requiredAt: ASKED });
    expect(out).toContain("Asked on");
    expect(out).toContain("2026");
    expect(out).toContain("Tsion has not signed yet");
  });

  // THE CONSEQUENCE, NOT JUST THE STATE. The gate in app/me/layout.tsx sends
  // them to /agreement and nowhere else, so a member in this state is calling
  // to say the app is broken. The screen has to answer that before he does.
  it("says the portal is closed to them until they sign", () => {
    const out = card({ requiredAt: ASKED });
    expect(out).toContain("portal is closed until they sign");
  });

  it("carries the waiting tone, which the not-asked state must not", () => {
    expect(card({ requiredAt: ASKED })).toContain(AMBER);
    expect(card()).not.toContain(AMBER);
  });
});

describe("signed", () => {
  const signed = () =>
    card({
      requiredAt: ASKED,
      signedAt: SIGNED_AFTER,
      version: 3,
      device: "Chrome on Windows",
      ip: "24.61.10.4",
      hasOwnPin: true,
    });

  // THE FOUR FACTS THE OLD APP SHOWED AND THIS ONE HAD TO CARRY ACROSS:
  // signed, when, from what device, and their own PIN.
  it("shows the date, the version and the device", () => {
    const out = signed();
    expect(out).toContain("Tsion signed on");
    expect(out).toContain("2026");
    expect(out).toContain("Version");
    expect(out).toContain("3");
    expect(out).toContain("Chrome on Windows");
    expect(out).toContain("24.61.10.4");
    expect(out).toContain(EMERALD);
  });

  // KILLS a version that shows the gate sentence unconditionally. A signed
  // member's portal is open; saying otherwise on their profile is the kind of
  // sentence that gets acted on.
  it("does not claim their portal is closed", () => {
    expect(signed()).not.toContain("portal is closed");
    expect(signed()).not.toContain(AMBER);
  });

  // THE DOCUMENT IS ALWAYS LIVE (ruling). A signature is not permanent
  // clearance, and the one place that says so is beside the signature itself.
  it("says a fresh welcome asks for a fresh signature", () => {
    expect(signed()).toContain("asks for a fresh signature");
  });
});

describe("asked again after signing", () => {
  const again = () =>
    card({
      requiredAt: ASKED,
      signedAt: SIGNED_BEFORE,
      version: 2,
      device: "Safari on iOS",
    });

  // KILLS the three-state collapse. There IS a signature on this record, and
  // an organizer told only "waiting" beside a visible signature concludes the
  // app lost it. This is the one state that has to explain itself.
  it("accounts for the earlier signature instead of ignoring it", () => {
    const out = again();
    expect(out).toContain("Asked again on");
    expect(out).toContain("They signed on");
    expect(out).toContain("Safari on iOS");
    expect(out).toContain("version 2");
    expect(out).toContain("against earlier terms");
  });

  it("is outstanding again, and says the portal is closed until they sign the current terms", () => {
    const out = again();
    expect(out).toContain("portal is closed until they sign the current terms");
    expect(out).toContain(AMBER);
    // Not the never-asked sentence, and not the never-signed one either.
    expect(out).not.toContain("No agreement has been asked for");
    expect(out).toContain("Waiting · new terms");
  });
});

describe("their own PIN — a fact, never a warning (the prompt is skippable)", () => {
  it("states it plainly when they set one", () => {
    const out = card({ hasOwnPin: true });
    expect(out).toContain("Tsion has set their own PIN");
    expect(out).not.toContain("skippable");
  });

  // THE RULING: the PIN prompt is never forced, so a member who skipped it has
  // done nothing wrong. This kills any wording that treats the absence as a
  // fault — and the tone guard above already refuses to colour it.
  it("states the absence as a choice, and points at the control that fixes it", () => {
    const out = card({ hasOwnPin: false });
    expect(out).toContain("Tsion has not set their own PIN");
    expect(out).toContain("skippable");
    expect(out).toContain("a choice rather than a fault");
    expect(out).not.toContain(AMBER);
    expect(out).not.toContain(RED);
  });
});

describe("the directory chip", () => {
  const chip = (s: Parameters<typeof SigningChip>[0]["state"]) =>
    renderToStaticMarkup(<SigningChip state={s} />);

  it("says which of the three states each person is in", () => {
    expect(chip("signed")).toContain("Signed");
    expect(chip("waiting")).toContain("Waiting");
    expect(chip("waiting-again")).toContain("Waiting · new terms");
    expect(chip("not-asked")).toContain("Not asked");
  });

  it("colours only the states that are actually waiting", () => {
    expect(chip("signed")).toContain(EMERALD);
    expect(chip("waiting")).toContain(AMBER);
    expect(chip("waiting-again")).toContain(AMBER);
    // The whole point: 27 rows of "Not asked" must read as a list with
    // nothing wrong with it.
    expect(chip("not-asked")).toContain(GREY);
    expect(chip("not-asked")).not.toContain(AMBER);
    expect(chip("not-asked")).not.toContain(RED);
  });
});

describe("the directory itself", () => {
  const row = (over: Partial<DirectoryRow>): DirectoryRow => ({
    id: "p1",
    nameAmharic: "ፀዮን",
    nameEnglish: "Tsion Alemu",
    phone: "+15551230000",
    pinState: "own",
    lockedMinutesLeft: null,
    cycles: "Cycle 1 2026 (active)",
    inActiveCycle: true,
    contributedThisCycle: 125_000,
    signing: "not-asked",
    // The sort facts the directory now carries (14 Aug 2026) — this file
    // asserts the signing column, so they only have to be present and real.
    weeklyAmount: 25_000,
    weeksCommitted: 20,
    weeksPaid: 5,
    ...over,
  });

  // ONE COLUMN, SCANNABLE DOWN THE LIST. Rendered from the real component, so
  // this fails if the column is dropped, renamed, or filled from a different
  // field than the one listPeople derives.
  it("carries a signing state for every person, in the list", () => {
    // DISTINCT NAMES, AND EACH CHIP READ FROM ITS OWN ROW. Three identical
    // names proved only that the three labels appeared SOMEWHERE on the page,
    // which is also true of a mapping that hands Tsion's "Signed" to Bekele —
    // the one defect this column can actually have, since every state is
    // plausible for every person and nothing else on the row contradicts it.
    const people = [
      { id: "a", nameEnglish: "Tsion Alemu", signing: "signed", label: "Signed" },
      { id: "b", nameEnglish: "Bekele Tadesse", signing: "waiting", label: "Waiting" },
      { id: "c", nameEnglish: "Hanna Girma", signing: "not-asked", label: "Not asked" },
    ] as const;

    const out = renderToStaticMarkup(
      <PeopleDirectory rows={people.map((p) => row({ id: p.id, nameEnglish: p.nameEnglish, signing: p.signing }))} />,
    );
    expect(out).toContain("Agreement");

    // The table renders one <tr> per person, name first and chip later in the
    // same row, so a row's own markup is the fragment to search.
    const rows = out.split("<tr").filter((fragment) => /Tsion|Bekele|Hanna/.test(fragment));
    expect(rows, "the list no longer renders one row per person").toHaveLength(3);

    for (const person of people) {
      const own = rows.find((fragment) => fragment.includes(person.nameEnglish));
      expect(own, `${person.nameEnglish} is not in the list`).toBeDefined();
      expect(own, `${person.nameEnglish}'s row does not carry ${person.label}`).toContain(
        person.label,
      );
      for (const other of people) {
        if (other.label === person.label) continue;
        expect(own, `${person.nameEnglish}'s row also reads ${other.label}`).not.toContain(
          other.label,
        );
      }
    }
  });

  // THE CARDS VIEW CANNOT BE REACHED FROM A STATIC RENDER — it lives behind
  // `useViewMode`, which only an effect or a click changes, and there is no
  // jsdom here (see components/admin/feedback-at-the-control.test.ts for the
  // same problem). So this reads the source with its comments stripped: a
  // guard that passes on the prose explaining it is not a guard.
  //
  // It is worth having because the toggle is per-organizer and sticky. Drop
  // the chip from the cards and every test above still passes while the
  // organizer who last chose Cards never sees signing state again.
  it("carries the same chip in the cards view", () => {
    const source = readFileSync(
      join(import.meta.dirname, "..", "..", "app", "admin", "(protected)", "people", "people-directory.tsx"),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    const cards = source.slice(source.indexOf("sm:grid-cols-2"));
    expect(cards).toContain("<SigningChip");
  });
});
