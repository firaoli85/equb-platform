import { describe, expect, it } from "vitest";
import {
  memberWeekLabel,
  memberWeeksPhrase,
  memberWeeksPhraseFromCycleWeeks,
  ownWeekNumber,
} from "./member-week-dates";

// THE COMPOSER, table-tested (switchover build, 2.24). Every date is a real
// Cycle 1 2026 Sunday — 17 May 2026 + 7n — because a fixture that does not
// resemble production hides the bug it was written to catch (§5.1).

const sunday = (cycleWeek: number) => new Date(Date.UTC(2026, 4, 17 + (cycleWeek - 1) * 7));

/** Cycle weeks 1..23 with their stored dates, as the callers hold them. */
const DATES = new Map(Array.from({ length: 23 }, (_, i) => [i + 1, sunday(i + 1)]));

describe("the member's own numbering", () => {
  it("a founding member's numbers coincide with the cycle's", () => {
    expect(ownWeekNumber(14, 1)).toBe(14);
  });
  it("a mid-cycle joiner counts from their own start", () => {
    // Henok: startWeek 14 — cycle week 14 is HIS week 1.
    expect(ownWeekNumber(14, 14)).toBe(1);
    expect(ownWeekNumber(23, 14)).toBe(10);
  });
});

describe("the phrase, case by case", () => {
  it("a single week: number and its date", () => {
    expect(memberWeekLabel({ ownWeek: 2, date: sunday(15) })).toBe("2 (Aug 23)");
    expect(memberWeeksPhrase([{ ownWeek: 2, date: sunday(15) }])).toBe("2 (Aug 23)");
  });

  it("a contiguous range collapses: first–last with first and last dates", () => {
    expect(
      memberWeeksPhrase([
        { ownWeek: 2, date: sunday(15) },
        { ownWeek: 3, date: sunday(16) },
      ]),
    ).toBe("2–3 (Aug 23 – Aug 30)");
  });

  it("a non-contiguous list joins with 'and'", () => {
    expect(
      memberWeeksPhrase([
        { ownWeek: 2, date: sunday(15) },
        { ownWeek: 4, date: sunday(17) },
      ]),
    ).toBe("2 (Aug 23) and 4 (Sep 6)");
  });

  it("runs and singles mix, comma-joined with a final 'and'", () => {
    expect(
      memberWeeksPhrase([
        { ownWeek: 2, date: sunday(15) },
        { ownWeek: 3, date: sunday(16) },
        { ownWeek: 5, date: sunday(18) },
        { ownWeek: 8, date: sunday(21) },
        { ownWeek: 9, date: sunday(22) },
      ]),
    ).toBe("2–3 (Aug 23 – Aug 30), 5 (Sep 13) and 8–9 (Oct 4 – Oct 11)");
  });

  it("a paid-ahead multi-week span is one clean range", () => {
    // Five weeks paid at once, weeks 6–10 of their own counting.
    expect(
      memberWeeksPhrase(Array.from({ length: 5 }, (_, i) => ({ ownWeek: 6 + i, date: sunday(19 + i) }))),
    ).toBe("6–10 (Sep 20 – Oct 18)");
  });

  it("unsorted, duplicated input composes identically", () => {
    expect(
      memberWeeksPhrase([
        { ownWeek: 3, date: sunday(16) },
        { ownWeek: 2, date: sunday(15) },
        { ownWeek: 3, date: sunday(16) },
      ]),
    ).toBe("2–3 (Aug 23 – Aug 30)");
  });

  it("zero weeks compose to nothing — the extras boundary upstream is the judge", () => {
    expect(memberWeeksPhrase([])).toBe("");
  });
});

// THE ONE THAT IS THE POINT: same calendar dates, different members,
// different numbers. The group calendar never leaks into either.
describe("a founding member and a mid-cycle joiner on the SAME dates", () => {
  const cycleWeeks = [14, 15];

  it("the founding member reads 14–15; Henok reads 1–2 — dates identical", () => {
    const founder = memberWeeksPhraseFromCycleWeeks({
      cycleWeeks,
      startWeek: 1,
      weekDates: DATES,
    });
    const henok = memberWeeksPhraseFromCycleWeeks({
      cycleWeeks,
      startWeek: 14,
      weekDates: DATES,
    });
    expect(founder).toBe("14–15 (Aug 16 – Aug 23)");
    expect(henok).toBe("1–2 (Aug 16 – Aug 23)");
  });

  it("a week with no stored date STOPS the composition — never a projected day (rule 7)", () => {
    expect(() =>
      memberWeeksPhraseFromCycleWeeks({
        cycleWeeks: [24],
        startWeek: 14,
        weekDates: DATES,
      }),
    ).toThrow(/No stored date for cycle week 24/);
  });
});

