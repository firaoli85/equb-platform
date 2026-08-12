import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// CONTEXT-AWARE LINKING — docs/ADMIN_IA.md §8.
//
//   "Every figure, name and date on screen is a link to the thing it is about."
//
// Not decoration: the organizer's job is to follow money to its source, and
// every click he cannot make is a screen he has to find from memory.
//
// This guard pins the links that exist so they cannot rot silently. It is
// deliberately NOT a regex that hunts for unlinked names — that test would be
// unreliable in both directions, passing on a name inside a Link it failed to
// parse and failing on a select option that cannot be a link at all. Instead
// each row states a screen, the thing on it, and where that thing must go.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

type Rule = { screen: string; file: string; shows: string; opens: string };

const RULES: Rule[] = [
  // ————— A member's name, anywhere, opens their profile —————
  {
    screen: "Dashboard — needs you",
    file: "app/admin/(protected)/page.tsx",
    shows: "a member who is behind",
    opens: "/admin/participations/${m.participationId}",
  },
  {
    screen: "Dashboard — locked out",
    file: "app/admin/(protected)/page.tsx",
    shows: "a member whose PIN is locked",
    opens: "/admin/people/${m.personId}",
  },
  {
    screen: "Cash — received by member",
    file: "app/admin/(protected)/cash/page.tsx",
    shows: "what each member has contributed",
    opens: "/admin/participations/${m.participationId}",
  },
  {
    // The last look before closing writes a ledger debt against 25 people.
    screen: "Close the cycle — the review table",
    file: "app/admin/(protected)/cycle/close/close-flow.tsx",
    shows: "each member's final standing",
    opens: "/admin/participations/${m.participationId}",
  },
  {
    screen: "Edit cycle — the projection",
    file: "app/admin/(protected)/cycle/edit/cycle-edit-form.tsx",
    shows: "each member's gross, fee and net",
    opens: "/admin/participations/${m.id}",
  },
  {
    screen: "Payments — patterns",
    file: "components/charts/consistency-strip.tsx",
    shows: "one strip per member",
    opens: "/admin/participations/${m.participationId}",
  },

  // ————— A week number opens that week on Payments —————
  {
    screen: "Cash — the position chart",
    file: "components/charts/cash-position-chart.tsx",
    shows: "the money in and out of each week",
    opens: "/admin/payments?week=${p.weekNumber}",
  },
  {
    screen: "Dashboard — collected vs expected",
    file: "components/charts/collected-vs-expected-chart.tsx",
    shows: "what each week collected",
    opens: "/admin/payments?week=${w.weekNumber}",
  },
  {
    screen: "Payments — patterns",
    file: "components/charts/consistency-strip.tsx",
    shows: "one dot per member-week",
    opens: "/admin/payments?week=${w.weekNumber}",
  },
  {
    screen: "Cash — paid out",
    file: "app/admin/(protected)/cash/page.tsx",
    shows: "the week a collection was won on",
    opens: "/admin/payments?week=${p.weekNumber}",
  },

  // ————— A chart segment opens the rows behind it —————
  {
    screen: "Collections — payout progress",
    file: "components/charts/payout-progress-bar.tsx",
    shows: "payouts waiting to be collected",
    opens: "/admin/waiting",
  },
  {
    screen: "Collections — payout progress",
    file: "components/charts/payout-progress-bar.tsx",
    shows: "numbers still to be drawn",
    opens: "/admin/wheel/setup",
  },

  // ————— A cycle leads to where it goes when it ends (2.9) —————
  {
    screen: "This cycle",
    file: "app/admin/(protected)/cycle/page.tsx",
    shows: "the cycle's life sequence",
    opens: "/admin/cycles",
  },
  {
    screen: "Archives index",
    file: "app/admin/(protected)/cycles/page.tsx",
    shows: "a closed cycle's record",
    opens: "/admin/cycles/${a.cycleId}/archive",
  },
  {
    // The blocker tells the organizer to fix it on the wheel; the numbers are
    // the way there. Naming a fix without a route to it is the gap §8 closes.
    screen: "Close the cycle — undrawn blocker",
    file: "app/admin/(protected)/cycle/close/close-flow.tsx",
    shows: "the numbers of a member never drawn",
    opens: "/admin/wheel/setup",
  },
];

