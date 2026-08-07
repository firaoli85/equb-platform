import { describe, expect, it } from "vitest";
import {
  defaultWithinBounds,
  isWithinBounds,
  moneyReceivedBounds,
  newCycleStartBounds,
  outOfBoundsMessage,
  parseIsoDay,
  todayIsoDay,
  weekDateBounds,
} from "./date-bounds";

// A date must make sense for its context. The rule these tests pin hardest:
// every bound carries a REASON, because a disabled calendar with no
// explanation reads as a broken app.

const AUG_6 = new Date(2026, 7, 6); // local-time "today" for the tests
const SEP_27 = new Date(Date.UTC(2026, 8, 27));

describe("parsing", () => {
  it("accepts a real day and rejects one that only looks real", () => {
    expect(parseIsoDay("2026-08-06")).toEqual(new Date(Date.UTC(2026, 7, 6)));
    // Date would silently roll this into March; the picker must not.
    expect(parseIsoDay("2026-02-31")).toBeNull();
    expect(parseIsoDay("not-a-date")).toBeNull();
    expect(parseIsoDay("")).toBeNull();
    expect(parseIsoDay(null)).toBeNull();
  });

  it("reads today from the supplied clock, so tests do not drift", () => {
    expect(todayIsoDay(AUG_6)).toBe("2026-08-06");
  });
});

describe("isWithinBounds", () => {
  it("is inclusive at both ends", () => {
    const bounds = { min: "2026-08-06", max: "2026-09-27" };
    expect(isWithinBounds("2026-08-06", bounds)).toBe(true);
    expect(isWithinBounds("2026-09-27", bounds)).toBe(true);
    expect(isWithinBounds("2026-08-05", bounds)).toBe(false);
    expect(isWithinBounds("2026-09-28", bounds)).toBe(false);
  });

  it("allows anything when there are no bounds — most dates are unbounded", () => {
    expect(isWithinBounds("1999-01-01", null)).toBe(true);
    expect(isWithinBounds("2099-01-01", {})).toBe(true);
  });

  it("never allows a day that is not a real date, bounds or not", () => {
    expect(isWithinBounds("2026-02-31", null)).toBe(false);
    expect(isWithinBounds("", null)).toBe(false);
  });

  it("compares across year and month boundaries correctly", () => {
    // The implementation compares ISO strings; this is the test that keeps
    // that honest if anyone changes it to numeric parsing.
    expect(isWithinBounds("2027-01-01", { min: "2026-12-31" })).toBe(true);
    expect(isWithinBounds("2026-09-02", { min: "2026-09-10" })).toBe(false);
  });
});

describe("the new-cycle rule", () => {
  it("cannot start in the past when no cycle is active", () => {
    const bounds = newCycleStartBounds({ now: AUG_6, activeCycle: null });
    expect(bounds.min).toBe("2026-08-06");
    expect(isWithinBounds("2026-08-05", bounds)).toBe(false);
    expect(isWithinBounds("2026-08-06", bounds)).toBe(true);
    expect(bounds.reason).toContain("cannot begin in the past");
  });

  it("cannot start before the ACTIVE cycle's final week", () => {
    const bounds = newCycleStartBounds({
      now: AUG_6,
      activeCycle: {
        name: "Cycle 1 2026",
        finalWeekDate: SEP_27,
        finalWeekLabel: "Sunday, September 27, 2026",
      },
    });
    expect(bounds.min).toBe("2026-09-27");
    // Today is inside the active cycle, so today is refused too.
    expect(isWithinBounds("2026-08-06", bounds)).toBe(false);
    expect(isWithinBounds("2026-09-26", bounds)).toBe(false);
    expect(isWithinBounds("2026-09-27", bounds)).toBe(true);
    expect(isWithinBounds("2026-10-04", bounds)).toBe(true);
  });

  it("names the cycle and the date — the organizer can act on this sentence", () => {
    const bounds = newCycleStartBounds({
      now: AUG_6,
      activeCycle: {
        name: "Cycle 1 2026",
        finalWeekDate: SEP_27,
        finalWeekLabel: "Sunday, September 27, 2026",
      },
    });
    expect(bounds.reason).toBe(
      "Cycle 1 2026 runs until Sunday, September 27, 2026. A new cycle cannot start before then.",
    );
  });

  it("falls back to 'not in the past' once the active cycle has already ended", () => {
    // A cycle still marked ACTIVE whose last week is behind us: the overlap
    // rule no longer bites, so the past rule is the honest reason to show.
    const bounds = newCycleStartBounds({
      now: new Date(2026, 9, 15),
      activeCycle: {
        name: "Cycle 1 2026",
        finalWeekDate: SEP_27,
        finalWeekLabel: "Sunday, September 27, 2026",
      },
    });
    expect(bounds.min).toBe("2026-10-15");
    expect(bounds.reason).toContain("cannot begin in the past");
  });

  it("always carries a reason — a bound without one is the bug this prevents", () => {
    for (const active of [
      null,
      { name: "C", finalWeekDate: SEP_27, finalWeekLabel: "Sunday, September 27, 2026" },
    ]) {
      const bounds = newCycleStartBounds({ now: AUG_6, activeCycle: active });
      expect(bounds.reason, "every bound must explain itself").toBeTruthy();
      expect(outOfBoundsMessage(bounds)).toBe(bounds.reason);
    }
  });
});

