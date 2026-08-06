import { describe, expect, it } from "vitest";
import {
  commitmentCap,
  cycleFinishPreview,
  finishLine,
  finishPreview,
  parseWeekField,
  resolveWeekDate,
  storedWeekDates,
  weeksToFinishWithGroup,
} from "./commitment";
import { formatDateLongUTC } from "./format";
import { dateOfWeek } from "./money";

// Ground truth 2.22: the organizer must NEVER calculate a finish date. These
// pin both halves — "finish with the group" filling the weeks figure, and the
// finish week + date being derivable from any pair of fields at any moment.

// Cycle 1 2026: 20 weeks from Sunday, May 17 2026.
const CYCLE_START = new Date(Date.UTC(2026, 4, 17));
const PLANNED = 20;

const preview = (startWeek: number | null, weeksCommitted: number | null) =>
  finishPreview({ cycleStartDate: CYCLE_START, plannedWeeks: PLANNED, startWeek, weeksCommitted });

describe("parseWeekField — a half-typed field shows nothing, never a guess", () => {
  it("reads a whole positive number", () => {
    expect(parseWeekField("6")).toBe(6);
    expect(parseWeekField("  12  ")).toBe(12);
  });

  it("returns null for empty, junk, fractional, zero and negative input", () => {
    for (const bad of ["", "   ", "abc", "1.5", "0", "-3", "1e3", "12a", "+4"]) {
      expect(parseWeekField(bad)).toBeNull();
    }
  });
});

describe("weeksToFinishWithGroup — 2.22's default, unchanged", () => {
  it("the ground-truth example: join week 15 of 20 -> 6 weeks", () => {
    expect(weeksToFinishWithGroup(20, 15)).toBe(6);
  });

  it("joining at week 1 commits the whole cycle", () => {
    expect(weeksToFinishWithGroup(20, 1)).toBe(20);
  });

  it("joining on the last planned week is one week", () => {
    expect(weeksToFinishWithGroup(20, 20)).toBe(1);
  });

  it("joining PAST the planned end still yields at least one week", () => {
    // remainingWeeksInCycle would be 0; a commitment of 0 weeks is not a
    // commitment, and this is exactly the case the override exists for.
    expect(weeksToFinishWithGroup(20, 25)).toBe(1);
  });
});

describe("finishPreview — the finish is always derivable, never typed", () => {
  it("week 15 for 6 weeks finishes week 20, with the group, on its real date", () => {
    const p = preview(15, 6)!;
    expect(p.finishWeek).toBe(20);
    expect(p.finishesWithGroup).toBe(true);
    expect(p.weeksPastPlannedEnd).toBe(0);
    // Week 20 is 19 weeks after May 17 2026 = Sunday, September 27 2026.
    expect(p.finishDate.toISOString().slice(0, 10)).toBe("2026-09-27");
  });

  it("a short commitment finishes EARLY — 2.22 says that is normal", () => {
    const p = preview(12, 6)!;
    expect(p.finishWeek).toBe(17);
    expect(p.finishesWithGroup).toBe(false);
    expect(p.weeksPastPlannedEnd).toBe(0);
  });

  it("running past the planned end reports how far past", () => {
    const p = preview(18, 5)!;
    expect(p.finishWeek).toBe(22);
    expect(p.weeksPastPlannedEnd).toBe(2);
    expect(p.finishesWithGroup).toBe(false);
    // The rhythm continues past the plan (2.7) — week 22 is 21 weeks on.
    expect(p.finishDate.toISOString().slice(0, 10)).toBe("2026-10-11");
  });

  it("week 1 for 1 week finishes on the cycle's own start date", () => {
    const p = preview(1, 1)!;
    expect(p.finishWeek).toBe(1);
    expect(p.finishDate.toISOString().slice(0, 10)).toBe("2026-05-17");
  });

  it("is null while either field is incomplete — nothing is shown mid-typing", () => {
    expect(preview(null, 6)).toBeNull();
    expect(preview(15, null)).toBeNull();
    expect(preview(null, null)).toBeNull();
    expect(preview(0, 6)).toBeNull();
    expect(preview(15, 0)).toBeNull();
  });

  it("is null for an unusable cycle start date rather than rendering Invalid Date", () => {
    expect(
      finishPreview({
        cycleStartDate: new Date(Number.NaN),
        plannedWeeks: PLANNED,
        startWeek: 15,
        weeksCommitted: 6,
      }),
    ).toBeNull();
  });
});

