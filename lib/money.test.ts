import { describe, expect, it } from "vitest";
import {
  calculateFee,
  calculateFinishWeek,
  calculateGross,
  calculateNet,
  currentWeekNumber,
  dateOfWeek,
  generateWeekDates,
  remainingWeeksInCycle,
  splitIntoLuckyNumbers,
} from "./money";

const UNIT = 100_000; // $1,000 in cents

describe("splitIntoLuckyNumbers", () => {
  it("keeps an amount below the unit as one number", () => {
    expect(splitIntoLuckyNumbers(50_000, UNIT)).toEqual([50_000]);
  });

  it("keeps an amount exactly at the unit as one number", () => {
    expect(splitIntoLuckyNumbers(100_000, UNIT)).toEqual([100_000]);
  });

  it("splits above the unit into a full unit plus remainder", () => {
    expect(splitIntoLuckyNumbers(125_000, UNIT)).toEqual([100_000, 25_000]);
    expect(splitIntoLuckyNumbers(175_000, UNIT)).toEqual([100_000, 75_000]);
  });

  it("splits exact multiples into full units with no remainder number", () => {
    expect(splitIntoLuckyNumbers(200_000, UNIT)).toEqual([100_000, 100_000]);
    expect(splitIntoLuckyNumbers(300_000, UNIT)).toEqual([100_000, 100_000, 100_000]);
  });

  it("works with a different unit size (nothing hardcoded)", () => {
    expect(splitIntoLuckyNumbers(125_000, 50_000)).toEqual([50_000, 50_000, 25_000]);
    expect(splitIntoLuckyNumbers(25_000, 50_000)).toEqual([25_000]);
  });

  it("always sums back to the weekly amount", () => {
    for (const weekly of [1, 25_000, 100_000, 100_001, 175_000, 999_999]) {
      const parts = splitIntoLuckyNumbers(weekly, UNIT);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(weekly);
    }
  });

  it("rejects zero, negative, and fractional amounts", () => {
    expect(() => splitIntoLuckyNumbers(0, UNIT)).toThrow(RangeError);
    expect(() => splitIntoLuckyNumbers(-100, UNIT)).toThrow(RangeError);
    expect(() => splitIntoLuckyNumbers(100.5, UNIT)).toThrow(RangeError);
    expect(() => splitIntoLuckyNumbers(50_000, 0)).toThrow(RangeError);
  });

  it("refuses to create an absurd number of lucky numbers (guard, no allocation)", () => {
    expect(splitIntoLuckyNumbers(100, 1)).toHaveLength(100);
    expect(() => splitIntoLuckyNumbers(101, 1)).toThrow(RangeError);
    expect(() => splitIntoLuckyNumbers(2_147_483_647, 1)).toThrow(RangeError);
  });
});

describe("calculateGross", () => {
  it("multiplies weekly amount by weeks committed", () => {
    expect(calculateGross(50_000, 20)).toBe(1_000_000); // $500/wk x 20 = $10,000
    expect(calculateGross(50_000, 9)).toBe(450_000); // $500/wk x 9 = $4,500
  });

  it("handles zero weeks and zero amount", () => {
    expect(calculateGross(50_000, 0)).toBe(0);
    expect(calculateGross(0, 20)).toBe(0);
  });

  it("rejects fractional cents and negative weeks", () => {
    expect(() => calculateGross(100.5, 10)).toThrow(RangeError);
    expect(() => calculateGross(100, -1)).toThrow(RangeError);
  });
});

describe("calculateFee", () => {
  it("matches the ground-truth example: $100 per $5,000 at 2%", () => {
    expect(calculateFee(500_000, 2)).toBe(10_000);
  });

  it("computes the Alem example: 2% of $4,500 is $90", () => {
    expect(calculateFee(450_000, 2)).toBe(9_000);
  });

  it("rounds to whole cents", () => {
    expect(calculateFee(12_345, 2)).toBe(247); // 246.9 rounds up
    expect(calculateFee(12_320, 2)).toBe(246); // 246.4 rounds down
  });

  it("handles zero gross and zero percent", () => {
    expect(calculateFee(0, 2)).toBe(0);
    expect(calculateFee(500_000, 0)).toBe(0);
  });

  it("accepts fractional percents", () => {
    expect(calculateFee(100_000, 2.5)).toBe(2_500);
  });

  it("rounds half-cent ties up even when floating point would misround", () => {
    // 20500 * 0.7% = 143.5 exactly; naive float math gives 143.49999999999997
    expect(calculateFee(20_500, 0.7)).toBe(144);
    expect(calculateFee(5_500, 0.7)).toBe(39); // 38.5 -> 39
    expect(calculateFee(75, 2)).toBe(2); // 1.5 -> 2
  });

  it("rejects negative gross and non-finite percent", () => {
    expect(() => calculateFee(-1, 2)).toThrow(RangeError);
    expect(() => calculateFee(100, Number.NaN)).toThrow(RangeError);
    expect(() => calculateFee(100, -2)).toThrow(RangeError);
  });
});

describe("calculateNet", () => {
  it("computes the Alem example: $4,500 - $90 = $4,410", () => {
    expect(calculateNet(450_000, 9_000)).toBe(441_000);
  });

  it("handles a zero fee", () => {
    expect(calculateNet(450_000, 0)).toBe(450_000);
  });

  it("rejects a fee larger than gross", () => {
    expect(() => calculateNet(100, 101)).toThrow(RangeError);
  });
});

