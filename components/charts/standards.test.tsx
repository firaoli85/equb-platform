import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CashPositionChart } from "./cash-position-chart";
import { CollectedVsExpectedChart } from "./collected-vs-expected-chart";
import { ConsistencyStrip } from "./consistency-strip";
import { PayoutProgressBar } from "./payout-progress-bar";
import { cashSeries, type WeekReceipts } from "@/lib/dashboard";

// UI_STANDARDS, applied to the charts as a set rather than one at a time.
//
// Rounds one and two proved each chart says the right thing and the app
// builds. This is the third axis: the rules that hold ACROSS screens, where a
// single chart looks fine on its own and the set is inconsistent — a missing
// dark variant, a 20px tap target, a plot that pushes the page sideways at
// 390px. Those are exactly the faults that survive a per-component review.

const WEEKS = Array.from({ length: 20 }, (_, i) => ({ weekNumber: i + 1 }));
const WEEKLY = 2_700_000;

const cash = cashSeries({
  weeks: WEEKS,
  payments: Array.from({ length: 7 }, (_, i) => ({ weekNumber: i + 1, amountPaid: WEEKLY })),
  payouts: Array.from({ length: 5 }, (_, i) => ({
    weekNumber: i + 1,
    netAmount: 2_646_000,
    status: "COLLECTED" as const,
  })),
  elapsedThroughWeek: 6,
});

const receipts: WeekReceipts[] = WEEKS.map((w) => ({
  weekNumber: w.weekNumber,
  expected: WEEKLY,
  received: w.weekNumber <= 6 ? WEEKLY : 0,
  shortfall: w.weekNumber <= 6 ? 0 : WEEKLY,
  membersPaid: w.weekNumber <= 6 ? 27 : 0,
  membersExpected: 27,
  elapsed: w.weekNumber <= 6,
}));

const RENDERED = [
  { name: "cash position", html: renderToStaticMarkup(<CashPositionChart points={cash} />) },
  {
    name: "collected vs expected",
    html: renderToStaticMarkup(<CollectedVsExpectedChart weeks={receipts} />),
  },
  {
    name: "payout progress",
    html: renderToStaticMarkup(
      <PayoutProgressBar
        collectedCount={5}
        pendingCount={1}
        totalNumbers={31}
        collectedTotal={13_230_000}
        pendingTotal={2_646_000}
      />,
    ),
  },
  {
    name: "consistency strip",
    html: renderToStaticMarkup(
      <ConsistencyStrip
        members={[
          {
            participationId: "p1",
            name: "አለም — Alem",
            weeks: [
              { weekNumber: 1, state: "paid" },
              { weekNumber: 2, state: "overdue" },
            ],
          },
        ]}
      />,
    ),
  },
];

describe("every chart obeys the shared standards", () => {
  for (const { name, html } of RENDERED) {
    describe(name, () => {
      it("has a dark variant for every colour it sets", () => {
        // A light-only surface is invisible in dark mode, and the organizer
        // uses this product at night. Any `bg-`, `text-` or `stroke-` that
        // names a light shade must have a `dark:` partner somewhere on the
        // same element; the cheap proxy is that the file uses dark: at all
        // and that no element sets a light background without one.
        // A BARE `bg-white` utility only. `hover:bg-white/5` and
        // `dark:bg-white/10` both contain the token and are the dark-mode
        // treatment themselves — flagging those made the guard cry wolf on
        // exactly the code that was doing the right thing.
        const lightSurfaces = [...html.matchAll(/class="([^"]*)"/g)]
          .map((m) => m[1])
          .filter((cls) => cls.split(/\s+/).includes("bg-white"));
        for (const cls of lightSurfaces) {
          expect(cls, `bg-white with no dark partner: ${cls}`).toMatch(/dark:bg-/);
        }
      });

      it("carries its figures as a table, not only as a picture", () => {
        expect(html).toContain("<table");
        expect(html).toContain("<caption>");
      });

      it("hides the picture from screen readers so the table is not read twice", () => {
        if (html.includes("<svg")) expect(html).toContain('aria-hidden="true"');
      });

      it("never sets a fixed pixel width on the outer surface", () => {
        // A hard width is what pushes the page sideways at 390px. The plots
        // are allowed their own width INSIDE a scroll container; the figure
        // around them is not.
        const outer = html.slice(0, html.indexOf(">") + 1);
        expect(outer).not.toMatch(/width:\s*\d+px/);
      });

      it("gives every link a touch target of at least 32px", () => {
        // UI_STANDARDS: 44px where the layout allows, 32px floor on dense
        // instruments. A bare 8px dot or a 12px week number fails a thumb.
        const links = [...html.matchAll(/<a [^>]*class="([^"]*)"/g)].map((m) => m[1]);
        expect(links.length).toBeGreaterThan(0);
        for (const cls of links) {
          expect(cls, `link with no height floor: ${cls}`).toMatch(
            /\b(h-8|h-4|min-h-11|min-h-8|py-\d|flex-col)\b/,
          );
        }
      });
    });
  }

  it("puts every wide plot inside its own scroll container", () => {
    // Rule 11: the page never scrolls sideways; wide content scrolls inside
    // itself. Checked in the source because the wrapper is what matters, not
    // the rendered width.
    const dir = join(process.cwd(), "components/charts");
    const wide = readdirSync(dir).filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"));
    for (const file of wide) {
      const src = readFileSync(join(dir, file), "utf8");
      if (!src.includes("<svg") && !src.includes("min-w-[")) continue;
      expect(src, `${file} draws wide content with no overflow-x container`).toContain(
        "overflow-x-auto",
      );
    }
  });

  it("formats every money figure through formatMoney, never by hand", () => {
    // UI_STANDARDS rule 8. A hand-rolled toFixed(2) is how cents become
    // dollars silently.
    const dir = join(process.cwd(), "components/charts");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))) {
      const src = readFileSync(join(dir, file), "utf8");
      const handRolled = /\$\{[^}]*\/\s*100[^}]*\}/.test(src.replace(/\/\/.*$/gm, ""));
      if (handRolled) {
        // The one legitimate case is a compact AXIS label, which formatMoney
        // deliberately cannot produce — it is named so it cannot spread.
        expect(src, `${file} divides by 100 outside axisMoney`).toContain("function axisMoney");
      }
    }
  });

  it("keeps every number tabular", () => {
    // Rule 8: a column of figures that jitters as digits change is unreadable.
    for (const { name, html } of RENDERED) {
      expect(html, `${name} has no tabular figures`).toContain("tabular-nums");
    }
  });
});
