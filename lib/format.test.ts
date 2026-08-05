import { describe, expect, it } from "vitest";
import { formatDateUTC, formatMoney, parseDateInput, parseDollarsToCents } from "./format";

describe("parseDollarsToCents", () => {
  it("parses plain dollar amounts", () => {
    expect(parseDollarsToCents("1250")).toBe(125_000);
    expect(parseDollarsToCents("0")).toBe(0);
    expect(parseDollarsToCents("1250.50")).toBe(125_050);
    expect(parseDollarsToCents("1250.5")).toBe(125_050);
    expect(parseDollarsToCents("0.5")).toBe(50);
  });

  it("accepts $ and legal thousands grouping", () => {
    expect(parseDollarsToCents("$1,250")).toBe(125_000);
    expect(parseDollarsToCents("1,250.50")).toBe(125_050);
    expect(parseDollarsToCents("$12,345,678.90")).toBe(1_234_567_890);
    expect(parseDollarsToCents(" 1250 ")).toBe(125_000);
  });

  it("rejects a decimal-comma slip instead of parsing 100x the amount", () => {
    expect(parseDollarsToCents("1250,50")).toBeNull();
    expect(parseDollarsToCents("12,5")).toBeNull();
    expect(parseDollarsToCents("1,2,5,0")).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(parseDollarsToCents("")).toBeNull();
    expect(parseDollarsToCents("abc")).toBeNull();
    expect(parseDollarsToCents("1 250")).toBeNull();
    expect(parseDollarsToCents("12.345")).toBeNull();
    expect(parseDollarsToCents("-5")).toBeNull();
    expect(parseDollarsToCents("$")).toBeNull();
    expect(parseDollarsToCents("1250.")).toBeNull();
  });
});

describe("formatMoney", () => {
  it("omits cents for whole dollars", () => {
    expect(formatMoney(0)).toBe("$0");
    expect(formatMoney(100_000)).toBe("$1,000");
    expect(formatMoney(125_000)).toBe("$1,250");
  });

  it("shows two-digit cents otherwise", () => {
    expect(formatMoney(50)).toBe("$0.50");
    expect(formatMoney(125_050)).toBe("$1,250.50");
    expect(formatMoney(125_005)).toBe("$1,250.05");
  });

  it("handles negatives", () => {
    expect(formatMoney(-125_000)).toBe("-$1,250");
    expect(formatMoney(-50)).toBe("-$0.50");
  });

  it("round-trips with parseDollarsToCents", () => {
    for (const cents of [0, 50, 100, 99_999, 125_050, 2_147_483_647]) {
      expect(parseDollarsToCents(formatMoney(cents))).toBe(cents);
    }
  });
});

describe("formatDateUTC", () => {
  it("renders the UTC calendar day", () => {
    expect(formatDateUTC(new Date("2026-05-17T00:00:00.000Z"))).toBe("May 17, 2026");
    // Late-evening UTC must not roll into the next local day
    expect(formatDateUTC(new Date("2026-05-17T23:30:00.000Z"))).toBe("May 17, 2026");
  });
});

describe("parseDateInput", () => {
  it("parses a date-input value to UTC midnight", () => {
    expect(parseDateInput("2026-05-17")?.toISOString()).toBe("2026-05-17T00:00:00.000Z");
  });

  it("rejects impossible and malformed dates", () => {
    expect(parseDateInput("2026-02-30")).toBeNull();
    expect(parseDateInput("17-05-2026")).toBeNull();
    expect(parseDateInput("2026-5-7")).toBeNull();
    expect(parseDateInput("")).toBeNull();
  });
});
