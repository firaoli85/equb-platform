import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { cashSeries } from "@/lib/dashboard";
import { CashPositionChart } from "./cash-position-chart";

// WHAT A CHART TEST IS FOR.
//
// Not "does it render" — that is what the build already proves. The failures
// worth catching are the ones that render fine and LIE:
//
//   · a bar 3px tall for a real $340, or 0px for a real figure
//   · a point drawn outside the plot, silently clipped
//   · NaN in a path, which the browser drops without complaint
//   · the elapsed divider in the wrong place, which turns "this week is still
//     collecting" into "the position collapsed"
//   · figures in the picture that disagree with the figures in the table
//
// So the assertions are geometric and numeric, against a fixture shaped like
// the real cycle: 20 weeks, 27 members at $1,000, six weeks drawn, one winner
// still to collect.

const WEEKS = Array.from({ length: 20 }, (_, i) => ({ weekNumber: i + 1 }));
const WEEKLY = 2_700_000; // 27 × $1,000 in cents
const PAYOUT = 2_646_000; // one collection, net of the 2% fee

function productionSeries() {
  return cashSeries({
    weeks: WEEKS,
    payments: [
      ...Array.from({ length: 6 }, (_, i) => ({ weekNumber: i + 1, amountPaid: WEEKLY })),
      { weekNumber: 7, amountPaid: 1_800_000 },
    ],
    payouts: [
      ...Array.from({ length: 5 }, (_, i) => ({
        weekNumber: i + 1,
        netAmount: PAYOUT,
        status: "COLLECTED" as const,
      })),
      { weekNumber: 6, netAmount: PAYOUT, status: "PENDING" as const },
    ],
    elapsedThroughWeek: 6,
  });
}

function render(points: ReturnType<typeof cashSeries>) {
  return renderToStaticMarkup(<CashPositionChart points={points} />);
}

/** Every number inside every SVG path, so geometry can be checked directly. */
function pathNumbers(html: string): number[] {
  const out: number[] = [];
  for (const m of html.matchAll(/ d="([^"]+)"/g)) {
    for (const n of m[1].matchAll(/-?\d+(\.\d+)?/g)) out.push(Number(n[0]));
  }
  return out;
}

describe("the cash position chart draws what the numbers say", () => {
  const points = productionSeries();
  const html = render(points);

  it("never emits NaN — a browser drops the path and says nothing", () => {
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("undefined");
    expect(pathNumbers(html).every(Number.isFinite)).toBe(true);
  });

  it("keeps every drawn point inside the plot", () => {
    // A point below the baseline or above the top is clipped by the viewBox
    // and simply disappears, which reads as "no money that week".
    const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(html);
    expect(viewBox).not.toBeNull();
    const height = Number(viewBox![2]);
    for (const y of pathNumbers(html).filter((_, i) => i % 2 === 1)) {
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(height);
    }
  });

  it("gives a real but small movement a visible bar", () => {
    // The bug this exists for: one member's $50 against a $27,000 week is
    // 0.18% of the scale, which rounds to a 0px rect and reads as nothing.
    const tiny = cashSeries({
      weeks: WEEKS,
      payments: [
        { weekNumber: 1, amountPaid: WEEKLY },
        { weekNumber: 2, amountPaid: 5_000 },
      ],
      payouts: [],
      elapsedThroughWeek: 2,
    });
    const heights = [...render(tiny).matchAll(/height="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(heights.every((h) => h >= 1)).toBe(true);
  });

  it("draws the elapsed weeks solid and the open ones outlined", () => {
    // The Xero Actuals | Projected split. Without it week 7 — still collecting
    // — reads as a collapse.
    expect(html).toContain("still open");
    expect(html).toContain("stroke-dasharray");
  });

  it("does not draw a divider when every week has closed", () => {
    const allClosed = cashSeries({
      weeks: WEEKS,
      payments: WEEKS.map((w) => ({ weekNumber: w.weekNumber, amountPaid: WEEKLY })),
      payouts: [],
      elapsedThroughWeek: 20,
    });
    expect(render(allClosed)).not.toContain("still open");
  });

  it("carries every figure as a real table, not only as a picture", () => {
    const table = html.slice(html.indexOf("<table"));
    for (const p of points) {
      expect(table).toContain(`<th scope="row">${p.weekNumber}</th>`);
    }
    // The held position for week 5, formatted exactly as the page formats it.
    expect(table).toContain("$2,700");
    expect(table).toContain("still open");
    expect(table).toContain("closed");
  });

  it("names the headline figure the same way the stat card does", () => {
    // Two screens showing one figure must not be able to disagree (2.14).
    const held = points[5].held;
    const dollars = Math.floor(held / 100).toLocaleString("en-US");
    expect(html).toContain(`$${dollars}`);
    expect(html).toContain("held after week 6");
  });

  it("links every week to that week on Payments", () => {
    for (const p of points) {
      expect(html).toContain(`href="/admin/payments?week=${p.weekNumber}"`);
    }
  });

  it("says out loud when the position went below zero", () => {
    // Clamping to a 0-based axis without saying so would draw a solvent group.
    const overdrawn = cashSeries({
      weeks: WEEKS,
      payments: [{ weekNumber: 1, amountPaid: 100_000 }],
      payouts: [{ weekNumber: 1, netAmount: 500_000, status: "COLLECTED" }],
      elapsedThroughWeek: 1,
    });
    const out = render(overdrawn);
    expect(out).toContain("below zero");
    expect(out).toContain("-$4,000");
  });

  it("renders an empty cycle without inventing an axis", () => {
    const empty = render([]);
    expect(empty).toContain("No weeks yet");
    expect(empty).not.toContain("<svg");
  });

  it("hides the picture from screen readers and exposes the table instead", () => {
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("<caption>Cash position by week</caption>");
  });

  it("carries a shape as well as a colour in the legend", () => {
    // Rule 4: colour is never the only carrier. "Drawn, not collected" is a
    // dashed outline, not merely a lighter grey.
    expect(html).toContain("border-dashed");
    expect(html).toContain("Drawn, not collected");
  });
});
