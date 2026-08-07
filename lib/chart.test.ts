import { describe, expect, it } from "vitest";
import {
  areaPath,
  bandScale,
  chartSummary,
  consistencyState,
  linearScale,
  linePath,
  longestOverdueRun,
  niceCeiling,
  segmentWidths,
} from "./chart";

describe("niceCeiling — an axis nobody can read is decoration", () => {
  it("rounds up to 1, 2 or 5 times a power of ten", () => {
    expect(niceCeiling(8_432)).toBe(10_000);
    expect(niceCeiling(1_200)).toBe(2_000);
    expect(niceCeiling(2_100)).toBe(5_000);
    expect(niceCeiling(5_000)).toBe(5_000);
    expect(niceCeiling(6_000)).toBe(10_000);
  });

  it("leaves an exact power of ten alone", () => {
    expect(niceCeiling(1_000)).toBe(1_000);
    expect(niceCeiling(100)).toBe(100);
  });

  it("ZERO stays zero — an empty chart must not invent a scale", () => {
    expect(niceCeiling(0)).toBe(0);
    expect(niceCeiling(-5)).toBe(0);
    expect(niceCeiling(Number.NaN)).toBe(0);
  });
});

describe("linearScale", () => {
  it("maps the maximum to the full length", () => {
    const s = linearScale(8_432, 200);
    expect(s.max).toBe(10_000);
    expect(s(10_000)).toBe(200);
    expect(s(5_000)).toBe(100);
    expect(s(0)).toBe(0);
  });

  it("an all-zero series draws flat rather than dividing by zero", () => {
    const s = linearScale(0, 200);
    expect(s.max).toBe(0);
    expect(s(0)).toBe(0);
    expect(Number.isFinite(s(100))).toBe(true);
  });

  it("gives readable ticks including both ends", () => {
    const s = linearScale(8_432, 200, 4);
    expect(s.ticks).toEqual([0, 2_500, 5_000, 7_500, 10_000]);
  });
});

describe("bandScale — one slot per week", () => {
  it("spaces the bands evenly across the length", () => {
    const b = bandScale(4, 400, 0.25);
    expect(b.step).toBe(100);
    expect(b.bandWidth).toBe(75);
    expect(b.at(0)).toBe(12.5);
    expect(b.at(3)).toBe(312.5);
  });

  it("the last band ends inside the chart", () => {
    const b = bandScale(20, 600);
    expect(b.at(19) + b.bandWidth).toBeLessThanOrEqual(600);
  });

  it("no categories does not divide by zero", () => {
    const b = bandScale(0, 400);
    expect(b.step).toBe(0);
    expect(Number.isFinite(b.at(0))).toBe(true);
  });
});

describe("paths", () => {
  it("a line is straight segments — never a spline", () => {
    // A smoothed money line invents values between the weeks that were
    // actually measured. Assert there is no curve command in the output.
    const d = linePath([
      { x: 0, y: 10 },
      { x: 10, y: 0 },
      { x: 20, y: 5 },
    ]);
    expect(d).toBe("M0.00,10.00 L10.00,0.00 L20.00,5.00");
    expect(d).not.toMatch(/[CQSTA]/);
  });

  it("an empty series is an empty path, not a stray dot", () => {
    expect(linePath([])).toBe("");
    expect(areaPath([], 100)).toBe("");
  });

  it("an area closes down to the baseline and back", () => {
    const d = areaPath(
      [
        { x: 0, y: 10 },
        { x: 20, y: 5 },
      ],
      100,
    );
    expect(d.endsWith("Z")).toBe(true);
    expect(d).toContain("L20.00,100.00");
    expect(d).toContain("L0.00,100.00");
  });
});

describe("chartSummary — every chart says what it is", () => {
  it("names the range and the peak", () => {
    const s = chartSummary({
      what: "Money collected against expected, per week",
      points: 20,
      from: "week 1",
      to: "week 20",
      highest: { label: "week 5", value: "$24,500" },
    });
    expect(s).toContain("20 points");
    expect(s).toContain("week 1 to week 20");
    expect(s).toContain("Highest: week 5, $24,500");
  });

  it("says there is no data rather than inventing a range", () => {
    expect(chartSummary({ what: "Cash position", points: 0, from: "", to: "" })).toContain(
      "no data yet",
    );
  });
});

