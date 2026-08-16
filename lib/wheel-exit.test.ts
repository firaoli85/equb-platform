import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// GUARD — THE ONE WAY OFF THE DRAW SCREEN STAYS CLICKABLE.
//
// /admin/wheel lives OUTSIDE the (protected) group so §2.4 can keep the screen
// bare for the projector. That also means it has no rail and no bottom bar: the
// faint arrow at left-4 top-4 is the ONLY way back into the admin.
//
// It was dead for the life of one commit. 3713ba5 pinned the week picker to the
// top to stop it crowding the wheel — `absolute inset-x-0 top-0 z-20`, a
// full-viewport-width strip 66px deep sitting over an arrow at z-10 whose box
// ends at 60px. A transparent background still hit-tests, so the strip
// swallowed every click on the arrow. Confirmed at 390, 1440 and 1920:
// elementFromPoint at the arrow's centre returned the strip at every width.
//
// Nothing failed. The link was correct — a plain `href="/admin"`, never
// router.back() — and it compiled, rendered and looked right. Only geometry was
// wrong, which no render test and no type check can see.
//
// THE RULE THIS PINS is not "these two classes exist". It is: on this screen,
// anything positioned above the arrow must be click-through unless it is
// something you are meant to press. That is the rule the next overlay will need.

const ROOT = join(import.meta.dirname, "..");
const PAGE = readFileSync(join(ROOT, "app/admin/wheel/page.tsx"), "utf8");
const PICKER = readFileSync(join(ROOT, "app/admin/wheel/week-picker.tsx"), "utf8");

/** Every className string in a file, comments stripped so prose cannot pass. */
function classNames(source: string): string[] {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");
  return [...code.matchAll(/className="([^"]+)"/g)].map((m) => m[1]);
}

/** The arrow's own z-index, read from source rather than assumed. */
function arrowZ(): number {
  const cls = classNames(PAGE).find((c) => c.includes("fixed") && c.includes("top-4"));
  const z = cls?.match(/\bz-(\d+)\b/);
  return z ? Number(z[1]) : 0;
}

describe("the exit arrow", () => {
  it("is still there, and still a plain link to the admin", () => {
    // Not router.back(): the draw screen is opened by direct URL as often as
    // by a click, and back() with no history entry does nothing at all.
    expect(PAGE).toContain('aria-label="Back to the admin"');
    expect(PAGE).toMatch(/href="\/admin"/);
    expect(PAGE).not.toContain("router.back()");
  });

  it("is a 44px target", () => {
    const cls = classNames(PAGE).find((c) => c.includes("fixed") && c.includes("top-4"));
    expect(cls).toMatch(/\bh-11\b/);
    expect(cls).toMatch(/\bw-11\b/);
  });
});

describe("nothing on the draw screen may sit over the arrow and eat its clicks", () => {
  it("the arrow declares a z-index at all", () => {
    expect(arrowZ()).toBeGreaterThan(0);
  });

  it("every layer stacked above the arrow is click-through", () => {
    // THE regression, as a rule rather than as two class names. A positioned
    // element ranked above the arrow covers it wherever their boxes meet, and
    // a transparent background does not exempt it from hit testing.
    const floor = arrowZ();
    const offenders = classNames(PAGE).filter((c) => {
      const z = c.match(/\bz-(\d+)\b/);
      if (!z || Number(z[1]) <= floor) return false;
      if (!/\b(absolute|fixed)\b/.test(c)) return false;
      return !c.includes("pointer-events-none");
    });
    expect(
      offenders,
      `these sit above the exit arrow and would swallow its clicks:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("the week picker strip specifically", () => {
    const strip = classNames(PAGE).find((c) => c.includes("inset-x-0") && c.includes("top-0"));
    expect(strip, "the picker strip is gone or renamed").toBeDefined();
    expect(strip).toContain("pointer-events-none");
  });
});

describe("the control inside the strip still takes clicks", () => {
  it("the week picker takes them back", () => {
    // Click-through must not cost the organizer the one decision he makes at
    // the draw. The label re-enables pointer events for itself only.
    const label = classNames(PICKER).find((c) => c.includes("inline-flex"));
    expect(label, "the picker label is gone or renamed").toBeDefined();
    expect(label).toContain("pointer-events-auto");
  });

  it("and the select is inside that label", () => {
    // If the select ever moves out from under the pointer-events-auto, the
    // week becomes unchangeable mid-draw — silently.
    expect(PICKER.indexOf("<label")).toBeLessThan(PICKER.indexOf("<select"));
    expect(PICKER).toContain("</label>");
  });
});
