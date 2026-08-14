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
