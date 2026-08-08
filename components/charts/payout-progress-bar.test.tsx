import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PayoutProgressBar } from "./payout-progress-bar";

// The denominator is the whole argument of this chart, so it is what the
// tests are about: 31 lucky numbers held by 27 members, six drawn, five
// collected and one still waiting.

const render = (props: Partial<Parameters<typeof PayoutProgressBar>[0]> = {}) =>
  renderToStaticMarkup(
    <PayoutProgressBar
      collectedCount={5}
      pendingCount={1}
      totalNumbers={31}
      collectedTotal={13_230_000}
      pendingTotal={2_646_000}
      {...props}
    />,
  );

describe("payout progress", () => {
  const html = render();

  it("counts against every lucky number, not every member", () => {
    // 27 members hold 31 numbers. A member denominator would call this cycle
    // finished four payouts early.
    expect(html).toContain("5 of 31");
    expect(html).toContain("31 in this cycle");
  });

  it("shows still-to-come as the remainder of the known total", () => {
    const table = html.slice(html.indexOf("<table"));
    expect(table).toContain("<th scope=\"row\">Still to come</th></tr>".replace("</tr>", ""));
    expect(table).toContain("<td>25</td>");
  });

  it("never draws more bar than there is bar, and says why", () => {
    // Found by this test: 20 collected + 20 pending against 31 numbers made
    // the segments sum to 129%, and the container's overflow:hidden clipped
    // the excess SILENTLY — the amber segment simply ended early, which reads
    // as a smaller number of people waiting than there are.
    const over = render({ collectedCount: 20, pendingCount: 20, totalNumbers: 31 });
    const widths = [...over.matchAll(/width:\s*([\d.]+)%/g)].map((m) => Number(m[1]));
    expect(widths.length).toBeGreaterThan(0); // the assertion below is vacuous otherwise
    expect(widths.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(100.01);
    // And it is stated, because a scaled bar alone would hide a double payout.
    expect(over).toContain("has been paid twice");
    expect(over).toContain("9 more than");
  });

  it("says nothing about double payouts in the ordinary case", () => {
    expect(html).not.toContain("has been paid twice");
  });

  it("gives a single payout out of 31 a visible segment", () => {
    // 1/31 is 3.2%; at 320px that is 10px, and rounding it away would show an
    // empty bar on the day of the first collection.
    const first = render({ collectedCount: 1, pendingCount: 0, collectedTotal: 2_646_000 });
    const widths = [...first.matchAll(/width:\s*([\d.]+)%/g)].map((m) => Number(m[1]));
    expect(widths.filter((w) => w > 0).every((w) => w >= 2)).toBe(true);
  });

  it("renders nothing but the empty total before the first draw", () => {
    const none = render({ collectedCount: 0, pendingCount: 0, collectedTotal: 0, pendingTotal: 0 });
    expect(none).toContain("0 of 31");
    expect(none.slice(none.indexOf("<table"))).toContain("<td>31</td>");
  });

  it("distinguishes the three states by more than colour", () => {
    // Solid, hatched, empty — rule 4. The hatch is a repeating gradient.
    expect(html).toContain("repeating-linear-gradient");
    expect(html).toContain("bg-gray-200 dark:bg-gray-800");
  });

  it("sends each segment somewhere the organizer can act", () => {
    expect(html).toContain('href="/admin/cash?view=paid-out"');
    expect(html).toContain('href="/admin/waiting"');
    expect(html).toContain('href="/admin/wheel/setup"');
  });

  it("carries the counts and money as a table", () => {
    const table = html.slice(html.indexOf("<table"));
    expect(table).toContain("$132,300");
    expect(table).toContain("$26,460");
    // "Still to come" has no money yet, and says so rather than showing $0.
    expect(table).toContain("not drawn yet");
  });
});