describe("calculateFinishWeek", () => {
  it("computes finish week inclusively", () => {
    expect(calculateFinishWeek(1, 20)).toBe(20);
    expect(calculateFinishWeek(12, 9)).toBe(20); // the Alem example: weeks 12 to 20
    expect(calculateFinishWeek(5, 1)).toBe(5); // one week: starts and finishes week 5
  });

  it("can run past the planned length (2.7: track the truth)", () => {
    expect(calculateFinishWeek(15, 10)).toBe(24);
  });

  it("rejects a start week before week 1 (D-20)", () => {
    expect(() => calculateFinishWeek(0, 10)).toThrow(RangeError);
    expect(() => calculateFinishWeek(-3, 10)).toThrow(RangeError);
  });

  it("rejects zero weeks committed", () => {
    expect(() => calculateFinishWeek(1, 0)).toThrow(RangeError);
  });
});

describe("remainingWeeksInCycle (2.22 / D-31: late joiners capped to the cycle end)", () => {
  it("the ground-truth example: joining at week 15 of 20 offers at most 6 weeks", () => {
    expect(remainingWeeksInCycle(20, 15)).toBe(6);
  });

  it("covers the full cycle from week 1 and one week at the end", () => {
    expect(remainingWeeksInCycle(20, 1)).toBe(20);
    expect(remainingWeeksInCycle(20, 20)).toBe(1);
  });

  it("is 0 once the planned end has passed (override required to extend)", () => {
    expect(remainingWeeksInCycle(20, 21)).toBe(0);
    expect(remainingWeeksInCycle(20, 25)).toBe(0);
  });

  it("rejects invalid inputs", () => {
    expect(() => remainingWeeksInCycle(0, 1)).toThrow(RangeError);
    expect(() => remainingWeeksInCycle(20, 0)).toThrow(RangeError);
  });
});

describe("generateWeekDates", () => {
  const start = new Date("2026-05-17T00:00:00.000Z");

  it("matches the spec preview: 20 weeks, May 17 2026 to Sep 27 2026", () => {
    const dates = generateWeekDates(start, 20);
    expect(dates).toHaveLength(20);
    expect(dates[0].toISOString()).toBe("2026-05-17T00:00:00.000Z");
    expect(dates[19].toISOString()).toBe("2026-09-27T00:00:00.000Z");
  });

  it("spaces every week exactly 7 days apart", () => {
    const dates = generateWeekDates(start, 20);
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i].getTime() - dates[i - 1].getTime()).toBe(7 * 86_400_000);
    }
  });

  it("handles a one-week cycle", () => {
    expect(generateWeekDates(start, 1)).toEqual([start]);
  });

  it("rejects zero weeks and invalid dates", () => {
    expect(() => generateWeekDates(start, 0)).toThrow(RangeError);
    expect(() => generateWeekDates(new Date("nonsense"), 5)).toThrow(RangeError);
  });

  it("rejects week counts beyond the sanity guard", () => {
    expect(() => generateWeekDates(start, 1_001)).toThrow(RangeError);
  });
});

describe("dateOfWeek", () => {
  const start = new Date("2026-05-17T00:00:00.000Z");

  it("week 1 is the start date; week 20 matches the generated final week", () => {
    expect(dateOfWeek(start, 1).toISOString()).toBe("2026-05-17T00:00:00.000Z");
    expect(dateOfWeek(start, 20).toISOString()).toBe("2026-09-27T00:00:00.000Z");
  });

  it("keeps the 7-day rhythm past the planned end (2.22 override weeks)", () => {
    expect(dateOfWeek(start, 22).toISOString()).toBe("2026-10-11T00:00:00.000Z");
  });

  it("agrees with generateWeekDates for every week", () => {
    const dates = generateWeekDates(start, 20);
    for (let n = 1; n <= 20; n++) {
      expect(dateOfWeek(start, n).getTime()).toBe(dates[n - 1].getTime());
    }
  });

  it("rejects week 0", () => {
    expect(() => dateOfWeek(start, 0)).toThrow(RangeError);
  });
});

describe("currentWeekNumber", () => {
  const start = new Date("2026-05-17T00:00:00.000Z");
  const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);

  it("is week 1 on the start date and through day 6", () => {
    expect(currentWeekNumber(start, utc("2026-05-17"))).toBe(1);
    expect(currentWeekNumber(start, utc("2026-05-23"))).toBe(1);
  });

  it("rolls to week 2 exactly 7 days in", () => {
    expect(currentWeekNumber(start, utc("2026-05-24"))).toBe(2);
  });

  it("is 0 before the cycle starts", () => {
    expect(currentWeekNumber(start, utc("2026-05-16"))).toBe(0);
    expect(currentWeekNumber(start, utc("2020-01-01"))).toBe(0);
  });

  it("reaches week 20 on the planned final week date", () => {
    expect(currentWeekNumber(start, utc("2026-09-27"))).toBe(20);
    expect(currentWeekNumber(start, utc("2026-10-03"))).toBe(20);
  });

  it("keeps counting past the planned length (2.7: track the truth)", () => {
    expect(currentWeekNumber(start, utc("2026-10-04"))).toBe(21);
  });

  it("ignores the time of day within a date", () => {
    expect(currentWeekNumber(start, new Date("2026-05-23T23:59:59.000Z"))).toBe(1);
    expect(currentWeekNumber(start, new Date("2026-05-24T00:00:01.000Z"))).toBe(2);
  });

  it("is unaffected by DST transitions (UTC calendar days)", () => {
    // North American DST began 2026-03-08; a local-time diff would be 6.96 days
    expect(currentWeekNumber(utc("2026-03-01"), utc("2026-03-08"))).toBe(2);
    expect(currentWeekNumber(utc("2026-03-01"), utc("2026-03-15"))).toBe(3);
  });
});
