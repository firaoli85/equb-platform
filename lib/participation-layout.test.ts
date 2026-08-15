import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// THE PARTICIPATION SETTINGS LAYOUT (2.25 pass, 14 Aug 2026).
//
// A SOURCE SCAN, because what was wrong was ARRANGEMENT: every control here
// already worked, and the reported defect was that unrelated concerns were
// stacked in one column with the two destructive ones at the bottom of the
// same run as a text field. Nothing a unit test of a pure function can see,
// and there is no DOM harness for this editor.
//
// What these pin is the SEPARATION, not the styling: the order of the four
// concerns, the save owning sections 1–3, and the leaving controls sitting
// outside it. A future edit that folds them back together fails here.

const SRC = readFileSync(
  join(import.meta.dirname, "..", "app", "admin", "(protected)", "people", "[id]", "participation-editor.tsx"),
  "utf8",
);

/** Where each landmark sits in the file, so order can be asserted. */
const at = (needle: string) => {
  const i = SRC.indexOf(needle);
  expect(i, `landmark missing from the editor: ${needle}`).toBeGreaterThan(-1);
  return i;
};

describe("the four concerns are separated, and in order", () => {
  it("renders What they pay → What that comes to → Beyond the plan → Leaving the cycle", () => {
    const pay = at('title="What they pay"');
    const comes = at('title="What that comes to"');
    const beyond = at('title="Beyond the plan"');
    const leaving = at('title="Leaving the cycle"');
    expect(pay).toBeLessThan(comes);
    expect(comes).toBeLessThan(beyond);
    expect(beyond).toBeLessThan(leaving);
  });

  it("lucky numbers remain their own section, after the rest", () => {
    // The heading itself, not the earlier prose that mentions it.
    expect(at(">Lucky numbers</h2>")).toBeGreaterThan(at('title="Leaving the cycle"'));
  });

  it("the inputs and their consequences are one grid, two columns on wide", () => {
    expect(SRC).toContain('className="grid gap-6 lg:grid-cols-2 lg:items-start"');
  });
});

describe("the editing fields sit in section 1", () => {
  it("weekly amount, start week, weeks committed and finish-with-group are all above the consequences", () => {
    const comes = at('title="What that comes to"');
    for (const field of [
      'ariaLabel="Weekly amount in dollars"',
      'ariaLabel="Start week"',
      'ariaLabel="Weeks committed"',
      'data-testid="finish-with-group-label"',
    ]) {
      expect(at(field), `${field} must sit in "What they pay"`).toBeLessThan(comes);
    }
  });

  it("the finish banner and the fee card are the consequences, not the inputs", () => {
    const comes = at('title="What that comes to"');
    const beyond = at('title="Beyond the plan"');
    for (const derived of ['data-testid="finish-preview"', "<FeeCalculator"]) {
      const i = at(derived);
      expect(i, `${derived} belongs in the companion panel`).toBeGreaterThan(comes);
      expect(i).toBeLessThan(beyond);
    }
  });
});

describe("the save closes sections 1–3, and the danger area is outside it", () => {
  it("the 2.22 override sits WITH the save, because the save writes it", () => {
    const beyond = at('title="Beyond the plan"');
    const override = at("checked={extend}");
    const save = at('label="Save participation"');
    expect(override).toBeGreaterThan(beyond);
    expect(save).toBeGreaterThan(override);
  });

  it("Save comes BEFORE the leaving controls, and they are in a later block", () => {
    const save = at('label="Save participation"');
    const leaving = at('title="Leaving the cycle"');
    expect(save).toBeLessThan(leaving);
    expect(at("<CloseParticipation")).toBeGreaterThan(leaving);
    expect(at("<RemoveFromCycle")).toBeGreaterThan(leaving);
  });

  it("the leaving controls carry the danger treatment, the save area does not", () => {
    const leavingBlock = SRC.slice(at('title="Leaving the cycle"') - 400, at("<RemoveFromCycle"));
    expect(leavingBlock).toMatch(/border-red-200/);
    expect(leavingBlock).toMatch(/dark:border-red-900/);
  });
});

describe("nothing behavioural moved", () => {
  it("every control the section had is still present, once", () => {
    for (const control of [
      "<FeeCalculator",
      "<CloseParticipation",
      "<RemoveFromCycle",
      'label="Save participation"',
      "onSave={saveParticipation}",
    ]) {
      expect(SRC.split(control).length - 1, `${control} appears the wrong number of times`).toBe(1);
    }
  });

  it("the save is still gated on the same dirty state and hint", () => {
    expect(SRC).toContain("dirty={participationDirty}");
    expect(SRC).toContain(
      'notDirtyHint="Nothing has changed — the weekly amount, start week and weeks committed all match what is saved."',
    );
  });

  it("the removal outcome still renders beside the controls that trigger it", () => {
    const leaving = at('title="Leaving the cycle"');
    expect(SRC.indexOf('feedbackFor("remove")')).toBeGreaterThan(leaving);
  });
});
