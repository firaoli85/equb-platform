import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// GUARD — A REFUSAL APPEARS AT THE CONTROL THAT WAS PRESSED (UI_STANDARDS 6b).
//
// Rule 6 beat 4 has always said "positioned at the control". It was a clause
// inside a four-beat list, and an audit of every admin surface found FIFTEEN
// controls ignoring it: the refusal went into a page-level banner, the dialog
// closed in a `finally`, and the organizer saw nothing change. "It did not
// save" then gets reported with no error to quote, and debugging starts from
// the false premise that the message was missing. It never was.
//
// Two mechanical shapes are checkable in source, and both were real:
//
//   1. A ConfirmDialog rendered with no `error` prop — so a refusal from the
//      action it just ran has nowhere to land inside it.
//   2. A server action result discarded entirely (`await someAction(...)` as a
//      bare statement), which renders success over a refusal.
//
// The third shape — "the banner is 400 lines above the button" — is a judgement
// about layout that no scan can make. That one is the manual audit, and its
// findings are listed in UI_STANDARDS 6b.

const ROOT = join(import.meta.dirname, "..");
const SURFACES = [join(ROOT, "app", "admin"), join(ROOT, "components", "admin")];

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (entry.endsWith(".tsx") && !entry.endsWith(".test.tsx")) out.push(full);
  }
  return out;
}

const files = SURFACES.flatMap(tsxFiles);
const rel = (f: string) => relative(ROOT, f).replace(/\\/g, "/");

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

/**
 * The same code with every conditional branch removed.
 *
 * What is left runs UNCONDITIONALLY, which is the only thing this guard cares
 * about: `if (refused === null) setConfirm(null)` is the correct shape and a
 * bare `setConfirm(null)` is the bug.
 *
 * BOTH BODY SHAPES, because the codebase writes both. Requiring a brace after
 * the condition reported close-flow's two braceless
 * `if (refused === null) setConfirm(null); else setDialogError(refused);`
 * as defects — correct code, flagged for its punctuation.
 */
function stripConditionals(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const head = /^\s*(?:\}\s*)?(?:else\s+if|if|else)\b\s*(?:\([^)]*\))?\s*/.exec(source.slice(i));
    if (head) {
      let j = i + head[0].length;
      if (source[j] === "{") {
        // Braced: skip to the matching close.
        let depth = 1;
        j++;
        while (j < source.length && depth > 0) {
          if (source[j] === "{") depth++;
          else if (source[j] === "}") depth--;
          j++;
        }
      } else {
        // Braceless: the branch is one statement, ending at the next `;`.
        while (j < source.length && source[j] !== ";") j++;
        j++;
      }
      i = j;
      continue;
    }
    out += source[i];
    i++;
  }
  return out;
}

