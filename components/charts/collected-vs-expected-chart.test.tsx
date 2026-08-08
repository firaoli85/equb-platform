import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CollectedVsExpectedChart } from "./collected-vs-expected-chart";
import type { WeekReceipts } from "@/lib/dashboard";

// The failures worth catching here are all about the DIVIDER. A week that is
// still collecting must never be drawn, counted or announced as a shortfall —
// that false alarm is the whole reason the stored-week-date rule exists.

const WEEKLY = 2_700_000; // 27 members × $1,000

function week(n: number, received: number, elapsed: boolean): WeekReceipts {
  return {
    weekNumber: n,
    expected: WEEKLY,
    received,
    shortfall: Math.max(0, WEEKLY - received),
    membersPaid: Math.round((received / WEEKLY) * 27),
    membersExpected: 27,
    elapsed,
  };
}

// Six closed weeks fully paid, week 7 open and half in, the rest untouched.
const PRODUCTION: WeekReceipts[] = [
  ...Array.from({ length: 6 }, (_, i) => week(i + 1, WEEKLY, true)),
  week(7, 1_350_000, false),
  ...Array.from({ length: 13 }, (_, i) => week(i + 8, 0, false)),
];

const render = (weeks: WeekReceipts[]) =>
  renderToStaticMarkup(<CollectedVsExpectedChart weeks={weeks} />);

describe("collected vs expected", () => {
  const html = render(PRODUCTION);

  it("never emits NaN", () => {
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("undefined");
  });

  it("counts overdue across CLOSED weeks only", () => {
    // Weeks 7-20 are short by $35,100 on paper. None of it is overdue: their
    // windows have not closed. The headline must say so.
    expect(html).toContain("All in");
    expect(html).toContain("closed weeks are fully collected");
  });

  it("calls a genuinely short closed week overdue, and marks it", () => {
    const short = render([week(1, WEEKLY, true), week(2, 1_000_000, true), week(3, 0, false)]);
    expect(short).toContain("overdue across closed weeks");
    // $17,000 short in week 2.
    expect(short).toContain("$17,000");
    // Marked with a dot, not by colour alone (rule 4).
    expect(short).toContain("<circle");
  });

  it("never marks an OPEN week as short, however little has come in", () => {
    // Week 7 has $13,500 of $27,000 and is open. No dot, no red.
    const openOnly = render([week(1, 0, false)]);
    expect(openOnly).not.toContain("<circle");
  });

  it("draws the divider only when some weeks are still open", () => {
    expect(html).toContain("still open");
    const allClosed = render(PRODUCTION.map((w) => ({ ...w, elapsed: true })));
    expect(allClosed).not.toContain("still open");
    expect(allClosed).toContain("Every week here has closed.");
  });

  it("keeps every bar inside the plot and never zero-height for real money", () => {
    const rects = [...html.matchAll(/<rect[^>]*y="([\d.]+)"[^>]*height="([\d.]+)"/g)].map((m) => ({
      y: Number(m[1]),
      h: Number(m[2]),
    }));
    expect(rects.length).toBeGreaterThan(0);
    for (const r of rects) {
      expect(r.h).toBeGreaterThanOrEqual(1);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.y + r.h).toBeLessThanOrEqual(200);
    }
  });

  it("gives one member's payment against a 27-member week a visible bar", () => {
    // $1,000 of $27,000 is 3.7% of the scale — under 5px, and easy to round
    // away to nothing.
    const tiny = render([week(1, 100_000, true), week(2, WEEKLY, true)]);
    const heights = [...tiny.matchAll(/height="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(heights.every((h) => h >= 1)).toBe(true);
  });

  it("carries every week as a table row with its real figures", () => {
    const table = html.slice(html.indexOf("<table"));
    expect(table).toContain("<th scope=\"row\">7</th>");
    expect(table).toContain("14 of 27");
    // An open week reports no overdue, whatever its shortfall arithmetic says.
    expect(table).toContain("still open");
    expect(table).toContain("none");
  });

  it("links every week to that week on Payments", () => {
    for (const w of PRODUCTION) {
      expect(html).toContain(`href="/admin/payments?week=${w.weekNumber}"`);
    }
  });

  it("renders an empty cycle without inventing an axis", () => {
    const empty = render([]);
    expect(empty).toContain("No weeks yet");
    expect(empty).not.toContain("<svg");
  });
});
