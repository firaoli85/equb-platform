import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// WHAT A NUMBER SAYS IS NEVER DECIDED BY AN ANIMATION.
//
// Two components counted their figures up from zero on mount and held zero as
// their INITIAL state, so the server rendered zero:
//
//   · every StatCard — the dashboard's cash position, all three cash tabs and
//     every money drill-down shipped "$0" in their HTML
//   · the member's own summary — "0 of 20 weeks paid", 0%, on the one screen a
//     non-technical member reads alone
//
// Both flashed to the truth when the bundle hydrated, and both stayed wrong
// for good on a slow phone or with scripting off. Nothing errored, nothing was
// logged, and no test caught it, because every test rendered the real number
// after mount.
//
// The rule: a count-up is an OVERLAY on a figure that is already correct.
// State that drives a displayed figure starts at `null` — meaning "not
// animating" — and the render falls back to the true value.

const ROOTS = ["app", "components"];

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === "generated") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) tsxFiles(full, out);
    else if (entry.endsWith(".tsx") && !entry.endsWith(".test.tsx")) out.push(full);
  }
  return out;
}

const FILES = ROOTS.flatMap((r) => tsxFiles(join(process.cwd(), r))).map((f) => ({
  path: relative(process.cwd(), f).replace(/\\/g, "/"),
  src: readFileSync(f, "utf8"),
}));

/** Files that animate a number with `animate(from, to, …)`. */
const COUNTING = FILES.filter((f) => /\banimate\(\s*0\s*,/.test(f.src));

describe("a counted-up figure is correct before it animates", () => {
  it("finds the count-up components", () => {
    // Without this, every rule below passes on an empty list.
    expect(COUNTING.length).toBeGreaterThan(0);
  });

  it("never seeds display state with a hard zero", () => {
    // `useState(0)` for a value that is rendered IS the defect. `null` means
    // "not animating" and lets the render fall through to the real figure.
    const offenders: string[] = [];
    for (const file of COUNTING) {
      for (const m of file.src.matchAll(/const \[(\w*[Dd]isplay\w*)[^\]]*\] = useState[^(]*\(0\)/g)) {
        offenders.push(`${file.path} — ${m[1]} starts at 0, so the server renders 0`);
      }
    }
    expect(
      offenders,
      "Seed with null and render `value ?? truth`:\n  " + offenders.join("\n  "),
    ).toEqual([]);
  });

  it("lands on the exact stored value when the animation ends", () => {
    // Easing arithmetic can finish a hair short. A cash position reading
    // $12,499 instead of $12,500 because of a rounding error inside a
    // decoration is not a figure anyone should be asked to trust.
    const offenders = COUNTING.filter((f) => !f.src.includes("onComplete")).map((f) => f.path);
    expect(
      offenders,
      "Add onComplete to set the exact figure:\n  " + offenders.join("\n  "),
    ).toEqual([]);
  });

  it("gives every count-up a reduced-motion path", () => {
    const offenders = COUNTING.filter((f) => !/useReducedMotion|reduce/.test(f.src)).map(
      (f) => f.path,
    );
    expect(offenders).toEqual([]);
  });

  it("keeps every counting figure tabular", () => {
    // A number whose digits change width jitters as it counts, which reads as
    // a glitch rather than as motion.
    const offenders = COUNTING.filter((f) => !f.src.includes("tabular-nums")).map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});
