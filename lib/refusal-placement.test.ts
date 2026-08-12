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
  it("no confirm helper closes the dialog from a finally block", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/finally\s*\{[\s\S]{0,240}?\}/g)) {
        if (/setConfirm\(null\)/.test(m[0])) {
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

    const closesInFinally = `        } finally {\n          setBusy(false);\n          setConfirm(null);\n        }`;
    expect(/finally\s*\{[\s\S]{0,240}?\}/.exec(closesInFinally)?.[0]).toMatch(/setConfirm\(null\)/);

    const thrownAway = `        await recordCarryDecision({ personId, choice });`;
    expect(/^\s*await\s+(?!Promise|prisma|tx)[a-z][A-Za-z0-9_]*\(\s*\{/.test(thrownAway)).toBe(true);

    // And it must NOT fire on the corrected form.
    const kept = `        const decision = await recordCarryDecision({ personId, choice });`;
    expect(/^\s*await\s+(?!Promise|prisma|tx)[a-z][A-Za-z0-9_]*\(\s*\{/.test(kept)).toBe(false);
  });
});
