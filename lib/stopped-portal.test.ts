import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// GUARD — A STOPPED MEMBER SEES THEIR RECORD, NOT A BLANK WALL (2.18).
//
// Tsion stopped mid-cycle and her portal showed only "You're not in the
// current cycle. When the organizer adds you to a cycle, it will appear here."
// She had paid in for weeks. 2.18 is explicit: closed members KEEP access and
// can see where they stopped — "dignity, and a useful record for them".
//
// The cause was one filter. `portalParticipation` asked for
// `status: "ACTIVE"`, so a CLOSED participation came back null and the page
// fell through to the never-joined branch. NEVER JOINED and STOPPED are
// completely different facts that rendered the identical screen.
//
// This is a source scan because the failure is a MISSING branch: no unit test
// fails when a page renders the wrong one of two valid states, and no type
// error fires — `participation: null` is legitimate in both.

const ROOT = join(import.meta.dirname, "..");
const ACTION = readFileSync(join(ROOT, "app", "actions", "member.ts"), "utf8");
const PAGE = readFileSync(join(ROOT, "app", "me", "page.tsx"), "utf8");

describe("GUARD — the portal distinguishes stopped from never-joined", () => {
  // THE FIX, PINNED AT THE SOURCE. Something must look for a CLOSED
  // participation in the live cycle; without it the page cannot tell them
  // apart however it is written.
  it("the action looks for a CLOSED participation in the live cycle", () => {
    expect(ACTION).toMatch(/status:\s*"CLOSED"[\s\S]{0,120}cycle:\s*\{\s*status:\s*"ACTIVE"\s*\}/);
    expect(ACTION).toMatch(/\bstoppedRecord\b/);
  });

  it("and returns it as its own block, never as `participation`", () => {
    // Returning it as `participation` would render the savings ring, the week
    // grid and "next payment due" — a finished record reading as a live bill,
    // which is the mistake the note in that file was written about.
    expect(ACTION).toMatch(/stopped:\s*\{/);
    expect(ACTION).toMatch(/participation:\s*null,\s*\n?\s*stopped:/);
  });

  it("the block carries every fact 2.18 requires", () => {
    for (const field of ["startDate", "stoppedDate", "weeksPaid", "paidIn", "drawn", "sentence"]) {
      // `paidIn,` is shorthand for `paidIn: paidIn` — both count as carried.
      expect(ACTION, `the stopped block is missing ${field}`).toMatch(
        new RegExp(`\\b${field}\\s*[:,]`),
      );
    }
  });

  it("the final position is DERIVED, not stored (2.14)", () => {
    expect(ACTION).toMatch(/finalPosition\(\{/);
    expect(ACTION).toMatch(/finalPositionSentence\(/);
  });

  // THE PAGE MUST BRANCH ON IT, and before the never-joined branch — the
  // blank state is the fallthrough, so a later check never runs.
  it("the page renders the stopped record, and does so FIRST", () => {
    const stoppedBranch = PAGE.indexOf("result.data.stopped");
    // The blank state moved into <NotInCycle> (one presentation for the
    // three pages that show it); the branch order is what this pins.
    const blankBranch = PAGE.indexOf("<NotInCycle");
    expect(stoppedBranch, "the page never checks for a stopped record").toBeGreaterThan(-1);
    expect(blankBranch).toBeGreaterThan(-1);
    expect(
      stoppedBranch,
      "the blank state comes first, so the stopped branch can never be reached",
    ).toBeLessThan(blankBranch);
  });

  it("the record shows the sentence and the money, not just a heading", () => {
    const branch = PAGE.slice(PAGE.indexOf("result.data.stopped"), PAGE.indexOf("const past ="));
    expect(branch).toMatch(/st\.sentence/);
    expect(branch).toMatch(/formatMoney\(st\.paidIn\)/);
    expect(branch).toMatch(/You were not drawn|st\.drawn/);
  });

  // Their own frame (UI_STANDARDS 8c) — the member-vocabulary guard scans the
  // whole portal, and this branch is inside it. Restated here because THIS is
  // the screen where a cycle week number would be most tempting: the organizer
  // recorded "stopped at week 12".
  it("states when they stopped as a DATE, never a cycle week number", () => {
    const branch = PAGE.slice(PAGE.indexOf("result.data.stopped"), PAGE.indexOf("const past ="));
    expect(branch).toMatch(/st\.stoppedDate/);
    expect(branch).toMatch(/formatDateLongUTC\(new Date\(st\.stoppedDate\)\)/);
    expect(branch).not.toMatch(/\bweek \{/i);
    expect(branch).not.toMatch(/closedAtWeek/);
  });

  it("counts weeks against THEIR total, never the cycle's", () => {
    const branch = PAGE.slice(PAGE.indexOf("result.data.stopped"), PAGE.indexOf("const past ="));
    expect(branch).toMatch(/of your \{st\.weeksCommitted\}/);
    expect(branch).not.toMatch(/plannedWeeks/);
  });

  // NON-VACUITY: the ordering check must fail on the shape that shipped.
  it("the scan is not vacuous", () => {
    const shipped = `if (!participation) {\n  return blank;\n}\n// stopped never checked`;
    expect(shipped.indexOf("result.data.stopped")).toBe(-1);
    const wrongOrder = `if (!participation) { return blank; }\nif (result.data.stopped) {}`;
    expect(wrongOrder.indexOf("result.data.stopped")).toBeGreaterThan(
      wrongOrder.indexOf("return blank"),
    );
  });
});
