import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatCard } from "./stat-card";

// THE FIGURE IS THE TRUTH; THE COUNT-UP IS DECORATION.
//
// The card animated its money from zero on mount, and held zero as its
// initial state — so the SERVER rendered every figure as $0. The dashboard's
// cash position, all three cash tabs and every drill-down shipped $0 in their
// HTML, flashed to the real number when the bundle landed, and stayed at $0
// for good on a slow connection or with scripting off. Nothing errored.
//
// These tests pin the rule that prevents it: what a number SAYS is never
// decided by an animation.

describe("a stat card's figure survives without JavaScript", () => {
  it("server-renders the real money figure, never zero", () => {
    const html = renderToStaticMarkup(<StatCard label="Currently held" cents={1_250_000} />);
    expect(html).toContain("$12,500");
    expect(html).not.toContain(">$0<");
  });

  it("renders a genuine zero as zero", () => {
    // The guard above must not be satisfied by refusing to draw zeroes: a
    // group holding nothing has to be able to say so.
    const html = renderToStaticMarkup(<StatCard label="Paid out" cents={0} />);
    expect(html).toContain("$0");
  });

  it("renders cents exactly, with no rounding of its own", () => {
    const html = renderToStaticMarkup(<StatCard label="Overdue" cents={250_037} />);
    expect(html).toContain("$2,500.37");
  });

  it("keeps a non-money figure untouched", () => {
    const html = renderToStaticMarkup(<StatCard label="Members" figure="27" />);
    expect(html).toContain("27");
  });

  it("says nothing rather than zero when there is no figure at all", () => {
    const html = renderToStaticMarkup(<StatCard label="Unknown" />);
    expect(html).toContain("—");
    expect(html).not.toContain("$0");
  });

  it("keeps every figure tabular so a counting number does not jitter", () => {
    const html = renderToStaticMarkup(<StatCard label="Held" cents={1_250_000} />);
    expect(html).toContain("tabular-nums");
  });

  it("still drills down — no dead figures (2.1)", () => {
    const html = renderToStaticMarkup(
      <StatCard label="Received" cents={100} href="/admin/cash?view=received" />,
    );
    expect(html).toContain('href="/admin/cash?view=received"');
  });
});
