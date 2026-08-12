import { describe, expect, it } from "vitest";
import {
  memberWindowSentence,
  outsideWindowLabel,
  ownProgressLabel,
  ownWeekLabel,
  ownWeekNumber,
} from "./member-window";
import { formatDateLongUTC } from "./format";

// THE MEMBER'S FRAME IS DATES AND THEIR OWN COUNTS.
//
// The portal said "You joined in week 14. Your weeks run from 14 to 23." Two
// faults in one sentence: week 14 is a coordinate in the organizer's system
// that the reader has never seen, and "joined in week 14" reads as arriving
// late to something already running — which 2.22 says is not how this works.

const AUG_16 = new Date(Date.UTC(2026, 7, 16));
const OCT_18 = new Date(Date.UTC(2026, 9, 18));

describe("memberWindowSentence — the line the portal leads with", () => {
  it("is the organizer's own wording, exactly", () => {
    expect(
      memberWindowSentence({
        startDate: AUG_16,
        weeksCommitted: 10,
        finishDate: OCT_18,
        formatDate: formatDateLongUTC,
      }),
    ).toBe(
      "You started Sunday, August 16, 2026 and you are paying for 10 weeks — " +
        "you finish Sunday, October 18, 2026.",
    );
  });

  // THE WHOLE POINT. No cycle coordinate reaches the reader.
  it("contains no cycle week number, for any window", () => {
    for (const weeks of [1, 6, 10, 20, 23]) {
      const s = memberWindowSentence({
        startDate: AUG_16,
        weeksCommitted: weeks,
        finishDate: OCT_18,
        formatDate: formatDateLongUTC,
      });
      expect(s).not.toMatch(/\bweek \d+\b/i);
      expect(s).not.toMatch(/\bruns? from \d+\b/i);
    }
  });

  // "You joined in week 14" implied lateness. Nothing may.
  it("never implies they arrived late to something already running", () => {
    const s = memberWindowSentence({
      startDate: AUG_16,
      weeksCommitted: 10,
      finishDate: OCT_18,
      formatDate: formatDateLongUTC,
    });
    expect(s).not.toMatch(/\bjoined\b/i);
    expect(s).not.toMatch(/\blate\b/i);
    expect(s).not.toMatch(/\bremaining\b/i);
  });

  it("says the same thing for a member who started at the very beginning", () => {
    // A week-1 member and a later one get ONE sentence shape, so nobody's
    // window reads as the exception.
    const first = memberWindowSentence({
      startDate: new Date(Date.UTC(2026, 4, 17)),
      weeksCommitted: 20,
      finishDate: OCT_18,
      formatDate: formatDateLongUTC,
    });
    expect(first).toContain("You started Sunday, May 17, 2026");
    expect(first).toContain("paying for 20 weeks");
  });

  it("says one week, not 1 weeks", () => {
    expect(
      memberWindowSentence({
        startDate: AUG_16,
        weeksCommitted: 1,
        finishDate: AUG_16,
        formatDate: formatDateLongUTC,
      }),
    ).toContain("paying for 1 week —");
  });

  // A sentence about someone's own money must never carry a placeholder where
  // a day should be.
  it("drops a missing date rather than printing a dash", () => {
    const noFinish = memberWindowSentence({
      startDate: AUG_16,
      weeksCommitted: 10,
      finishDate: null,
      formatDate: formatDateLongUTC,
    });
    expect(noFinish).toBe("You started Sunday, August 16, 2026 and you are paying for 10 weeks.");
    expect(noFinish).not.toContain("—");

    const noStart = memberWindowSentence({
      startDate: null,
      weeksCommitted: 10,
      finishDate: OCT_18,
      formatDate: formatDateLongUTC,
    });
    expect(noStart).toBe("You are paying for 10 weeks — you finish Sunday, October 18, 2026.");
    expect(noStart).not.toContain("null");
    expect(noStart).not.toContain("undefined");
  });
});

describe("ownWeekNumber — their ordinal, never the cycle's", () => {
  const window = { startWeek: 14, weeksCommitted: 10 }; // cycle weeks 14..23

  it("counts from THEIR start", () => {
    expect(ownWeekNumber({ weekNumber: 14, ...window })).toBe(1);
    expect(ownWeekNumber({ weekNumber: 16, ...window })).toBe(3);
    expect(ownWeekNumber({ weekNumber: 23, ...window })).toBe(10);
  });

  it("is null outside their window — those weeks are not theirs to number", () => {
    expect(ownWeekNumber({ weekNumber: 13, ...window })).toBeNull();
    expect(ownWeekNumber({ weekNumber: 24, ...window })).toBeNull();
    expect(ownWeekNumber({ weekNumber: 1, ...window })).toBeNull();
  });

  it("is the identity for a member who starts at week 1", () => {
    for (const n of [1, 5, 20]) {
      expect(ownWeekNumber({ weekNumber: n, startWeek: 1, weeksCommitted: 20 })).toBe(n);
    }
  });

  it("labels it as theirs, so the denominator is never the cycle's", () => {
    expect(ownWeekLabel(3, 10)).toBe("week 3 of your 10");
    expect(ownProgressLabel(3, 10)).toBe("3 of 10 weeks paid");
    // The bug this replaces: "3 of 20 weeks paid" for a 10-week member.
    expect(ownProgressLabel(3, 10)).not.toContain("20");
  });
});

describe("outsideWindowLabel — the boundary as a date", () => {
  it("says when their weeks begin, not that they were absent", () => {
    const s = outsideWindowLabel({
      side: "before",
      boundary: AUG_16,
      formatDate: formatDateLongUTC,
    });
    expect(s).toBe("Before you started — your weeks begin Sunday, August 16, 2026");
    expect(s).not.toMatch(/\bjoined\b/i);
    expect(s).not.toMatch(/\bweek \d+\b/i);
  });

  it("says when their last week is", () => {
    const s = outsideWindowLabel({
      side: "after",
      boundary: OCT_18,
      formatDate: formatDateLongUTC,
    });
    expect(s).toBe("After you finish — your last week is Sunday, October 18, 2026");
    expect(s).not.toMatch(/\bweek \d+\b/i);
  });

  it("still says something useful with no date to give", () => {
    for (const side of ["before", "after"] as const) {
      const s = outsideWindowLabel({ side, boundary: null, formatDate: formatDateLongUTC });
      expect(s.length).toBeGreaterThan(10);
      expect(s).not.toContain("null");
      expect(s).not.toMatch(/\bweek \d+\b/i);
    }
  });
});