describe("segmentWidths — a known total, and the gap is information", () => {
  const segs = [
    { key: "collected", label: "Collected", value: 9 },
    { key: "pending", label: "Pending", value: 1 },
  ];

  it("measures against the KNOWN total, not the sum of the segments", () => {
    // 25 members, 10 drawn: the bar must be 40% full, not 100%.
    const w = segmentWidths(segs, 25);
    expect(w.find((s) => s.key === "collected")!.percent).toBeCloseTo(36, 5);
    expect(w.find((s) => s.key === "pending")!.percent).toBeCloseTo(4, 5);
    expect(w.reduce((s, x) => s + x.percent, 0)).toBeCloseTo(40, 5);
  });

  it("a real-but-tiny segment is never drawn as nothing", () => {
    const w = segmentWidths([{ key: "pending", label: "Pending", value: 1 }], 200, 2);
    // 0.5% would be sub-pixel on a phone. It is a real pending payout.
    expect(w[0].percent).toBe(2);
  });

  it("lifting a tiny segment takes the width back from the largest", () => {
    const w = segmentWidths(
      [
        { key: "big", label: "Big", value: 99 },
        { key: "tiny", label: "Tiny", value: 1 },
      ],
      100,
      5,
    );
    expect(w.find((s) => s.key === "tiny")!.percent).toBe(5);
    expect(w.reduce((s, x) => s + x.percent, 0)).toBeCloseTo(100, 5);
  });

  it("a ZERO segment stays zero — it is not lifted into existence", () => {
    const w = segmentWidths([{ key: "pending", label: "Pending", value: 0 }], 25);
    expect(w[0].percent).toBe(0);
  });

  it("a total of zero renders nothing rather than NaN", () => {
    const w = segmentWidths(segs, 0);
    expect(w.every((s) => s.percent === 0)).toBe(true);
  });
});

describe("consistencyState — agrees with DOMAIN_RULES", () => {
  const base = { amountDue: 100_000, amountPaid: 0, isDeferred: false, windowClosed: true };

  it("paid in full is paid", () => {
    expect(consistencyState({ ...base, amountPaid: 100_000 })).toBe("paid");
  });

  it("paid ahead is still paid", () => {
    expect(consistencyState({ ...base, amountPaid: 150_000 })).toBe("paid");
  });

  it("DEFERRED wins over everything — it is a real decision, not a status", () => {
    expect(consistencyState({ ...base, isDeferred: true, amountPaid: 0 })).toBe("deferred");
    expect(consistencyState({ ...base, isDeferred: true, windowClosed: false })).toBe("deferred");
  });

  it("an OPEN window is never overdue, however little has been paid (rule 7)", () => {
    // This is the false alarm the elapsed-weeks rule exists to prevent.
    expect(consistencyState({ ...base, amountPaid: 0, windowClosed: false })).toBe("not-due");
    expect(consistencyState({ ...base, amountPaid: 40_000, windowClosed: false })).toBe("partial");
  });

  it("a closed window with nothing paid is overdue", () => {
    expect(consistencyState(base)).toBe("overdue");
  });

  it("a closed window part-paid is partial, not overdue", () => {
    expect(consistencyState({ ...base, amountPaid: 40_000 })).toBe("partial");
  });
});

describe("longestOverdueRun — the pattern is the point", () => {
  it("finds the longest consecutive run, not the total", () => {
    // Three scattered reds is a different fact from three in a row.
    expect(longestOverdueRun(["overdue", "paid", "overdue", "paid", "overdue"])).toBe(1);
    expect(longestOverdueRun(["paid", "overdue", "overdue", "overdue", "paid"])).toBe(3);
  });

  it("a clean strip has no run", () => {
    expect(longestOverdueRun(["paid", "paid", "deferred", "not-due"])).toBe(0);
    expect(longestOverdueRun([])).toBe(0);
  });

  it("a run at the very end still counts", () => {
    expect(longestOverdueRun(["paid", "overdue", "overdue"])).toBe(2);
  });
});
