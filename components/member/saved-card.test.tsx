import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Contribution } from "@/lib/contribution";
import { SavedCard } from "./saved-card";

// The member's own page is the one screen a non-technical person reads alone,
// with no organizer beside them to explain it. So the tests are about what it
// SAYS, not how it looks: the three figures must never be conflated, and a
// member who is current must never be shown a debt-shaped box.

const WEEKLY = 100_000; // $1,000

function contribution(over: Partial<Contribution> = {}): Contribution {
  return {
    paidIn: 600_000,
    stillToSave: 1_400_000,
    overdue: 0,
    surplus: 0,
    weeksCovered: 6,
    weeksCommitted: 20,
    progress: 0.3,
    ...over,
  } as Contribution;
}

const render = (c: Contribution, payoutNet = 1_960_000, received = false) =>
  renderToStaticMarkup(
    <SavedCard contribution={c} weeklyAmount={WEEKLY} payoutNet={payoutNet} payoutReceived={received} />,
  );

describe("the member's saved card", () => {
  it("leads with what they have PAID IN", () => {
    // 2.1: this is a savings group. The figure they care about most is theirs.
    const html = render(contribution());
    expect(html).toContain("$6,000");
    expect(html).toContain("Paid in");
    expect(html.indexOf("$6,000")).toBeLessThan(html.indexOf("Still to save"));
  });

  it("keeps still-to-save and overdue as different things", () => {
    const html = render(contribution({ overdue: 200_000 }));
    expect(html).toContain("$14,000"); // still to save
    expect(html).toContain("$2,000 overdue");
    expect(html).toContain("still ahead of you, not owed");
  });

  it("shows a current member no debt-shaped box at all", () => {
    const html = render(contribution());
    expect(html).toContain("Nothing overdue");
    expect(html).not.toContain("overdue</strong>");
  });

  it("draws a ring that matches the progress, and never past full", () => {
    // A member paid ahead has progress > 1. Unclamped, the sweep wraps past
    // the top and draws a SHORTER arc than someone who has saved less.
    const ahead = render(contribution({ progress: 1.2, surplus: 300_000, paidIn: 2_300_000 }));
    expect(ahead).not.toContain("NaN");
    expect(ahead).toContain("paid ahead");
    expect(ahead).toContain("$3,000 ahead");
  });

  it("draws no arc at all before the first payment", () => {
    // A 0° arc with a round linecap renders as a DOT — "you have saved a
    // little" when the truth is nothing.
    const nothing = render(contribution({ paidIn: 0, progress: 0, weeksCovered: 0 }));
    const paths = [...nothing.matchAll(/<path/g)].length;
    expect(paths).toBe(1); // the grey track only
    expect(nothing).toContain("$0");
  });

  it("reads the whole figure out to a screen reader, ring and all", () => {
    const html = render(contribution({ overdue: 200_000 }));
    expect(html).toContain("30% of your commitment");
    expect(html).toContain("6 of 20 weeks");
    expect(html).toContain("$2,000 is overdue");
  });

  it("colours the ring by whether anything is actually overdue", () => {
    expect(render(contribution())).toContain("stroke-emerald-600");
    expect(render(contribution({ overdue: 200_000 }))).toContain("stroke-amber-500");
  });

  it("respects reduced motion through a class, not an inline animation", () => {
    // globals.css switches animations off BY CLASS NAME. An inline animation
    // would sail straight past that block.
    const html = render(contribution());
    expect(html).toContain("animate-arc-draw");
    expect(html).not.toContain("animation:");
  });

  it("says whether the payout has landed", () => {
    expect(render(contribution())).toContain("when your number is drawn");
    expect(render(contribution(), 1_960_000, true)).toContain("you have received it");
  });
});
