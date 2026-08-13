import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// TWO TRAPS THAT DELETE THE FEEDBACK WITHOUT BREAKING ANYTHING ELSE.
//
// UI_STANDARDS rule 6 puts the confirmation and the refusal AT the control.
// Both of these files satisfied that until one line each undid it, and neither
// line looks wrong: one hides a spent panel, the other is a missing catch. A
// type error fires for neither, and the pages keep working — they just stop
// telling the organizer what happened.
//
// There is no jsdom in this repo (see week-date-panel.test.tsx), so neither
// control can be pressed in a test, and `renderToStaticMarkup` cannot reach
// either branch: both live behind state that only an effect or a click sets.
// A source guard is what is left, so these read the CODE with the comments
// stripped — both files explain these traps in prose that quotes the very
// strings being asserted, and a guard that passes on its own documentation is
// not a guard.

const ROOT = join(import.meta.dirname, "..", "..");
const ACCOUNT_MENU = join(ROOT, "components", "admin", "account-menu.tsx");
const CARRY_OFFER = join(ROOT, "components", "admin", "carry-deduction-offer.tsx");

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

const menu = code(ACCOUNT_MENU);
const offer = code(CARRY_OFFER);

describe("account-menu — a sign-out that fails has to say so (rule 6b)", () => {
  // Sign-out is EXEMPT from the rest of rule 6: there is no record to confirm
  // and the page is left behind. The refusal is the part that still applies,
  // and it was being thrown away — the promise rejected into nothing and the
  // item went back to reading "Sign out" while the organizer stayed signed in.
  it("renders the reason beside the item that was pressed", () => {
    expect(menu).toMatch(/<SaveFeedback\b/);
    expect(menu).toMatch(/setSignOut\(\{\s*kind:\s*"err"/);
  });

  // THE TRAP. A successful sign-out redirects, and Next delivers that redirect
  // to the caller by REJECTING the action promise. So the catch that reports
  // failures is entered on SUCCESS too, and without `unstable_rethrow` first —
  // which throws the framework's own control-flow errors straight back — every
  // successful sign-out would accuse itself of having failed, on the way out.
  it("rethrows the framework's redirect BEFORE it reports anything", () => {
    const rethrow = menu.indexOf("unstable_rethrow(");
    const report = menu.search(/setSignOut\(\{\s*kind:\s*"err"/);
    expect(rethrow, "the catch must hand NEXT_REDIRECT back to the router").toBeGreaterThan(-1);
    expect(report, "the refusal must be reported only after the rethrow").toBeGreaterThan(rethrow);
  });
});

describe("carry-deduction-offer — the confirmation outlives the offer", () => {
  // THE TRAP. The success branch set the panel to "hidden", which returned
  // null on the very next render — taking down the confirmation it had just
  // set. Money moved and the organizer saw nothing at all: the exact defect
  // rule 6 exists for, produced by a line that reads as tidying up.
  it("does not hide the panel from inside the save", () => {
    expect(offer).toContain("async function handleDeduct");
    const handler = offer.slice(offer.indexOf("async function handleDeduct"));
    expect(handler).not.toMatch(/setState\(/);
  });

  it("renders the confirmation where the offer was", () => {
    expect(offer).toMatch(/save\.kind === "ok"[\s\S]*?<SaveFeedback/);
  });

  // "Saved." leaves the organizer checking the arithmetic himself, which is
  // what the confirmation exists to spare him. The figures come from the
  // SERVER's result, not the panel's own preview.
  it("says what happened, with the figures", () => {
    const success = offer.slice(offer.indexOf('kind: "ok"'), offer.indexOf("router.refresh()"));
    for (const figure of ["result.data.deducted", "result.data.netAfter", "result.data.balanceAfter"]) {
      expect(success, `the confirmation must carry ${figure}`).toContain(figure);
    }
  });

  it("has no hand-rolled alert left above the fold", () => {
    expect(offer).not.toMatch(/<Alert\b/);
  });
});
