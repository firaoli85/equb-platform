import { describe, expect, it } from "vitest";
import { cycleFeeProjection, cycleProjection } from "./projection";

// ————————————————————————————————————————————————————————————————
// THE STRUCTURAL PROJECTION — what a cycle of a given LENGTH is worth.
//
// The new-cycle screen used to project from the previous cycle's roster ("if
// the same 28 members join"), which misreads the domain: one slot pays out
// per week, so an N-week cycle has N slots and collects N × unitAmount every
// week, whoever fills them. The figures below are the organizer's own.
// ————————————————————————————————————————————————————————————————

const UNIT = 100_000; // $1,000 a unit — the real Cycle 1 unit

describe("cycleFeeProjection — a longer cycle is a BIGGER cycle", () => {
  it("20 weeks → $20,000/week, $400/week fee, $400,000 total, $8,000 fees", () => {
    expect(cycleFeeProjection({ plannedWeeks: 20, unitAmount: UNIT, feePercent: 2 })).toEqual({
      weeklyPot: 2_000_000,
      weeklyFee: 40_000,
      cycleTotal: 40_000_000,
      totalFees: 800_000,
      overridden: false,
    });
  });

  it("25 weeks → $25,000/week, $500/week fee, $625,000 total, $12,500 fees", () => {
    expect(cycleFeeProjection({ plannedWeeks: 25, unitAmount: UNIT, feePercent: 2 })).toEqual({
      weeklyPot: 2_500_000,
      weeklyFee: 50_000,
      cycleTotal: 62_500_000,
      totalFees: 1_250_000,
      overridden: false,
    });
  });

  it("30 weeks → $30,000/week, $600/week fee, $900,000 total, $18,000 fees", () => {
    expect(cycleFeeProjection({ plannedWeeks: 30, unitAmount: UNIT, feePercent: 2 })).toEqual({
      weeklyPot: 3_000_000,
      weeklyFee: 60_000,
      cycleTotal: 90_000_000,
      totalFees: 1_800_000,
      overridden: false,
    });
  });

  it("grows QUADRATICALLY with length — the point the roster version hid", () => {
    // Both the pot and the number of weeks scale, so 30 weeks is not 1.5× a
    // 20-week cycle, it is 2.25×. The old roster projection held the pot
    // fixed and reported a flat 1.5×, which is the wrong decision input.
    const twenty = cycleFeeProjection({ plannedWeeks: 20, unitAmount: UNIT, feePercent: 2 })!;
    const thirty = cycleFeeProjection({ plannedWeeks: 30, unitAmount: UNIT, feePercent: 2 })!;
    expect(thirty.cycleTotal / twenty.cycleTotal).toBe(2.25);
    expect(thirty.weeklyPot / twenty.weeklyPot).toBe(1.5);
  });

  it("does not depend on a roster in any way — there is no members input", () => {
    // Stated as a test because the whole correction is that the roster was
    // never an input to this question.
    const projection = cycleFeeProjection({ plannedWeeks: 20, unitAmount: UNIT, feePercent: 2 })!;
    expect(projection.weeklyPot).toBe(20 * UNIT);
  });

  it("follows the unit amount", () => {
    const p = cycleFeeProjection({ plannedWeeks: 20, unitAmount: 50_000, feePercent: 2 })!;
    expect(p.weeklyPot).toBe(1_000_000); // 20 × $500
    expect(p.cycleTotal).toBe(20_000_000);
  });

  it("a fee of 0 costs nothing; the pot is unaffected", () => {
    const p = cycleFeeProjection({ plannedWeeks: 20, unitAmount: UNIT, feePercent: 0 })!;
    expect(p.weeklyFee).toBe(0);
    expect(p.totalFees).toBe(0);
    expect(p.weeklyPot).toBe(2_000_000);
  });

  it("takes the total fee on the TOTAL, not by multiplying a rounded weekly fee", () => {
    // 3 weeks × $1,000.03 at 3.33%: the weekly fee rounds to a cent that,
    // multiplied out, does not equal the fee on the true total.
    const p = cycleFeeProjection({ plannedWeeks: 3, unitAmount: 100_003, feePercent: 3.33 })!;
    expect(p.weeklyPot).toBe(300_009);
    expect(p.cycleTotal).toBe(900_027);
    expect(p.totalFees).toBe(29_971); // fee on 900_027
    expect(p.weeklyFee * 3).not.toBe(p.totalFees); // the drift this avoids
  });

  describe("the optional override, for when reality differs", () => {
    it("uses the typed pot and still runs it over every week", () => {
      const p = cycleFeeProjection({
        plannedWeeks: 20,
        unitAmount: UNIT,
        feePercent: 2,
        weeklyPotOverride: 1_937_500, // $19,375 — a slot left empty
      })!;
      expect(p.weeklyPot).toBe(1_937_500);
      expect(p.cycleTotal).toBe(38_750_000);
      expect(p.totalFees).toBe(775_000);
      expect(p.overridden).toBe(true);
    });

    it("an absent or null override falls back to the structure", () => {
      const structural = cycleFeeProjection({ plannedWeeks: 20, unitAmount: UNIT, feePercent: 2 });
      expect(
        cycleFeeProjection({
          plannedWeeks: 20,
          unitAmount: UNIT,
          feePercent: 2,
          weeklyPotOverride: null,
        }),
      ).toEqual(structural);
    });
  });

  describe("refuses inputs that cannot describe a cycle", () => {
    it("returns null rather than a wrong number", () => {
      const base = { plannedWeeks: 20, unitAmount: UNIT, feePercent: 2 };
      expect(cycleFeeProjection({ ...base, plannedWeeks: 0 })).toBeNull();
      expect(cycleFeeProjection({ ...base, plannedWeeks: -1 })).toBeNull();
      expect(cycleFeeProjection({ ...base, plannedWeeks: 20.5 })).toBeNull();
      expect(cycleFeeProjection({ ...base, unitAmount: 0 })).toBeNull();
      expect(cycleFeeProjection({ ...base, feePercent: -1 })).toBeNull();
      expect(cycleFeeProjection({ ...base, feePercent: Number.NaN })).toBeNull();
      expect(cycleFeeProjection({ ...base, weeklyPotOverride: 0 })).toBeNull();
    });
  });
});

