import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A SOURCE-SCANNING GUARD for the D-42 migration (phase 3), in the shape
// lib/week-date-authority.test.ts established.
//
// The migration rule is per-NUMBER, not per-screen: every surface showing
// "what this member owes" or "how far behind they are" had to move to the D-42
// reading in ONE commit, because a deferred member seeing two screens disagree
// is exactly the defect the engine exists to remove.
//
// That rule only holds while there is no THIRD implementation. This file is
// what stops one appearing: it pins the complete list of callers of the two
// primitives that decide deferral, so a future site that computes owed-or-
// behind for itself fails here instead of quietly disagreeing on a screen.

const ROOT = join(import.meta.dirname, "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    if (entry === "node_modules" || entry === "generated" || entry.startsWith(".")) continue;
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(rel);
  }
  return out;
}

const FILES = ["app", "lib", "components"].flatMap(sourceFiles);

/** Files that CALL the given function (not merely mention or export it). */
function callersOf(fn: string): string[] {
  const call = new RegExp(`(?<!function )\\b${fn}\\(`);
  return FILES.filter((f) => {
    if (f === "lib/derived.ts") return false; // where it is defined
    return call.test(readFileSync(join(ROOT, f), "utf8"));
  }).sort();
}

describe("GUARD — deferral has exactly one authority (D-42, §2.29a)", () => {
  it("weekCountsAsDue is called from computeStanding and nowhere else", () => {
    // The one place that decides whether a week is in the CURRENT expectation.
    // A second caller would be a second answer to "is this owed now?".
    expect(callersOf("weekCountsAsDue")).toEqual(["lib/standing.ts"]);
  });

  it("amountOutstanding is called from the nucleus and the attention list only", () => {
    // Both were migrated together in the D-42 commit. A third caller appearing
    // is the moment two screens can start disagreeing again.
    expect(callersOf("amountOutstanding")).toEqual(["lib/dashboard.ts", "lib/standing.ts"]);
  });

  it("amountDeferred is called only where a paused week's money is accounted for", () => {
    expect(callersOf("amountDeferred")).toEqual(["lib/standing.ts"]);
  });

  it("the engine does not re-derive what the nucleus now answers", () => {
    // Phase 2 computed these in the engine because the nucleus still held the
    // old rule. Phase 3 moved the rule into the nucleus, so a second derivation
    // here would be §5.10 all over again — two functions, one question.
    const engine = readFileSync(join(ROOT, "lib/engine.ts"), "utf8");
    expect(engine).toContain("const amountOutstanding = standing.amountOutstanding;");
    expect(engine).toContain("const amountDeferred = standing.amountDeferred;");
    expect(engine).toContain("const behind = standing.weeksBehind;");
  });
});

describe("GUARD — a paused week's money cannot be forgiven at close (rule 4)", () => {
  // §2.29a gives a deferred week exactly two endings: filled, or CARRIED into
  // the person's balance at close. `amountOutstanding` deliberately stops at
  // what is owed right now, so any path writing a CLOSING figure has to add
  // `amountDeferred` — otherwise closing the cycle silently forgives it, which
  // is the one thing deferral never does.
  const CLOSING_PATHS = [
    "app/actions/cycle-close.ts",
    "app/actions/participation-close.ts",
  ];

  for (const path of CLOSING_PATHS) {
    it(`${path} carries the deferred amount into the closing figure`, () => {
      const source = readFileSync(join(ROOT, path), "utf8");
      expect(source).toMatch(
        /standing\.amountOutstanding \+ standing\.amountDeferred/,
        // If this fails because the expression was refactored, do not just
        // widen the regex: check first that the closing figure still INCLUDES
        // the paused money. That is the assertion; the shape is the evidence.
      );
    });
  }

  it("no closing path writes amountOutstanding alone", () => {
    for (const path of CLOSING_PATHS) {
      const source = readFileSync(join(ROOT, path), "utf8");
      // Every mention of the figure in these two files must be the sum.
      const mentions = [...source.matchAll(/standing\.amountOutstanding(?! \+ standing\.amountDeferred)/g)];
      expect(mentions, `${path} uses the owed-now figure where the closing figure belongs`).toEqual([]);
    }
  });
});
