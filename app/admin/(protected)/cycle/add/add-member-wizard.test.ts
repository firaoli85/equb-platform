import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// THE WIZARD'S SAVE FEEDBACK BELONGS TO THE BUTTON (UI_STANDARDS 6 / 6b).
//
// This step is the write: a participation, its lucky numbers, and the
// carried-balance decision. Two of the audit's findings were in this file —
// the refusal printed above the summary instead of at the control, and
// `recordCarryDecision`'s result discarded entirely, so the green "✓ Saved"
// rendered over it.
//
// It cannot be asserted on rendered HTML the way save-button.test.tsx is: the
// Save button lives on step 4 and `renderToStaticMarkup` cannot press
// "Continue" three times. So it is asserted on the SOURCE, in the shape
// lib/refusal-placement.test.ts uses — and with the same non-vacuity block,
// because a scan that cannot fail is not a guard.

const src = readFileSync(join(import.meta.dirname, "add-member-wizard.tsx"), "utf8");

/** The text of a block, given the index just past its opening brace. */
function braceBody(source: string, start: number): string {
  let depth = 1;
  let i = start;
  while (i < source.length && depth > 0) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") depth--;
    i++;
  }
  return source.slice(start, i - 1);
}

function handleSaveBody(source: string): string {
  const at = source.indexOf("async function handleSave");
  if (at < 0) throw new Error("handleSave has been renamed — this guard reads it by name");
  return braceBody(source, source.indexOf("{", at) + 1);
}

/**
 * Every `return` PAST THE POINT OF NO RETURN must say how the save ended.
 *
 * The old code leaned on `finally { setSaving(false) }` to undo the working
 * state whatever happened — which is also what let a refusal be overwritten by
 * the reset that ran after it. One state replaced both, and the cost of that
 * is this: an early `return` that forgets to settle it leaves the button
 * reading "Saving…" for ever, with no message and nothing to press.
 *
 * Only the part after the state is entered is read, so the cheap validity
 * guard at the top of the function is not credited for someone else's call.
 *
 * The settle must be the statement IMMEDIATELY before the return, not merely
 * somewhere nearby: a character window that big is satisfied by the OTHER
 * branch's settle, which is how a guard passes over the exact bug it is for.
 */
function unsettledReturns(body: string): string[] {
  const enters = body.indexOf('setSave({ kind: "saving" })');
  if (enters < 0) throw new Error("the save no longer enters a saving state");
  const after = body.slice(enters + 1);
  const out: string[] = [];
  for (const m of after.matchAll(/\breturn\s*;/g)) {
    const lines = after.slice(0, m.index).split("\n");
    let i = lines.length - 1;
    while (i >= 0 && (lines[i].trim() === "" || lines[i].trim().startsWith("//"))) i--;
    const previous = i >= 0 ? lines[i].trim() : "";
    // `});` is the tail of a settle written across several lines.
    if (!previous.includes("setSave(") && previous !== "});") out.push(`${previous} → return;`);
  }
  return out;
}

describe("the add-member wizard reports its save AT the control", () => {
  it("reads the wizard, not a stale copy", () => {
    expect(src).toContain("export function AddMemberWizard");
  });

  // Beat 4: the reason renders beside the button that was pressed, and
  // `SaveButton` is the only thing in this file that can render it.
  it("saves through <SaveButton>, fed the one save state", () => {
    const el = /<SaveButton\b[\s\S]*?\/>/.exec(src);
    expect(el, "step 4's Save is a hand-rolled button again").not.toBeNull();
    expect(el![0]).toContain("state={save}");
    expect(el![0]).toContain("onSave={");
  });

  // The shape rule 6 exists to kill: the refusal printed as its own paragraph
  // further up the step, where the organizer is not looking.
  it("keeps no page-level refusal paragraph of its own", () => {
    expect(src).not.toMatch(/Not saved: \{/);
    expect(src, "a second store for the same fact").not.toMatch(/\bsetError\b|\bsetSaving\b/);
  });

  // Two booleans for one condition drift apart; this one is read, never kept.
  it("derives 'working' from the save state instead of storing it twice", () => {
    expect(src).toContain('const busy = save.kind === "saving"');
  });

  it("leaves no path that strands the button on Saving…", () => {
    expect(unsettledReturns(handleSaveBody(src))).toEqual([]);
  });

  // THE ORIGINAL DEFECT, PINNED: the carried-balance decision's result is
  // looked at, and its refusal reaches the screen instead of being dropped
  // under a green tick.
  it("carries a refused carried-balance decision onto the success screen", () => {
    expect(src).toContain("decision.ok ? null : decision.error");
    expect(src).toMatch(/carryWarning !== null && \(\s*<p\s+role="alert"/);
  });

  // NON-VACUITY — each check must fire on the shape it forbids.
  it("the scan is not vacuous", () => {
    const stranded = `
      setSave({ kind: "saving" });
      const result = await addToCycle({});
      if (!result.ok) {
        setConflict(result.conflict);
        return;
      }`;
    expect(unsettledReturns(stranded)).toHaveLength(1);

    const settled = `
      setSave({ kind: "saving" });
      const result = await addToCycle({});
      if (!result.ok) {
        setSave({ kind: "err", message: result.error });
        return;
      }`;
    expect(unsettledReturns(settled)).toEqual([]);

    expect(/Not saved: \{/.test(`<p role="alert">Not saved: {error}</p>`)).toBe(true);
    expect(/<SaveButton\b[\s\S]*?\/>/.test(`<button disabled={saving}>Save</button>`)).toBe(false);
  });
});
