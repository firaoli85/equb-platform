import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// A STICKY SURFACE HAS TO BE OPAQUE TO WHAT PASSES UNDER IT.
//
// Found during the craft pass: `Th` — the shared table header used by every
// admin table — was `sticky top-0` with `bg-gray-50/80` in light and
// `bg-white/[0.03]` in dark, and no blur. Rows scrolled visibly THROUGH the
// column headings: at 20% in light, at essentially full strength in dark.
// Numbers ghosting through a heading is the one place on a money screen where
// a reader cannot tell which row they are looking at, and it passed every
// check that existed because nothing was broken — it was only wrong.
//
// The rule that prevents the next one: anything pinned over scrolling content
// is either fully opaque, or translucent WITH a backdrop blur and an opaque
// base underneath for browsers that lack backdrop-filter.

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

/** Every className string in the file, one per match. */
function classLists(src: string): string[] {
  const out: string[] = [];
  // Both the plain attribute and the template-literal form.
  for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
    out.push(m[1] ?? m[2] ?? "");
  }
  return out;
}

const PINNED = /\b(sticky|fixed)\b/;
const BLURRED = /\bbackdrop-blur/;

/**
 * A SCRIM IS NOT A SURFACE. `fixed inset-0 bg-black/50` behind a dialog is
 * translucent on purpose — showing the dimmed page through it is the entire
 * job. Flagging it was the guard's first false positive.
 */
const SCRIM = /\binset-0\b/;

/**
 * The alpha of the least-opaque BACKGROUND on this element, or null when
 * every background is opaque.
 *
 * Only the base and its `dark:` partner count. A `hover:bg-gray-500/10` tint
 * on an icon button is not the surface — that was the guard's second false
 * positive, on a floating back button that has no background at rest.
 */
function weakestBackground(cls: string): number | null {
  let weakest: number | null = null;
  for (const token of cls.split(/\s+/)) {
    const bare = token.startsWith("dark:") ? token.slice(5) : token;
    if (bare !== token && token.startsWith("dark:") === false) continue;
    if (/^(hover|focus|active|group-|peer-|supports-)/.test(token)) continue;
    const m = /^bg-(?:\[[^\]]+\]|[a-z]+(?:-\d+)?)\/(\d+)$/.exec(bare);
    if (!m) continue;
    const alpha = Number(m[1]);
    if (weakest === null || alpha < weakest) weakest = alpha;
  }
  return weakest;
}

/**
 * How opaque a pinned surface must be when it has NO blur behind it.
 *
 * 90 rather than 100 because a hair of translucency reads as depth and costs
 * nothing legible. The defect this guard was written for was 80% in light and
 * 3% in dark — an order of magnitude past that line, not a hair over it.
 */
const OPAQUE_ENOUGH = 90;

const FILES = ROOTS.flatMap((r) => tsxFiles(join(process.cwd(), r))).map((f) => ({
  path: relative(process.cwd(), f).replace(/\\/g, "/"),
  src: readFileSync(f, "utf8"),
}));

describe("anything pinned over scrolling content stays readable", () => {
  it("finds real files to check", () => {
    // Without this the rule below passes on an empty list.
    expect(FILES.length).toBeGreaterThan(30);
  });

  it("never leaves a sticky or fixed surface see-through without a blur", () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      for (const cls of classLists(file.src)) {
        if (!PINNED.test(cls)) continue;
        if (SCRIM.test(cls)) continue; // a dialog backdrop is meant to show through
        if (BLURRED.test(cls)) continue; // translucent + blur is the intended treatment
        const alpha = weakestBackground(cls);
        if (alpha === null || alpha >= OPAQUE_ENOUGH) continue;
        offenders.push(`${file.path}\n    (${alpha}% opaque) ${cls.trim().slice(0, 140)}`);
      }
    }
    expect(
      offenders,
      "These surfaces are pinned over scrolling content, see-through, and unblurred, so " +
        "the rows underneath show through them. Make them opaque, or add a backdrop blur:\n  " +
        offenders.join("\n  "),
    ).toEqual([]);
  });

  it("still catches the defect it was written for", () => {
    // Non-vacuous by construction: the guard must fail on the exact class list
    // `Th` carried before the craft pass. Without this, loosening the rule to
    // silence a false positive could quietly loosen it past the real thing.
    const before = "sticky top-0 z-10 border-b bg-gray-50/80 dark:bg-white/[0.03] px-4";
    expect(PINNED.test(before)).toBe(true);
    expect(BLURRED.test(before)).toBe(false);
    expect(SCRIM.test(before)).toBe(false);
    expect(weakestBackground(before)).toBeLessThan(OPAQUE_ENOUGH);
  });

  it("does not fire on a dialog scrim or a hover tint", () => {
    // The two false positives that forced the rule to be sharpened. A scrim
    // showing the page through it is the point; a hover tint on a floating
    // button is not a surface at all.
    expect(SCRIM.test("fixed inset-0 z-[100] bg-black/50")).toBe(true);
    expect(weakestBackground("fixed left-4 top-4 rounded-full hover:bg-gray-500/10")).toBeNull();
  });
});