describe("the finish line — one sentence, identical on every surface", () => {
  it("reads exactly as the organizer asked", () => {
    expect(finishLine(preview(15, 6)!, formatDateLongUTC, PLANNED)).toBe(
      "Finishes week 20 — Sunday, September 27, 2026",
    );
  });

  it("names the overrun in the same breath when it runs long", () => {
    expect(finishLine(preview(18, 5)!, formatDateLongUTC, PLANNED)).toBe(
      "Finishes week 22 — Sunday, October 11, 2026 — 2 weeks past the planned 20",
    );
  });

  it("says 'week' not 'weeks' for a single week over", () => {
    expect(finishLine(preview(20, 2)!, formatDateLongUTC, PLANNED)).toContain(
      "1 week past the planned 20",
    );
  });

  it("infers the planned length when the caller does not pass it", () => {
    expect(finishLine(preview(18, 5)!, formatDateLongUTC)).toContain("past the planned 20");
  });
});

describe("commitmentCap — 2.22's cap and its override are UNCHANGED", () => {
  const cap = (startWeek: number | null, weeks: number | null, extend = false) =>
    commitmentCap({
      plannedWeeks: PLANNED,
      startWeek,
      weeksCommitted: weeks,
      extendPastPlannedEnd: extend,
    });

  it("offers exactly the remaining weeks", () => {
    expect(cap(15, 6)!.cap).toBe(6);
    expect(cap(1, 20)!.cap).toBe(20);
    expect(cap(20, 1)!.cap).toBe(1);
  });

  it("flags a figure above the cap", () => {
    expect(cap(15, 7)!.exceedsCap).toBe(true);
    expect(cap(15, 6)!.exceedsCap).toBe(false);
  });

  it("the explicit override clears the flag — the unusual path stays possible", () => {
    expect(cap(15, 12, true)!.exceedsCap).toBe(false);
  });

  it("past the planned end the cap is 0 and any figure needs the override", () => {
    const c = cap(25, 4)!;
    expect(c.cap).toBe(0);
    expect(c.exceedsCap).toBe(true);
    expect(cap(25, 4, true)!.exceedsCap).toBe(false);
  });

  it("is null without a start week, and never flags an empty weeks field", () => {
    expect(cap(null, 6)).toBeNull();
    expect(cap(15, null)!.exceedsCap).toBe(false);
  });
});

describe("cycleFinishPreview — a cycle's week 1 IS its start date", () => {
  it("a 20-week cycle finishes week 20 on the 20th week's date", () => {
    const c = cycleFinishPreview({ cycleStartDate: CYCLE_START, plannedWeeks: 20 })!;
    expect(c.finishWeek).toBe(20);
    expect(c.finishDate.toISOString().slice(0, 10)).toBe("2026-09-27");
    expect(c.weeksPastPlannedEnd).toBe(0);
    expect(c.finishesWithGroup).toBe(true);
  });

  it("is EXACTLY the member formula with startWeek 1 — one implementation, not two", () => {
    for (const planned of [1, 5, 20, 52]) {
      expect(cycleFinishPreview({ cycleStartDate: CYCLE_START, plannedWeeks: planned })).toEqual(
        finishPreview({
          cycleStartDate: CYCLE_START,
          plannedWeeks: planned,
          startWeek: 1,
          weeksCommitted: planned,
        }),
      );
    }
  });

  it("a one-week cycle finishes on its own start date", () => {
    const c = cycleFinishPreview({ cycleStartDate: CYCLE_START, plannedWeeks: 1 })!;
    expect(c.finishWeek).toBe(1);
    expect(c.finishDate.toISOString().slice(0, 10)).toBe("2026-05-17");
  });

  it("is null while the length is blank or unusable", () => {
    expect(cycleFinishPreview({ cycleStartDate: CYCLE_START, plannedWeeks: null })).toBeNull();
    expect(cycleFinishPreview({ cycleStartDate: CYCLE_START, plannedWeeks: 0 })).toBeNull();
    expect(
      cycleFinishPreview({ cycleStartDate: new Date(Number.NaN), plannedWeeks: 20 }),
    ).toBeNull();
  });

  it("says the same sentence the member surfaces say", () => {
    expect(
      finishLine(
        cycleFinishPreview({ cycleStartDate: CYCLE_START, plannedWeeks: 20 })!,
        formatDateLongUTC,
        20,
      ),
    ).toBe("Finishes week 20 — Sunday, September 27, 2026");
  });
});

