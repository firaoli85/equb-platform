import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// THE MOTION PASS, held in place.
//
// Motion on this product is deliberately quiet: things fade up on arrival,
// buttons compress under a press, the member's savings ring draws itself in
// once. What makes it feel considered rather than busy is the discipline
// underneath, and discipline is exactly what rots first — one `transition-all`
// added in a hurry animates layout properties on every class flip and the
// whole screen starts to feel loose.
//
// So the three rules that cannot be re-derived by reading a diff are pinned
// here.

const ROOTS = ["app", "components"];
const CSS = "app/globals.css";

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === "generated") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) tsxFiles(full, out);
    else if (entry.endsWith(".tsx") && !entry.endsWith(".test.tsx")) out.push(full);
  }
  return out;
}

/**
 * Source with line comments stripped.
 *
 * The first version of this guard flagged its own explanation: a comment
 * saying "never use transition-all" contains the token it forbids. A guard
 * that fails on its own documentation is a guard somebody deletes, so the
 * prose is removed before the code is judged.
 */
function code(src: string): string {
  return src.replace(/^\s*\/\/.*$/gm, "");
}

const FILES = ROOTS.flatMap((r) => tsxFiles(join(process.cwd(), r))).map((f) => {
  const src = readFileSync(f, "utf8");
  return {
    path: relative(process.cwd(), f).replace(/\\/g, "/"),
    src,
    code: code(src),
  };
});

describe("motion is scoped, not sprayed", () => {
  it("finds real files to check", () => {
    // Without this the three tests below all pass on an empty list.
    expect(FILES.length).toBeGreaterThan(30);
  });

  it("never uses transition-all", () => {
    // `all` animates every computed property a class flip touches, including
    // layout ones, which is how a 150ms hover becomes a reflow.
    const offenders = FILES.filter((f) => /\btransition-all\b/.test(f.code)).map((f) => f.path);
    expect(
      offenders,
      "Name the properties that change instead — transition-[background-color,transform].\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("never uses will-change: all", () => {
    const offenders = FILES.filter((f) => /will-change[:-]\s*\[?all/.test(f.code)).map(
      (f) => f.path,
    );
    expect(offenders).toEqual([]);
  });

  it("keeps animation out of inline styles, where reduced-motion cannot reach it", () => {
    // globals.css switches the custom animations off BY CLASS NAME inside a
    // prefers-reduced-motion block, so an inline animation is invisible to
    // that block — UNLESS the component consults the media query itself,
    // which week-stamp-list does because its sweep is driven from JavaScript
    // and has no class to switch off. The rule is therefore that an inline
    // animation must carry its OWN answer to reduced motion, not that it is
    // forbidden outright. Stating it as an absolute would have forced a real,
    // correctly-guarded animation to be rewritten for the guard's convenience.
    const offenders = FILES.filter(
      (f) =>
        /style=\{\{[^}]*\banimation\b/.test(f.code) &&
        !/reducedMotion|useReducedMotion|prefers-reduced-motion/.test(f.code),
    ).map((f) => f.path);
    expect(
      offenders,
      "Use a class from globals.css so the reduced-motion block can switch it off.\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });
});

describe("every custom animation has a reduced-motion answer", () => {
  const css = readFileSync(join(process.cwd(), CSS), "utf8");
  const reduceBlock = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));

  it("declares the block at all", () => {
    expect(reduceBlock.length).toBeGreaterThan(0);
  });

  it("switches off every animate-* utility the stylesheet defines", () => {
    // A new keyframe with a new utility class is the easy thing to add and the
    // easy thing to forget. This finds it the same day.
    const declared = [...css.matchAll(/^\.(animate-[a-z0-9-]+)\s*\{/gm)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(4);
    const missing = declared.filter((cls) => !reduceBlock.includes(`.${cls},`) && !reduceBlock.includes(`.${cls} `));
    expect(
      missing,
      `These animation utilities play even when the reader has asked for less motion: ${missing.join(", ")}`,
    ).toEqual([]);
  });
});
