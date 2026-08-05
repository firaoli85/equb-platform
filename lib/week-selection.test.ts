import { describe, expect, it } from "vitest";
import {
  isSelectable,
  oldestN,
  parseWeekRange,
  selectableWeekNumbers,
  weeksInRange,
  type SelectableWeek,
} from "./week-selection";

const wk = (
  weekNumber: number,
  over: Partial<Omit<SelectableWeek, "weekNumber">> = {},
): SelectableWeek => ({
  weekNumber,
  amountDue: 50_000,
  amountAlreadyPaid: 0,
  isDeferred: false,
  ...over,
});

const WEEKS: SelectableWeek[] = [
  wk(1, { amountAlreadyPaid: 50_000 }), // paid
  wk(2), // owing
  wk(3, { isDeferred: true }), // excused
  wk(4, { amountAlreadyPaid: 20_000 }), // partial → owing
  wk(5), // owing
  wk(6), // owing
];

describe("isSelectable — only owed, unexcused weeks", () => {
  it("excludes paid and deferred weeks; includes partial and unpaid", () => {
    expect(selectableWeekNumbers(WEEKS)).toEqual([2, 4, 5, 6]);
    expect(isSelectable(wk(9, { amountAlreadyPaid: 50_000 }))).toBe(false);
    expect(isSelectable(wk(9, { isDeferred: true }))).toBe(false);
  });
});

describe("parseWeekRange — every human way of writing a range", () => {
  it("parses 'to', hyphen, en dash, dots, and single weeks", () => {
    expect(parseWeekRange("7 to 12")).toEqual({ from: 7, to: 12 });
    expect(parseWeekRange("7-12")).toEqual({ from: 7, to: 12 });
    expect(parseWeekRange("7–12")).toEqual({ from: 7, to: 12 });
    expect(parseWeekRange("7..12")).toEqual({ from: 7, to: 12 });
    expect(parseWeekRange("9")).toEqual({ from: 9, to: 9 });
  });

  it("is order-forgiving and rejects non-ranges", () => {
    expect(parseWeekRange("12 to 7")).toEqual({ from: 7, to: 12 });
    expect(parseWeekRange("")).toBeNull();
    expect(parseWeekRange("week seven")).toBeNull();
    expect(parseWeekRange("0-3")).toBeNull();
  });
});

describe("weeksInRange — paid/excused weeks never sneak into a range", () => {
  it("returns only selectable weeks inside the range", () => {
    expect(weeksInRange(WEEKS, { from: 1, to: 4 })).toEqual([2, 4]);
    expect(weeksInRange(WEEKS, { from: 5, to: 6 })).toEqual([5, 6]);
    expect(weeksInRange(WEEKS, { from: 3, to: 3 })).toEqual([]);
  });
});

describe("oldestN — oldest debt first (2.15's spirit)", () => {
  it("takes the N oldest owing weeks", () => {
    expect(oldestN(WEEKS, 3)).toEqual([2, 4, 5]);
    expect(oldestN(WEEKS, 99)).toEqual([2, 4, 5, 6]);
    expect(oldestN(WEEKS, 0)).toEqual([]);
  });
});