describe("every figure on screen is a link to the thing it is about (§8)", () => {
  for (const rule of RULES) {
    it(`${rule.screen}: ${rule.shows} opens ${rule.opens}`, () => {
      const src = read(rule.file);
      // Three ways this codebase writes a destination, all equivalent: a
      // literal attribute, a template attribute, and a route held as data in
      // a list of links. Matching only the first made the guard fail on four
      // links that were plainly there — a guard that cries wolf gets deleted.
      const written = [
        `href="${rule.opens}"`,
        `href={\`${rule.opens}\`}`,
        `href: "${rule.opens}"`,
      ];
      expect(
        written.some((w) => src.includes(w)),
        `${rule.file} no longer links ${rule.shows} to ${rule.opens}.\n` +
          `If the destination moved, change the rule here too — the point is that ` +
          `the link exists, not that this exact string does.`,
      ).toBe(true);
    });
  }
});

// A LINK IS ONLY HALF THE OBLIGATION.
//
// Every rule above checks that a link is WRITTEN. All eleven `?week=` links
// were written, guarded, and passing — and the destination ignored the
// parameter completely: `PaymentsPage` took no `searchParams`, so clicking
// week 7 on a chart landed on the unfocused default and the organizer had to
// find week 7 again by eye. The guard was true and the feature was absent.
//
// So a link that carries a parameter now also has to prove the far end reads
// it. This is the half that was missing.
describe("a link that carries a parameter is READ at the other end (§8)", () => {
  it("the payments route reads ?week and hands it to the screen", () => {
    const src = read("app/admin/(protected)/payments/page.tsx");
    expect(src, "PaymentsPage takes no searchParams").toMatch(/searchParams/);
    expect(src, "the week parameter is never read").toMatch(/\(await searchParams\)\.week/);
    expect(src, "the week never reaches the screen").toMatch(/focusWeek=\{/);
  });

  it("the grid marks and reaches the week it was pointed at", () => {
    const src = read("app/admin/(protected)/payments/payments-grid.tsx");
    // Ringed…
    expect(src).toMatch(/data-focus-week=/);
    // …AND scrolled to, because week 17 of 20 is below the fold and a ring
    // nobody can see is the same as no ring.
    expect(src).toMatch(/scrollIntoView/);
  });

  it("the screen says it is showing one week, and offers the way back", () => {
    const src = read("app/admin/(protected)/payments/payments-screen.tsx");
    expect(src).toContain("focusNotice");
    expect(src).toContain("Show every week");
  });

  // NON-VACUITY. The shapes these look for must not be present by accident:
  // each is absent from a sibling screen that has no week parameter.
  it("the scan is not vacuous", () => {
    const unrelated = read("app/admin/(protected)/collections/page.tsx");
    expect(/\(await searchParams\)\.week/.test(unrelated)).toBe(false);
  });
});

describe("the three cash routes stay reachable after the move (§4.2)", () => {
  // The organizer has these in his history and his bookmarks. A 404 on a money
  // screen he has used for months is not an acceptable way to move it.
  for (const [route, view] of [
    ["held", "held"],
    ["received", "received"],
    ["paid-out", "paid-out"],
  ]) {
    it(`/admin/${route} redirects to the ${view} tab`, () => {
      const src = read(`app/admin/(protected)/${route}/page.tsx`);
      expect(src).toContain(`redirect("/admin/cash?view=${view}")`);
    });
  }

  it("nothing still links to the old routes", () => {
    // A stale link would work — via the redirect — but cost a round trip and
    // leave the wrong URL in the address bar.
    const files = [
      "app/admin/(protected)/page.tsx",
      "app/admin/(protected)/cash/page.tsx",
      "components/admin/admin-sidebar.tsx",
    ];
    for (const f of files) {
      const src = read(f);
      for (const stale of ['href="/admin/held"', 'href="/admin/received"', 'href="/admin/paid-out"']) {
        expect(src, `${f} still points at the moved route ${stale}`).not.toContain(stale);
      }
    }
  });
});
