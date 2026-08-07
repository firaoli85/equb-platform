import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isNavActive,
  MEMBER_SECONDARY,
  MEMBER_TABS,
} from "../components/member/member-nav";

// UI_STANDARDS rule 9, as law.
//
// The previous nav failed in production: inactive labels were gray-400 at
// 10px, members could not see the other tabs, and they phoned the organizer.
// Nothing in the test suite noticed, because navigation was treated as
// styling. These tests treat it as behaviour.
//
// Measured contrast is NOT asserted here — it cannot be, without a browser.
// It is measured in the self-test loop against the real rendered page. What
// this file pins is everything that CAN be checked statically: the structure,
// the single source of truth, and the non-colour active signals.

const ROOT = join(import.meta.dirname, "..");
const NAV_SOURCE = readFileSync(join(ROOT, "components/member/member-nav.tsx"), "utf8");
const TAB_BAR = readFileSync(join(ROOT, "components/member/member-tab-bar.tsx"), "utf8");
const SIDEBAR = readFileSync(join(ROOT, "components/member/member-sidebar.tsx"), "utf8");

describe("the bottom bar stays navigable", () => {
  it("has at most five items", () => {
    // Past five, a bottom nav on a phone stops being navigable.
    expect(MEMBER_TABS.length).toBeLessThanOrEqual(5);
    expect(MEMBER_TABS.length).toBeGreaterThan(0);
  });

  it("every item has a text label — icon-only navigation is not allowed", () => {
    for (const tab of [...MEMBER_TABS, ...MEMBER_SECONDARY]) {
      expect(tab.label.trim().length, tab.href).toBeGreaterThan(0);
      // Long labels get cropped in a four-up bar on a 390px screen.
      expect(tab.label.length, `${tab.label} is too long for a tab`).toBeLessThanOrEqual(12);
    }
  });

  it("every destination is a distinct member route", () => {
    const all = [...MEMBER_TABS, ...MEMBER_SECONDARY];
    const hrefs = all.map((t) => t.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const href of hrefs) expect(href.startsWith("/me")).toBe(true);
  });

  it("Home comes first, and Account is reachable from the bar", () => {
    expect(MEMBER_TABS[0].href).toBe("/me");
    // Regression: "Where you are signed in" was once reachable only from a
    // tile on the home screen, so a member who was signed out elsewhere had
    // no route to their sessions.
    expect(MEMBER_TABS.some((t) => t.href === "/me/security")).toBe(true);
  });
});

describe("the active route is decided the same way everywhere", () => {
  it("Home matches ONLY the home route", () => {
    expect(isNavActive("/me", "/me")).toBe(true);
    // Without the exact match, Home would light up on every child route and
    // two tabs would look active at once.
    expect(isNavActive("/me", "/me/group")).toBe(false);
    expect(isNavActive("/me", "/me/security")).toBe(false);
  });

  it("other tabs match their subtree", () => {
    expect(isNavActive("/me/group", "/me/group")).toBe(true);
    expect(isNavActive("/me/security", "/me/security")).toBe(true);
    expect(isNavActive("/me/group", "/me/collections")).toBe(false);
  });

  it("EXACTLY ONE tab is active on every member route", () => {
    const routes = [
      "/me",
      "/me/group",
      "/me/collections",
      "/me/security",
      "/me/schedule",
      "/me/documents",
    ];
    for (const route of routes) {
      const active = [...MEMBER_TABS, ...MEMBER_SECONDARY].filter((t) =>
        isNavActive(t.href, route),
      );
      expect(active.length, `${route} lit ${active.map((a) => a.label).join(", ")}`).toBe(1);
    }
  });
});

describe("one source of truth (UI_STANDARDS rule 3)", () => {
  it("neither bar keeps its own list of destinations", () => {
    // Both previously did, which is how the sidebar came to show three of the
    // six member destinations while the tab bar showed a different three.
    for (const [name, source] of [
      ["tab bar", TAB_BAR],
      ["sidebar", SIDEBAR],
    ] as const) {
      expect(source, `${name} must import the shared list`).toContain("./member-nav");
      expect(
        source.match(/href:\s*["']\/me/g) ?? [],
        `${name} declares its own destinations`,
      ).toEqual([]);
    }
  });

  it("both bars render the shared icon component", () => {
    expect(TAB_BAR).toContain("MemberNavIcon");
    expect(SIDEBAR).toContain("MemberNavIcon");
  });
});

describe("the active state never rests on colour alone", () => {
  it("the icon changes FILL, not just colour", () => {
    // The komoot signal: readable with no colour perception at all.
    expect(NAV_SOURCE).toContain("solid");
    expect(NAV_SOURCE).toContain('fill: "currentColor"');
    expect(NAV_SOURCE).toContain('fill: "none"');
    for (const source of [TAB_BAR, SIDEBAR]) {
      expect(source).toMatch(/solid=\{active\}/);
    }
  });

  it("the active item sits on a filled surface, inverted from its bar", () => {
    // Light bar -> near-black capsule; dark bar -> white capsule. This is the
    // treatment that reaches 17.9:1 where a tint-on-tint could not.
    for (const source of [TAB_BAR, SIDEBAR]) {
      expect(source).toContain("#0F172A");
      expect(source).toMatch(/dark:bg-white|dark:bg-\[#0F172A\]/);
    }
  });

  it("the label weight changes too", () => {
    for (const source of [TAB_BAR, SIDEBAR]) {
      expect(source).toContain("font-bold");
      expect(source).toContain("font-semibold");
    }
  });

  it("inactive labels are full-strength text, never gray-400 or lighter", () => {
    // THE production failure, pinned. Anything at or above 400 in the grey
    // scale fails 4.5:1 as body text on white.
    const banned = /(?:text|dark:text)-(?:gray|slate|zinc|neutral)-(?:300|400|500)\b/g;
    for (const [name, source] of [
      ["tab bar", TAB_BAR],
      ["sidebar", SIDEBAR],
    ] as const) {
      const hits = (source.match(banned) ?? []).filter(
        // Dark-mode 300s are LIGHT text on a near-black bar — the opposite
        // case, and measured at 16:1.
        (m) => !m.startsWith("dark:"),
      );
      expect(hits, `${name} uses a too-light inactive colour: ${hits.join(", ")}`).toEqual([]);
    }
  });
});

describe("touch and platform", () => {
  it("tab targets clear the 44px floor", () => {
    expect(TAB_BAR).toMatch(/minHeight:\s*["']5[0-9]px["']/);
    expect(SIDEBAR).toMatch(/minHeight:\s*["']4[4-9]px["']/);
  });

  it("the bottom bar reserves the iOS safe area", () => {
    // Without it, labels sit under the home indicator on every modern iPhone.
    expect(TAB_BAR).toContain("env(safe-area-inset-bottom)");
  });

  it("taps are not delayed", () => {
    expect(TAB_BAR).toContain("touchAction");
  });

  it("the current page is announced", () => {
    for (const source of [TAB_BAR, SIDEBAR]) {
      expect(source).toContain('aria-current={active ? "page" : undefined}');
    }
  });

  it("motion is gated on reduced-motion", () => {
    expect(TAB_BAR).toContain("useReducedMotion");
    expect(TAB_BAR).toMatch(/reduce \? \{ duration: 0 \}/);
  });
});