describe("the two rules together — the wizard and the editor must agree", () => {
  it("changing the start week with the toggle ON moves the finish, never the group's end", () => {
    for (const start of [1, 5, 12, 15, 20]) {
      const weeks = weeksToFinishWithGroup(PLANNED, start);
      const p = preview(start, weeks)!;
      expect(p.finishWeek).toBe(PLANNED);
      expect(p.finishesWithGroup).toBe(true);
      expect(p.weeksPastPlannedEnd).toBe(0);
      expect(finishLine(p, formatDateLongUTC, PLANNED)).toBe(
        "Finishes week 20 — Sunday, September 27, 2026",
      );
    }
  });

  it("a custom figure still yields a correct finish — the line never disappears", () => {
    const p = preview(12, 3)!;
    expect(p.finishWeek).toBe(14);
    expect(finishLine(p, formatDateLongUTC, PLANNED)).toBe(
      "Finishes week 14 — Sunday, August 16, 2026",
    );
  });
});

// ————— THE STORED WEEK DATE WINS (2.14, 2.7) —————
//
// A Week row records what actually happened: the day money was due, the day a
// draw ran. A cycle's start date is editable and the existing rows are kept
// deliberately, so projecting over them would rewrite history — and two
// screens would show different dates for the same week.
describe("resolveWeekDate — the stored row beats the calculation", () => {
  // The cycle was created starting May 17, then the organizer corrected the
  // start date to May 24. Every existing week KEEPS its recorded date.
  const RECORDED = storedWeekDates([
    { weekNumber: 1, date: new Date(Date.UTC(2026, 4, 17)) },
    { weekNumber: 2, date: new Date(Date.UTC(2026, 4, 24)) },
    { weekNumber: 20, date: new Date(Date.UTC(2026, 8, 27)) },
  ]);
  const CORRECTED_START = new Date(Date.UTC(2026, 4, 24));

  it("reads the recorded day, not the one the new start date implies", () => {
    const r = resolveWeekDate({ weekNumber: 20, stored: RECORDED, cycleStartDate: CORRECTED_START })!;
    expect(r.source).toBe("stored");
    expect(r.date.toISOString().slice(0, 10)).toBe("2026-09-27");
    // What projecting would have said — the thing we must NOT show.
    expect(dateOfWeek(CORRECTED_START, 20).toISOString().slice(0, 10)).toBe("2026-10-04");
  });

  it("computes ONLY where no row exists — a week past the planned end", () => {
    const r = resolveWeekDate({ weekNumber: 22, stored: RECORDED, cycleStartDate: CORRECTED_START })!;
    expect(r.source).toBe("computed");
    expect(r.date.toISOString().slice(0, 10)).toBe(
      dateOfWeek(CORRECTED_START, 22).toISOString().slice(0, 10),
    );
  });

  it("computes when there are no rows at all — a cycle not generated yet", () => {
    const r = resolveWeekDate({ weekNumber: 5, stored: null, cycleStartDate: CYCLE_START })!;
    expect(r.source).toBe("computed");
  });

  it("ignores a corrupt stored value rather than rendering Invalid Date", () => {
    const broken = new Map([[3, new Date(Number.NaN)]]);
    const r = resolveWeekDate({ weekNumber: 3, stored: broken, cycleStartDate: CYCLE_START })!;
    expect(r.source).toBe("computed");
    expect(Number.isNaN(r.date.getTime())).toBe(false);
  });

  it("storedWeekDates drops unusable rows instead of trusting them", () => {
    const map = storedWeekDates([
      { weekNumber: 1, date: "2026-05-17T00:00:00.000Z" },
      { weekNumber: 2, date: "not-a-date" },
    ]);
    expect(map.get(1)?.toISOString().slice(0, 10)).toBe("2026-05-17");
    expect(map.has(2)).toBe(false);
  });
});

