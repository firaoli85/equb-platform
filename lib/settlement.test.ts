import { describe, expect, it } from "vitest";
import {
  allocatePinned,
  computeTermsSettlement,
  nameConfirmed,
  planWinnerWeekSettlement,
} from "./settlement";

// Real figures throughout — the organizer's own example: a $1,000 number
// over 20 weeks grosses $20,000, fee 2% = $400, net $19,600; the winner's
// $1,000 week-5 contribution comes out of it → $18,600 handed over.

describe("planWinnerWeekSettlement — the winner does not pay the week they win", () => {
  it("deducts the full week from the payout when nothing was paid", () => {
    const plan = planWinnerWeekSettlement({
      amountDue: 100_000,
      alreadyPaidOnWeek: 0,
      payouts: [{ payoutId: "p1", netAmount: 1_960_000 }],
    });
    expect(plan).toEqual({
      perPayout: [{ payoutId: "p1", deduct: 100_000 }],
      totalSettled: 100_000,
      unabsorbed: 0,
    });
  });

  it("deducts only the uncovered part of a partially paid week", () => {
    const plan = planWinnerWeekSettlement({
      amountDue: 100_000,
      alreadyPaidOnWeek: 40_000,
      payouts: [{ payoutId: "p1", netAmount: 1_960_000 }],
    });
    expect(plan.perPayout).toEqual([{ payoutId: "p1", deduct: 60_000 }]);
    expect(plan.totalSettled).toBe(60_000);
  });

  it("settles nothing for an excused week (amountDue 0) or an already covered week", () => {
    expect(
      planWinnerWeekSettlement({
        amountDue: 0,
        alreadyPaidOnWeek: 0,
        payouts: [{ payoutId: "p1", netAmount: 1_960_000 }],
      }).totalSettled,
    ).toBe(0);
    expect(
      planWinnerWeekSettlement({
        amountDue: 100_000,
        alreadyPaidOnWeek: 100_000,
        payouts: [{ payoutId: "p1", netAmount: 1_960_000 }],
      }).totalSettled,
    ).toBe(0);
  });

  it("waterfalls across several payouts in order", () => {
    const plan = planWinnerWeekSettlement({
      amountDue: 150_000,
      alreadyPaidOnWeek: 0,
      payouts: [
        { payoutId: "p1", netAmount: 90_000 },
        { payoutId: "p2", netAmount: 980_000 },
      ],
    });
    expect(plan.perPayout).toEqual([
      { payoutId: "p1", deduct: 90_000 },
      { payoutId: "p2", deduct: 60_000 },
    ]);
    expect(plan.unabsorbed).toBe(0);
  });

  it("reports what the payouts cannot absorb — the caller must refuse", () => {
    const plan = planWinnerWeekSettlement({
      amountDue: 100_000,
      alreadyPaidOnWeek: 0,
      payouts: [{ payoutId: "p1", netAmount: 30_000 }],
    });
    expect(plan.totalSettled).toBe(30_000);
    expect(plan.unabsorbed).toBe(70_000);
  });

  it("skips a payout whose net is already zero or negative", () => {
    const plan = planWinnerWeekSettlement({
      amountDue: 50_000,
      alreadyPaidOnWeek: 0,
      payouts: [
        { payoutId: "p1", netAmount: 0 },
        { payoutId: "p2", netAmount: 980_000 },
      ],
    });
    expect(plan.perPayout).toEqual([{ payoutId: "p2", deduct: 50_000 }]);
  });
});

describe("allocatePinned — a settlement replays onto its pinned week ONLY", () => {
  it("fills the pinned week exactly", () => {
    expect(
      allocatePinned(100_000, { amountDue: 100_000, amountAlreadyPaid: 0, isDeferred: false }),
    ).toEqual({ applied: 100_000, unallocated: 0 });
  });

  it("never overfills — the excess is unallocated, not moved to another week", () => {
    expect(
      allocatePinned(100_000, { amountDue: 100_000, amountAlreadyPaid: 70_000, isDeferred: false }),
    ).toEqual({ applied: 30_000, unallocated: 70_000 });
  });

  it("applies nothing to an excused week", () => {
    expect(
      allocatePinned(100_000, { amountDue: 100_000, amountAlreadyPaid: 0, isDeferred: true }),
    ).toEqual({ applied: 0, unallocated: 100_000 });
  });
});

describe("computeTermsSettlement — a paid-out member changing terms", () => {
  it("the organizer's example: received $19,600, now $500/week x 20 weeks → holds $9,800 too much", () => {
    const result = computeTermsSettlement({
      oldWeeklyAmount: 100_000,
      oldWeeksCommitted: 20,
      newWeeklyAmount: 50_000,
      newWeeksCommitted: 20,
      feePercent: 2,
      alreadyReceived: 1_960_000,
    });
    expect(result.oldEntitlementGross).toBe(2_000_000);
    expect(result.newEntitlementGross).toBe(1_000_000);
    expect(result.newFee).toBe(20_000);
    expect(result.newEntitlementNet).toBe(980_000);
    expect(result.gap).toBe(980_000);
    // $500/week nets $490/week at 2% — $19,600 / $490 = 40 weeks balances it.
    expect(result.balancingWeeksExact).toBeCloseTo(40, 10);
    expect(result.balancingWeeksWhole).toBe(40);
  });

  it("the reverse: they increased and are now owed more than they received", () => {
    const result = computeTermsSettlement({
      oldWeeklyAmount: 50_000,
      oldWeeksCommitted: 20,
      newWeeklyAmount: 100_000,
      newWeeksCommitted: 20,
      feePercent: 2,
      alreadyReceived: 980_000,
    });
    expect(result.newEntitlementNet).toBe(1_960_000);
    expect(result.gap).toBe(-980_000);
  });

  it("unchanged entitlement → zero gap, nothing owed either way", () => {
    const result = computeTermsSettlement({
      oldWeeklyAmount: 100_000,
      oldWeeksCommitted: 20,
      newWeeklyAmount: 100_000,
      newWeeksCommitted: 20,
      feePercent: 2,
      alreadyReceived: 1_960_000,
    });
    expect(result.gap).toBe(0);
  });

  it("balancing weeks rounds to the nearest whole week when nothing balances exactly", () => {
    const result = computeTermsSettlement({
      oldWeeklyAmount: 100_000,
      oldWeeksCommitted: 20,
      newWeeklyAmount: 30_000,
      newWeeksCommitted: 10,
      feePercent: 0,
      alreadyReceived: 1_000_000,
    });
    // $10,000 / $300 = 33.33… → 33 whole weeks.
    expect(result.balancingWeeksWhole).toBe(33);
    expect(result.balancingWeeksExact).toBeCloseTo(33.3333, 3);
  });
});

describe("nameConfirmed — type the member's name, any name they go by", () => {
  const person = { nameEnglishFirst: "Abebe", nameEnglishLast: "Kebede", nameAmharic: "አበበ" };

  it("accepts first name, full name, and Amharic name — case and spacing forgiving", () => {
    expect(nameConfirmed("Abebe", person)).toBe(true);
    expect(nameConfirmed("  abebe  KEBEDE ", person)).toBe(true);
    expect(nameConfirmed("አበበ", person)).toBe(true);
  });

  it("rejects a wrong or empty name", () => {
    expect(nameConfirmed("Almaz", person)).toBe(false);
    expect(nameConfirmed("", person)).toBe(false);
    expect(nameConfirmed("   ", person)).toBe(false);
  });
});