describe("GUARD — every ConfirmDialog can show its own refusal", () => {
  it("scans a real set of admin files", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  // THE FIX, PINNED. A dialog without an `error` prop can only report through
  // something else on the page.
  it("every <ConfirmDialog> is given an error slot", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      // Each <ConfirmDialog ...> element, up to its closing bracket.
      for (const m of src.matchAll(/<ConfirmDialog\b[\s\S]*?\/>/g)) {
        if (!/\berror=\{/.test(m[0])) {
          const line = src.slice(0, m.index).split("\n").length;
          offenders.push(`${rel(f)}:${line}`);
        }
      }
    }
    expect(
      offenders,
      `ConfirmDialog with no error slot — a refusal has nowhere to go: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  // The dialog must not close on failure, or the slot above is never seen.
  // A `finally` that closes runs on both paths, which is exactly what every
  // one of these helpers used to do.
  //
  // THE FIRST VERSION MEASURED THE WRONG THING. It matched `finally { … }`
  // with a lazy 240-character window and flagged any `setConfirm(null)` inside
  // it. That is a proxy for the real property, and the proxy broke the moment
  // a correct file got SHORTER: deleting one `setBusy(false)` line from
  // cycle-edit-form pulled a correctly-guarded `setConfirm(null)` inside the
  // window, and a guard that fires on a valid fix is a guard that gets
  // deleted. Worse, it also passed for the wrong reason — person-edit-form was
  // only clean because its comment was long enough to push the call past 240.
  //
  // The property is UNCONDITIONAL closing, so that is what this reads now:
  // brace-match the finally body, remove every conditional block inside it,
  // and flag a close that survives — one that runs on both paths.
  //
  // AND IT MISSED HALF THE LANGUAGE. `/finally\s*\{/` matches the STATEMENT
  // form and not the PROMISE form — `.finally(() => { setConfirm(null) })` —
  // which is the same bug written with different punctuation. Two files
  // escaped on exactly that: participation-editor's `ask` helper does
  // `void run(label, fn).finally(() => { setConfirm(null) })`, so every
  // refusal from six destructive dialogs closed the dialog it could have been
  // shown in. A guard that reads one spelling of a construct is a guard that
  // reports the codebase as clean because of a punctuation mark.
  it("no confirm helper closes the dialog unconditionally in a finally", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      // Both spellings: `finally {` and `.finally(() => {` / `.finally(async () => {`.
      for (const m of src.matchAll(/(?:\.finally\(\s*(?:async\s*)?\([^)]*\)\s*=>\s*|finally\s*)\{/g)) {
        const body = braceBody(src, m.index + m[0].length);
        if (/setConfirm\(null\)/.test(stripConditionals(body))) {
          const line = src.slice(0, m.index).split("\n").length;
          offenders.push(`${rel(f)}:${line}`);
        }
      }
    }
    expect(
      offenders,
      `the dialog closes whatever happened, so a refusal is thrown away: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  // THE WORST SHAPE: the result is never looked at, and success renders over
  // a refusal. This is what add-member-wizard.tsx did with recordCarryDecision.
  it("no server-action result is discarded", () => {
    // A bare `await someAction({...});` statement — not assigned, not returned,
    // not awaited into a condition.
    const discarded = /^\s*await\s+(?!Promise|prisma|tx)[a-z][A-Za-z0-9_]*\(\s*\{/;
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const [i, line] of src.split("\n").entries()) {
        if (discarded.test(line)) offenders.push(`${rel(f)}:${i + 1} → ${line.trim().slice(0, 70)}`);
      }
    }
    expect(
      offenders,
      `result discarded — success can render over a refusal: ${offenders.join(" | ")}`,
    ).toEqual([]);
  });

  // NON-VACUITY. Each pattern must fire on the shape it forbids.
  it("the scan is not vacuous", () => {
    const noSlot = `      <ConfirmDialog\n        spec={confirm}\n        busy={busy}\n      />`;
    expect(/\berror=\{/.test(noSlot)).toBe(false);

    // The bug: closed on both paths.
    const closesInFinally = `finally {\n  setBusy(false);\n  setConfirm(null);\n}`;
    expect(
      /setConfirm\(null\)/.test(
        stripConditionals(braceBody(closesInFinally, closesInFinally.indexOf("{") + 1)),
      ),
    ).toBe(true);

    // The fix: closed only when nothing was refused. The old character-window
    // version flagged THIS, which is what sent it back to the drawing board.
    const closesOnlyOnSuccess = `finally {\n  if (refused === null) {\n    setConfirm(null);\n    setOnConfirm(null);\n  } else {\n    setDialogError(refused);\n  }\n}`;
    expect(
      /setConfirm\(null\)/.test(
        stripConditionals(braceBody(closesOnlyOnSuccess, closesOnlyOnSuccess.indexOf("{") + 1)),
      ),
    ).toBe(false);

    // The same fix written WITHOUT braces — the shape close-flow uses, and the
    // one the first rewrite reported as a defect.
    const braceless = `finally {\n  setBusy(false);\n  if (refused === null) setConfirm(null);\n  else setDialogError(refused);\n}`;
    expect(
      /setConfirm\(null\)/.test(
        stripConditionals(braceBody(braceless, braceless.indexOf("{") + 1)),
      ),
    ).toBe(false);

    // THE PROMISE FORM, which the first two versions of this scan could not
    // see at all. Both spellings must be recognised as the same construct.
    const finallyForms = /(?:\.finally\(\s*(?:async\s*)?\([^)]*\)\s*=>\s*|finally\s*)\{/g;
    const promiseForm = `      void run(label, fn).finally(() => {\n        setConfirm(null);\n      });`;
    const hit = [...promiseForm.matchAll(finallyForms)];
    expect(hit, "the promise form must be recognised").toHaveLength(1);
    expect(
      /setConfirm\(null\)/.test(
        stripConditionals(braceBody(promiseForm, hit[0].index + hit[0][0].length)),
      ),
    ).toBe(true);

    // …and the async promise form, and the statement form, both still match.
    expect([...`x.finally(async () => {`.matchAll(finallyForms)]).toHaveLength(1);
    expect([...`} finally {`.matchAll(finallyForms)]).toHaveLength(1);

    const thrownAway = `        await recordCarryDecision({ personId, choice });`;
    expect(/^\s*await\s+(?!Promise|prisma|tx)[a-z][A-Za-z0-9_]*\(\s*\{/.test(thrownAway)).toBe(true);

    // And it must NOT fire on the corrected form.
    const kept = `        const decision = await recordCarryDecision({ personId, choice });`;
    expect(/^\s*await\s+(?!Promise|prisma|tx)[a-z][A-Za-z0-9_]*\(\s*\{/.test(kept)).toBe(false);
  });
});
