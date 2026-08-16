import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_NAV_LINKS, NAV_GROUPS, navIsActive, navLink } from "../components/admin/admin-sidebar";
import { FIELD_TAB_HREFS } from "../components/admin/admin-tab-bar";

// GUARD — THE ADMIN MUST BE NAVIGABLE ON A PHONE.
//
// The rail is `hidden md:flex`. For the whole life of the admin shell there was
// nothing under 768px in its place, so all nineteen destinations were
// `display: none` and the mobile header carried a title, a screen-share switch
// and an account menu — no nav at all. The organizer signed in on his phone,
// landed on the dashboard and could not leave it. He works outside and records
// payments from that phone, so the one thing the product exists to do could not
// be done where he does it.
//
// Nothing failed. Every page compiled, every route existed, every test passed:
// the failure was an ABSENCE, and only a source scan sees an absence. This file
// is the one that would have caught it.

const ROOT = join(import.meta.dirname, "..");

/**
 * The file with its comments taken out.
 *
 * SCAN THE CODE, NOT THE PROSE. The first version of the padding check below
 * passed against a layout with the padding REMOVED, because the comment
 * explaining the padding named the member portal's `pb-24` and the regex found
 * that. A guard that a comment can satisfy is a guard that reports on the
 * documentation. Comments in this codebase sit on their own lines, so dropping
 * whole comment lines is enough and leaves `https://` alone.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");
}

const TAB_BAR = code(readFileSync(join(ROOT, "components/admin/admin-tab-bar.tsx"), "utf8"));
const SIDEBAR = code(readFileSync(join(ROOT, "components/admin/admin-sidebar.tsx"), "utf8"));
const LAYOUT = code(readFileSync(join(ROOT, "app/admin/(protected)/layout.tsx"), "utf8"));

describe("the admin shell has a mobile half at all", () => {
  it("the rail is still desktop-only — this is the condition that needs answering", () => {
    expect(LAYOUT).toMatch(/hidden[^"]*md:flex/);
  });

  it("something navigable renders below md", () => {
    // THE regression, pinned. Not "a header exists" — a NAV.
    expect(LAYOUT).toContain("<AdminTabBar");
    expect(TAB_BAR).toContain("md:hidden");
    expect(TAB_BAR).toContain('aria-label="Admin sections"');
  });

  it("the content column clears the bar", () => {
    // Without the bottom padding the last row of every page — which on
    // /admin/payments is the button that records the money — sits under the
    // bar and cannot be tapped.
    expect(LAYOUT).toMatch(/pb-2[4-9]/);
  });

  it("every rail destination is reachable below md, through the drawer", () => {
    // The bar carries four. The other fifteen are only reachable because the
    // drawer renders the rail itself.
    expect(TAB_BAR).toContain("<AdminSidebar");
    expect(ALL_NAV_LINKS.length).toBeGreaterThan(FIELD_TAB_HREFS.length);
  });
});

describe("one source of truth for the nav (UI_STANDARDS rule 3)", () => {
  it("the bar keeps no list of its own destinations", () => {
    // The member portal's two bars once each kept their own list, and showed
    // different halves of the same six destinations. This is that guard.
    expect(TAB_BAR.match(/label:\s*["']/g) ?? []).toEqual([]);
    expect(TAB_BAR).toContain("navLink");
  });

  it("every tab is a route the rail already carries", () => {
    for (const href of FIELD_TAB_HREFS) {
      expect(() => navLink(href), `${href} is not in NAV_GROUPS`).not.toThrow();
    }
  });

  it("a route outside the rail is refused, loudly", () => {
    expect(() => navLink("/admin/not-a-page")).toThrow();
  });

  it("both bars render the same icon component", () => {
    expect(TAB_BAR).toContain("NavIcon");
    expect(SIDEBAR).toContain("NavIcon");
  });
});

describe("the bar is the FIELD, in the order the field needs", () => {
  it("Payments is first — recording money is why this exists", () => {
    expect(FIELD_TAB_HREFS[0]).toBe("/admin/payments");
  });

  it("has at most five items including More", () => {
    // Past five, a bottom nav on a 390px phone stops being navigable.
    expect(FIELD_TAB_HREFS.length + 1).toBeLessThanOrEqual(5);
  });

  it("every label is short enough for a five-up bar", () => {
    for (const href of FIELD_TAB_HREFS) {
      const label = navLink(href).label;
      expect(label.trim().length, href).toBeGreaterThan(0);
      expect(label.length, `"${label}" is too long for a tab`).toBeLessThanOrEqual(12);
    }
  });

  it("no destination is listed twice", () => {
    expect(new Set(FIELD_TAB_HREFS).size).toBe(FIELD_TAB_HREFS.length);
  });
});

describe("exactly one thing is current, on every admin route", () => {
  // "More" is current whenever none of the four are, so the bar never shows
  // nothing selected — that is what `onATab` computes.
  const routes = ALL_NAV_LINKS.map((l) => l.href);

  it("never lights two tabs at once", () => {
    for (const route of routes) {
      const lit = FIELD_TAB_HREFS.filter((href) => navIsActive(route, navLink(href)));
      expect(lit.length, `${route} lit ${lit.join(", ")}`).toBeLessThanOrEqual(1);
    }
  });

  it("Dashboard matches ONLY the dashboard", () => {
    // /admin is a prefix of every admin route. Without `exact` it would be lit
    // on all nineteen.
    expect(navIsActive("/admin", navLink("/admin"))).toBe(true);
    expect(navIsActive("/admin/payments", navLink("/admin"))).toBe(false);
    expect(navIsActive("/admin/cycle/close", navLink("/admin"))).toBe(false);
  });

  it("a tab stays lit on its own child routes", () => {
    expect(navIsActive("/admin/payments/new", navLink("/admin/payments"))).toBe(true);
    expect(navIsActive("/admin/collections", navLink("/admin/collections"))).toBe(true);
  });
});

describe("touch and platform", () => {
  it("tab targets clear the 44px floor", () => {
    expect(TAB_BAR).toMatch(/minHeight:\s*["']5[0-9]px["']/);
  });

  it("the drawer's rows clear it too", () => {
    // The rail's rows are the drawer's rows. py-2 is a 36px row: fine under a
    // mouse, a miss waiting to happen under a thumb.
    expect(SIDEBAR).toMatch(/py-3[^"]*md:py-2/);
  });

  it("the bar reserves the iOS safe area", () => {
    expect(TAB_BAR).toContain("env(safe-area-inset-bottom)");
  });

  it("taps are not delayed", () => {
    expect(TAB_BAR).toContain("touchAction");
  });

  it("the current page is announced", () => {
    expect(TAB_BAR).toContain('aria-current={active ? "page" : undefined}');
  });

  it("the active item never rests on colour alone", () => {
    // Light bar -> near-black capsule, dark bar -> white capsule, and the
    // weight changes with it. The same treatment the member bar uses.
    expect(TAB_BAR).toContain("#0F172A");
    expect(TAB_BAR).toContain("dark:bg-white");
    expect(TAB_BAR).toContain("font-bold");
    expect(TAB_BAR).toContain("font-semibold");
  });

  it("inactive labels are full-strength text, never gray-400 or lighter", () => {
    const banned = /(?:^|\s)(?:text)-(?:gray|slate|zinc|neutral)-(?:300|400|500)\b/g;
    expect(TAB_BAR.match(banned) ?? []).toEqual([]);
  });
});

describe("the drawer behaves like a dialog", () => {
  it("announces itself as one", () => {
    expect(TAB_BAR).toContain('role="dialog"');
    expect(TAB_BAR).toContain('aria-modal="true"');
    expect(TAB_BAR).toContain("aria-expanded={open}");
    expect(TAB_BAR).toContain("aria-controls={drawerId}");
  });

  it("closes on Escape, and on navigating away", () => {
    expect(TAB_BAR).toContain('e.key === "Escape"');
    // Without this, tapping a destination leaves the sheet sitting over the
    // page it just opened.
    expect(TAB_BAR).toMatch(/setOpen\(false\);?\s*\n?\s*\}, \[pathname\]\)/);
  });

  it("the scrim is reachable without a mouse", () => {
    // A div with onClick is not. This one is a button with a name.
    expect(TAB_BAR).toContain('aria-label="Close menu"');
  });
});

describe("the groups the drawer shows are the groups the rail shows", () => {
  it("has the working sections, and not settings", () => {
    const eyebrows = NAV_GROUPS.map((g) => g.eyebrow);
    expect(eyebrows).toContain("Money");
    expect(eyebrows).toContain("The cycle");
    // Settings live in the account menu — somewhere you GO, not somewhere you
    // work (2.1). The mobile header carries that menu already.
    expect(eyebrows.join(" ")).not.toMatch(/settings/i);
    expect(LAYOUT).toContain("AccountMenu compact");
  });
});
