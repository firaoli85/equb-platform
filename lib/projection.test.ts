import { describe, expect, it } from "vitest";
import { cycleProjection } from "./projection";

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
