import { describe, expect, it } from "vitest";
import { windowChangeRefusal, windowConflicts } from "./participation-window";

// A member on weeks 1–20 holding #7.
const base = {
  memberName: "Meheret",
  startWeek: 1,
  weeksCommitted: 20,
  plans: [] as { weekNumber: number; numbers: number[] }[],
  drawnWeeks: [] as { weekNumber: number; numbers: number[] }[],
};

describe("what a window change would strand", () => {
  it("nothing, when the window still covers everything", () => {
    const c = windowConflicts({
      ...base,
      plans: [{ weekNumber: 18, numbers: [7] }],
      drawnWeeks: [{ weekNumber: 12, numbers: [7] }],
    });
    expect(c.plans).toEqual([]);
    expect(c.draws).toEqual([]);
  });

  it("a plan past the new finish week", () => {
    // Shortening 20 → 8 leaves the week-18 plan unreachable.
    const c = windowConflicts({
      ...base,
      weeksCommitted: 8,
      plans: [{ weekNumber: 18, numbers: [7] }],
    });
    expect(c.plans).toHaveLength(1);
  });

  it("a draw BEFORE the new start week", () => {
    // Moving the start 1 → 15 leaves the week-12 win outside the window.
    const c = windowConflicts({
      ...base,
      startWeek: 15,
      weeksCommitted: 6,
      drawnWeeks: [{ weekNumber: 12, numbers: [7] }],
    });
    expect(c.draws).toHaveLength(1);
  });
});

describe("the refusal", () => {
  it("REFUSES a shortened window that strands a committed plan", () => {
    // THE DEFECT. validateCommitmentCap passes (8 ≤ cap), there is no payout
    // so no settlement branch, the rebuild succeeds and the save commits.
    // From the week the window closes, #7 leaves the pool, so its slot is
    // never eligible — and at week 18 selectWinningSlot throws. On the SHARED
    // draw screen that is the neutral "Something needs attention", while the
    // setup page shows #7 frozen as "committed to a winner plan". The week
    // cannot be drawn and nothing says why.
    const refusal = windowChangeRefusal({
      ...base,
      weeksCommitted: 8,
      plans: [{ weekNumber: 18, numbers: [7] }],
    });
    expect(refusal).not.toBeNull();
    expect(refusal).toContain("#7");
    expect(refusal).toContain("week 18");
    expect(refusal).toContain("weeks 1–8");
    // It must name where to undo it, not merely refuse.
    expect(refusal).toContain("wheel setup");
  });

  it("REFUSES a start week that moves past a week they already won", () => {
    // termsChanged is FALSE here — the entitlement is unchanged — so no
    // settlement step opens and nothing else catches it. The draw and payout
    // survive on a week the member's own schedule renders as "before you
    // started", while the draws page still names them as its winner.
    const refusal = windowChangeRefusal({
      ...base,
      startWeek: 15,
      weeksCommitted: 6,
      drawnWeeks: [{ weekNumber: 12, numbers: [7] }],
    });
    expect(refusal).not.toBeNull();
    expect(refusal).toContain("won week 12");
    expect(refusal).toContain("Collections");
  });

  it("the DRAW is named first — it is the one with money on it", () => {
    const refusal = windowChangeRefusal({
      ...base,
      startWeek: 15,
      weeksCommitted: 2,
      plans: [{ weekNumber: 18, numbers: [7] }],
      drawnWeeks: [{ weekNumber: 12, numbers: [7] }],
    });
    expect(refusal).toContain("won week 12");
  });

  it("allows the ordinary edit that strands nothing", () => {
    expect(windowChangeRefusal({ ...base, weeksCommitted: 18 })).toBeNull();
    expect(
      windowChangeRefusal({
        ...base,
        weeksCommitted: 18,
        plans: [{ weekNumber: 5, numbers: [7] }],
        drawnWeeks: [{ weekNumber: 5, numbers: [7] }],
      }),
    ).toBeNull();
  });

  it("a plan or draw on the exact boundary week is INSIDE the window", () => {
    // Off-by-one here would refuse a legitimate edit, which is its own defect.
    expect(
      windowChangeRefusal({
        ...base,
        startWeek: 5,
        weeksCommitted: 6, // weeks 5–10
        plans: [{ weekNumber: 10, numbers: [7] }],
        drawnWeeks: [{ weekNumber: 5, numbers: [7] }],
      }),
    ).toBeNull();
  });
});