describe("cycleProjection — real money, not percentages", () => {
  it("reproduces the live example: $19,375/week over 20 weeks at 2% is ~$7,750 in fees", () => {
    // A compact stand-in for the real books: weeklies summing $19,375, all
    // committed 20 weeks (the real Cycle 1 shape).
    const members = [
      { id: "a", name: "A", weeklyAmount: 1_000_000, weeksCommitted: 20 }, // $10,000/wk
      { id: "b", name: "B", weeklyAmount: 500_000, weeksCommitted: 20 },
      { id: "c", name: "C", weeklyAmount: 400_000, weeksCommitted: 20 },
      { id: "d", name: "D", weeklyAmount: 37_500, weeksCommitted: 20 },
    ];
    const p = cycleProjection({ members, feePercent: 2 });
    expect(p.weeklyPot).toBe(1_937_500); // $19,375/week
    expect(p.totalGross).toBe(38_750_000); // $387,500 over the cycle
    expect(p.totalFees).toBe(775_000); // $7,750 — the number the organizer judges
    expect(p.totalNet).toBe(37_975_000);
  });

  it("computes each member's own gross, fee, and net", () => {
    const p = cycleProjection({
      members: [{ id: "x", name: "Alem", weeklyAmount: 50_000, weeksCommitted: 9 }],
      feePercent: 2,
    });
    expect(p.perMember).toEqual([
      { id: "x", name: "Alem", gross: 450_000, fee: 9_000, net: 441_000 }, // the Alem example
    ]);
  });

  it("respects differing commitments (window-aware gross)", () => {
    const p = cycleProjection({
      members: [
        { id: "a", name: "Full", weeklyAmount: 25_000, weeksCommitted: 20 },
        { id: "b", name: "Late", weeklyAmount: 25_000, weeksCommitted: 6 },
      ],
      feePercent: 2,
    });
    expect(p.perMember[0].gross).toBe(500_000);
    expect(p.perMember[1].gross).toBe(150_000);
    expect(p.totalFees).toBe(10_000 + 3_000);
  });

  it("zero members projects zero everywhere", () => {
    const p = cycleProjection({ members: [], feePercent: 2 });
    expect(p).toEqual({ weeklyPot: 0, weeklyFee: 0, totalGross: 0, totalFees: 0, totalNet: 0, perMember: [] });
  });

  it("fee percent changes flow straight through", () => {
    const members = [{ id: "a", name: "A", weeklyAmount: 100_000, weeksCommitted: 10 }];
    expect(cycleProjection({ members, feePercent: 0 }).totalFees).toBe(0);
    expect(cycleProjection({ members, feePercent: 5 }).totalFees).toBe(50_000);
  });
});

describe("cycleProjection — the per-week fee (the figure the organizer holds)", () => {
  it("weeklyFee is the fee on one week's pot — his example: $20,875/week at 2% → $417.50", () => {
    const p = cycleProjection({
      members: [{ id: "a", name: "A", weeklyAmount: 2_087_500, weeksCommitted: 20 }],
      feePercent: 2,
    });
    expect(p.weeklyPot).toBe(2_087_500);
    expect(p.weeklyFee).toBe(41_750);
  });

  it("sums the pot across members before taking the weekly fee", () => {
    const p = cycleProjection({
      members: [
        { id: "a", name: "A", weeklyAmount: 100_000, weeksCommitted: 20 },
        { id: "b", name: "B", weeklyAmount: 50_000, weeksCommitted: 20 },
      ],
      feePercent: 2,
    });
    expect(p.weeklyPot).toBe(150_000);
    expect(p.weeklyFee).toBe(3_000);
  });
});