// ————————————————————————————————————————————————————————————————
// THE v3 FORMS (14 Aug 2026): full dates for the anchors, plain
// enumeration for lists — no ranges, NO DASHES (the organizer's standing
// rule for member-facing text). Table-tested per the cutover order:
// normal, founding vs mid-joiner, single vs multiple late weeks.
// ————————————————————————————————————————————————————————————————
import { memberFullDate, memberWeekLabelFull, memberWeeksListPhrase, memberWeeksListPhraseFromCycleWeeks } from "./member-week-dates";

describe("v3 full-date labels", () => {
  it("writes the weekday and month out, with no year", () => {
    // Cycle week 11 is Sunday, July 26 2026 — the order's own sample.
    expect(memberFullDate(sunday(11))).toBe("Sunday, July 26");
    expect(memberWeekLabelFull({ ownWeek: 11, date: sunday(11) })).toBe("11 (Sunday, July 26)");
  });

  it("a mid-joiner's anchor carries THEIR number with the same calendar date", () => {
    // Henok: cycle week 14 is his week 1 — same Sunday, different number.
    expect(memberWeekLabelFull({ ownWeek: ownWeekNumber(14, 14), date: sunday(14) })).toBe(
      "1 (Sunday, August 16)",
    );
    // The founding member's anchor for the same calendar day.
    expect(memberWeekLabelFull({ ownWeek: ownWeekNumber(14, 1), date: sunday(14) })).toBe(
      "14 (Sunday, August 16)",
    );
  });

  it("carries no dash of any kind", () => {
    const label = memberWeekLabelFull({ ownWeek: 11, date: sunday(11) });
    expect(label).not.toContain("—");
    expect(label).not.toContain("–");
  });
});

describe("v3 late-weeks list", () => {
  it("a single late week: number and short date", () => {
    expect(memberWeeksListPhrase([{ ownWeek: 12, date: sunday(12) }])).toBe("12 (Aug 2)");
  });

  it("two late weeks: numbers joined with 'and', dates grouped in ONE bracket", () => {
    // The order's sample, verbatim.
    expect(
      memberWeeksListPhrase([
        { ownWeek: 12, date: sunday(12) },
        { ownWeek: 13, date: sunday(13) },
      ]),
    ).toBe("12 and 13 (Aug 2 and Aug 9)");
  });

  it("three or more: commas then a final 'and' — never a range, never a dash", () => {
    const phrase = memberWeeksListPhrase([
      { ownWeek: 12, date: sunday(12) },
      { ownWeek: 13, date: sunday(13) },
      { ownWeek: 14, date: sunday(14) },
    ]);
    expect(phrase).toBe("12, 13 and 14 (Aug 2, Aug 9 and Aug 16)");
    expect(phrase).not.toContain("–");
    expect(phrase).not.toContain("—");
  });

  it("sorts, dedupes, and keeps non-contiguous weeks as a plain list", () => {
    expect(
      memberWeeksListPhrase([
        { ownWeek: 14, date: sunday(14) },
        { ownWeek: 12, date: sunday(12) },
        { ownWeek: 12, date: sunday(12) },
      ]),
    ).toBe("12 and 14 (Aug 2 and Aug 16)");
  });

  it("from cycle weeks: a mid-joiner's late list wears THEIR numbering", () => {
    // Henok late in cycle weeks 15 and 16 — his weeks 2 and 3.
    expect(
      memberWeeksListPhraseFromCycleWeeks({ cycleWeeks: [15, 16], startWeek: 14, weekDates: DATES }),
    ).toBe("2 and 3 (Aug 23 and Aug 30)");
  });

  it("still refuses a week with no stored date — rule 7 holds in the v3 form", () => {
    expect(() =>
      memberWeeksListPhraseFromCycleWeeks({ cycleWeeks: [99], startWeek: 1, weekDates: DATES }),
    ).toThrow(/No stored date/);
  });
});