describe("money-received dates", () => {
  it("allows today and refuses tomorrow", () => {
    const bounds = moneyReceivedBounds(AUG_6);
    expect(isWithinBounds("2026-08-06", bounds)).toBe(true);
    expect(isWithinBounds("2026-08-07", bounds)).toBe(false);
  });

  it("leaves BACK-dating completely free — money is often recorded late", () => {
    const bounds = moneyReceivedBounds(AUG_6);
    expect(isWithinBounds("2026-01-01", bounds)).toBe(true);
    expect(isWithinBounds("2019-06-30", bounds)).toBe(true);
    expect(bounds.min ?? null).toBeNull();
  });

  it("explains itself", () => {
    expect(moneyReceivedBounds(AUG_6).reason).toBe("Money can only be recorded on or before today.");
  });
});

describe("week dates stay in sequence", () => {
  const week11 = { weekNumber: 11, date: new Date(Date.UTC(2026, 7, 2)) };
  const week13 = { weekNumber: 13, date: new Date(Date.UTC(2026, 7, 16)) };

  it("must fall strictly between its neighbours", () => {
    const bounds = weekDateBounds({ previousWeek: week11, nextWeek: week13 });
    expect(isWithinBounds("2026-08-09", bounds)).toBe(true); // the natural slot
    // Sharing a date with a neighbour would make "which closed first"
    // unanswerable, so the bounds exclude both endpoints.
    expect(isWithinBounds("2026-08-02", bounds)).toBe(false);
    expect(isWithinBounds("2026-08-16", bounds)).toBe(false);
    expect(isWithinBounds("2026-08-03", bounds)).toBe(true);
    expect(isWithinBounds("2026-08-15", bounds)).toBe(true);
  });

  it("bounds the FIRST week on one side only — a cycle can move earlier", () => {
    const bounds = weekDateBounds({ previousWeek: null, nextWeek: week13 });
    expect(bounds.min ?? null).toBeNull();
    expect(isWithinBounds("2020-01-01", bounds)).toBe(true);
    expect(isWithinBounds("2026-08-16", bounds)).toBe(false);
  });

  it("bounds the LAST week on one side only — a cycle can run long (2.7)", () => {
    const bounds = weekDateBounds({ previousWeek: week11, nextWeek: null });
    expect(bounds.max ?? null).toBeNull();
    expect(isWithinBounds("2030-01-01", bounds)).toBe(true);
    expect(isWithinBounds("2026-08-02", bounds)).toBe(false);
  });

  it("names the neighbouring weeks, so the refusal is actionable", () => {
    expect(weekDateBounds({ previousWeek: week11, nextWeek: week13 }).reason).toBe(
      "Weeks run in order, so this one must fall after week 11 (2026-08-02) and before week 13 (2026-08-16).",
    );
  });

  it("a lone week is unbounded and says nothing", () => {
    const bounds = weekDateBounds({});
    expect(bounds.reason).toBeNull();
    expect(isWithinBounds("2026-08-09", bounds)).toBe(true);
  });
});

describe("the default the picker opens on", () => {
  it("is today when today is allowed — never blank", () => {
    expect(defaultWithinBounds({ min: "2026-01-01" }, AUG_6)).toBe("2026-08-06");
    expect(defaultWithinBounds(null, AUG_6)).toBe("2026-08-06");
  });

  it("is the earliest allowed day when today is too early", () => {
    const bounds = newCycleStartBounds({
      now: AUG_6,
      activeCycle: {
        name: "Cycle 1 2026",
        finalWeekDate: SEP_27,
        finalWeekLabel: "Sunday, September 27, 2026",
      },
    });
    // The first sensible date — the day the new cycle actually could begin.
    expect(defaultWithinBounds(bounds, AUG_6)).toBe("2026-09-27");
    expect(isWithinBounds(defaultWithinBounds(bounds, AUG_6), bounds)).toBe(true);
  });

  it("is the latest allowed day when today is too late", () => {
    expect(defaultWithinBounds({ max: "2026-07-01" }, AUG_6)).toBe("2026-07-01");
  });

  it("always returns a day the bounds accept", () => {
    const cases = [
      null,
      { min: "2026-09-27" },
      { max: "2026-07-01" },
      { min: "2026-01-01", max: "2026-12-31" },
    ];
    for (const bounds of cases) {
      expect(isWithinBounds(defaultWithinBounds(bounds, AUG_6), bounds)).toBe(true);
    }
  });
});