describe("after a start-date change, every surface shows the SAME date", () => {
  // The regression this ruling exists to prevent. The weeks page reads
  // Week.date directly; every finish line goes through finishPreview. Both
  // must land on the same day for the same week number.
  const WEEK_ROWS = [
    { weekNumber: 1, date: new Date(Date.UTC(2026, 4, 17)) },
    { weekNumber: 12, date: new Date(Date.UTC(2026, 6, 2)) },
    { weekNumber: 17, date: new Date(Date.UTC(2026, 7, 6)) },
    { weekNumber: 20, date: new Date(Date.UTC(2026, 8, 27)) },
  ];
  const STORED = storedWeekDates(WEEK_ROWS);
  // The organizer edits the cycle's start date. updateCycle keeps every
  // existing Week.date, so the rows above are unchanged.
  const NEW_START = new Date(Date.UTC(2026, 5, 7));

  /** What the WEEKS PAGE shows: the stored row, verbatim. */
  const weeksPageDate = (weekNumber: number) =>
    WEEK_ROWS.find((w) => w.weekNumber === weekNumber)!.date.toISOString().slice(0, 10);

  it("a member finish line matches the weeks page for the same week", () => {
    // Someone committed weeks 12..20 — their finish week is 20.
    const p = finishPreview({
      cycleStartDate: NEW_START,
      plannedWeeks: 20,
      startWeek: 12,
      weeksCommitted: 9,
      stored: STORED,
    })!;
    expect(p.finishWeek).toBe(20);
    expect(p.finishDateSource).toBe("stored");
    expect(p.finishDate.toISOString().slice(0, 10)).toBe(weeksPageDate(20));
  });

  it("a member finishing EARLY matches the weeks page too", () => {
    const p = finishPreview({
      cycleStartDate: NEW_START,
      plannedWeeks: 20,
      startWeek: 12,
      weeksCommitted: 6,
      stored: STORED,
    })!;
    expect(p.finishWeek).toBe(17);
    expect(p.finishDate.toISOString().slice(0, 10)).toBe(weeksPageDate(17));
  });

  it("the CYCLE finish line matches the weeks page's last row", () => {
    const c = cycleFinishPreview({
      cycleStartDate: NEW_START,
      plannedWeeks: 20,
      stored: STORED,
    })!;
    expect(c.finishDateSource).toBe("stored");
    expect(c.finishDate.toISOString().slice(0, 10)).toBe(weeksPageDate(20));
  });

  it("the member, the cycle and the weeks page agree to the day", () => {
    const member = finishPreview({
      cycleStartDate: NEW_START,
      plannedWeeks: 20,
      startWeek: 1,
      weeksCommitted: 20,
      stored: STORED,
    })!;
    const cycle = cycleFinishPreview({
      cycleStartDate: NEW_START,
      plannedWeeks: 20,
      stored: STORED,
    })!;
    expect(member.finishDate.toISOString()).toBe(cycle.finishDate.toISOString());
    expect(member.finishDate.toISOString().slice(0, 10)).toBe(weeksPageDate(20));
  });

  it("WITHOUT the stored rows they would disagree — this is the bug being fixed", () => {
    const projected = finishPreview({
      cycleStartDate: NEW_START,
      plannedWeeks: 20,
      startWeek: 12,
      weeksCommitted: 9,
    })!;
    expect(projected.finishDateSource).toBe("computed");
    expect(projected.finishDate.toISOString().slice(0, 10)).not.toBe(weeksPageDate(20));
  });

  it("the sentence itself quotes the stored day", () => {
    const p = finishPreview({
      cycleStartDate: NEW_START,
      plannedWeeks: 20,
      startWeek: 12,
      weeksCommitted: 9,
      stored: STORED,
    })!;
    expect(finishLine(p, formatDateLongUTC, 20)).toBe(
      "Finishes week 20 — Sunday, September 27, 2026",
    );
  });

  it("a commitment running PAST the rows still computes those weeks only", () => {
    const p = finishPreview({
      cycleStartDate: NEW_START,
      plannedWeeks: 20,
      startWeek: 20,
      weeksCommitted: 3,
      stored: STORED,
    })!;
    expect(p.finishWeek).toBe(22);
    expect(p.finishDateSource).toBe("computed");
    expect(p.weeksPastPlannedEnd).toBe(2);
  });
});
