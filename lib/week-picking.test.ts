import { describe, expect, it } from "vitest";
import {
  amountForWeeks,
  coverageForAmount,
  coverageSentence,
  isPickable,
  quickAmounts,
  remainingOn,
  stepPickable,
  weeksInDrag,
  weeksTouchedBy,
  type PickableWeek,
} from "./week-picking";
import { formatMoney } from "./format";

// SELECTION AND AMOUNT ARE TWO VIEWS OF ONE NUMBER — and neither of them
// decides where money LANDS. §2.15 does that, oldest debt first.

const week = (n: number, over: Partial<PickableWeek> = {}): PickableWeek => ({
  weekNumber: n,
  amountDue: 50_000, // $500
  amountPaid: 0,
  isSkipped: false,
  isDeferred: false,
  ...over,
});

/** A $500/week member, weeks 5..12, nothing paid. */
const owing = [5, 6, 7, 8, 9, 10, 11, 12].map((n) => week(n));

describe("weeks → amount: tick four weeks, get the figure", () => {
  it("adds up what the ticked weeks still need", () => {
    expect(amountForWeeks(owing, new Set([8, 9, 10, 11]))).toBe(200_000);
  });

  // The sum is of what each week NEEDS, not what it costs. Ticking a
  // half-paid week must produce the missing half, or the amount overshoots
  // and the remainder lands on a week he never intended.
  it("counts only what is still missing on a part-paid week", () => {
    const weeks = [week(5, { amountPaid: 30_000 }), week(6)];
    expect(remainingOn(weeks[0])).toBe(20_000);
    expect(amountForWeeks(weeks, new Set([5, 6]))).toBe(70_000);
  });

  it("ignores a skipped week — nobody owes it", () => {
    const weeks = [week(5), week(6, { isSkipped: true }), week(7)];
    expect(isPickable(weeks[1])).toBe(false);
    expect(amountForWeeks(weeks, new Set([5, 6, 7]))).toBe(100_000);
  });

  it("ignores a week already covered", () => {
    const weeks = [week(5, { amountPaid: 50_000 }), week(6)];
    expect(isPickable(weeks[0])).toBe(false);
    expect(amountForWeeks(weeks, new Set([5, 6]))).toBe(50_000);
  });

  // Deferred is NOT skipped (rule 5): not chased, still owed.
  it("a deferred week is tickable — it is still owed", () => {
    expect(isPickable(week(5, { isDeferred: true }))).toBe(true);
    expect(amountForWeeks([week(5, { isDeferred: true })], new Set([5]))).toBe(50_000);
  });

  it("is zero when nothing is ticked", () => {
    expect(amountForWeeks(owing, new Set())).toBe(0);
  });
});

describe("amount → weeks: type a figure, watch the squares fill", () => {
  it("covers whole weeks oldest first, and part-pays the next", () => {
    const c = coverageForAmount(owing, 175_000); // $1,750
    expect(c.fullWeeks).toEqual([5, 6, 7]);
    expect(c.partialWeek).toBe(8);
    expect(c.partialAmount).toBe(25_000);
    expect(c.unallocated).toBe(0);
  });

  it("covers exactly, with no partial, when the figure is round", () => {
    const c = coverageForAmount(owing, 200_000);
    expect(c.fullWeeks).toEqual([5, 6, 7, 8]);
    expect(c.partialWeek).toBeNull();
    expect(c.partialAmount).toBe(0);
  });

  // PARTIAL IS FIRST-CLASS, not a special case.
  it("an amount smaller than one week is a partial, not a refusal", () => {
    const c = coverageForAmount(owing, 12_345);
    expect(c.fullWeeks).toEqual([]);
    expect(c.partialWeek).toBe(5);
    expect(c.partialAmount).toBe(12_345);
    expect(c.unallocated).toBe(0);
  });

  it("reports money their weeks cannot absorb rather than losing it", () => {
    const c = coverageForAmount([week(5)], 80_000);
    expect(c.fullWeeks).toEqual([5]);
    expect(c.unallocated).toBe(30_000);
  });

  it("steps over a skipped week on its way to one that is owed", () => {
    const weeks = [week(5, { isSkipped: true }), week(6), week(7)];
    const c = coverageForAmount(weeks, 50_000);
    expect(c.fullWeeks).toEqual([6]);
    expect(c.partialWeek).toBeNull();
  });

  it("starts from the oldest UNPAID week, not the oldest week", () => {
    const weeks = [week(5, { amountPaid: 50_000 }), week(6), week(7)];
    expect(coverageForAmount(weeks, 50_000).fullWeeks).toEqual([6]);
  });

  it("names every week it touches, full and partial together", () => {
    expect(weeksTouchedBy(coverageForAmount(owing, 175_000))).toEqual([5, 6, 7, 8]);
  });

  it("touches nothing for nothing", () => {
    expect(weeksTouchedBy(coverageForAmount(owing, 0))).toEqual([]);
  });
});

// THE ROUND TRIP. Ticking produces an amount; that amount covers the same
// weeks — WHEN nothing older is owed. That caveat is the whole ruling.
describe("the round trip, and where it deliberately does not close", () => {
  it("ticking weeks and typing their total agree when nothing older is owed", () => {
    const amount = amountForWeeks(owing, new Set([5, 6, 7, 8]));
    expect(weeksTouchedBy(coverageForAmount(owing, amount))).toEqual([5, 6, 7, 8]);
  });

  // §2.15, PINNED. Ticking weeks 8–11 computes $2,000 — and the engine puts it
  // on 5, 6, 7, 8, because those are older. Ticking is a calculator, never an
  // instruction about where money lands.
  it("ticking LATER weeks still sends the money to the OLDEST ones", () => {
    const ticked = new Set([9, 10, 11, 12]);
    const amount = amountForWeeks(owing, ticked);
    expect(amount).toBe(200_000);

    const lands = weeksTouchedBy(coverageForAmount(owing, amount));
    expect(lands).toEqual([5, 6, 7, 8]);
    // The two sets do not overlap at all — and that must be VISIBLE, which is
    // what allocationOutsideSelection is for.
    expect(lands.some((w) => ticked.has(w))).toBe(false);
  });
});

describe("quick amounts — computed from their real weeks, never a tier list", () => {
  it("offers one week, four weeks, and everything owed", () => {
    expect(quickAmounts(owing).map((q) => q.label)).toEqual(["1 week", "4 weeks", "All 8 owed"]);
    expect(quickAmounts(owing).map((q) => q.amount)).toEqual([50_000, 200_000, 400_000]);
  });

  it("carries the weeks each chip works out to, for filling the squares", () => {
    expect(quickAmounts(owing)[1].weeks).toEqual([5, 6, 7, 8]);
  });

  it("drops a chip that duplicates another", () => {
    // Two weeks owed: "1 week" and "All 2 owed" differ, "4 weeks" cannot exist.
    const two = [week(5), week(6)];
    expect(quickAmounts(two).map((q) => q.label)).toEqual(["1 week", "All 2 owed"]);
  });

  it("offers nothing at all when nothing is owed", () => {
    expect(quickAmounts([week(5, { amountPaid: 50_000 })])).toEqual([]);
  });

  it("uses what a part-paid week still needs", () => {
    const weeks = [week(5, { amountPaid: 30_000 }), week(6)];
    expect(quickAmounts(weeks)[0].amount).toBe(20_000);
  });
});

describe("dragging across the squares", () => {
  it("takes everything between the two ends, inclusive", () => {
    expect(weeksInDrag(owing, 6, 9)).toEqual([6, 7, 8, 9]);
  });

  it("works dragged backwards", () => {
    expect(weeksInDrag(owing, 9, 6)).toEqual([6, 7, 8, 9]);
  });

  it("is a single week when the drag never moved", () => {
    expect(weeksInDrag(owing, 7, 7)).toEqual([7]);
  });

  // Sweeping a range must not silently tick a paid week — and must not stop
  // dead at one either.
  it("skips weeks that cannot be ticked, without breaking the sweep", () => {
    const weeks = [week(5), week(6, { amountPaid: 50_000 }), week(7, { isSkipped: true }), week(8)];
    expect(weeksInDrag(weeks, 5, 8)).toEqual([5, 8]);
  });
});

// THE KEYBOARD'S DRAG. Sweeping a run was mouse-only, which loses the feature
// on the phone he actually records money on. `stepPickable` is the movement
// half; `weeksInDrag` above is the selection half, shared with the pointer.
describe("stepping between squares", () => {
  it("moves to the next week forward", () => {
    expect(stepPickable(owing, 7, 1)).toBe(8);
  });

  it("moves to the previous week backward", () => {
    expect(stepPickable(owing, 7, -1)).toBe(6);
  });

  // The same reason the sweep passes over them: a square he cannot tick is
  // not a place to land, and stopping on one would strand the focus.
  it("steps OVER a paid or skipped week rather than landing on it", () => {
    const weeks = [week(5), week(6, { amountPaid: 50_000 }), week(7, { isSkipped: true }), week(8)];
    expect(stepPickable(weeks, 5, 1)).toBe(8);
    expect(stepPickable(weeks, 8, -1)).toBe(5);
  });

  it("returns null at either end, so focus never wraps into a surprise", () => {
    expect(stepPickable(owing, 12, 1)).toBeNull();
    expect(stepPickable(owing, 5, -1)).toBeNull();
  });

  it("returns null when nothing at all can be ticked", () => {
    expect(stepPickable([week(5, { amountPaid: 50_000 })], 5, 1)).toBeNull();
  });

  // Starting from a week that is itself unpickable still has to work — that is
  // exactly where focus sits when a square is paid off while he is on it.
  it("steps from a week that cannot itself be ticked", () => {
    const weeks = [week(5), week(6, { isSkipped: true }), week(7)];
    expect(stepPickable(weeks, 6, 1)).toBe(7);
    expect(stepPickable(weeks, 6, -1)).toBe(5);
  });

  it("does not depend on the weeks arriving in order", () => {
    expect(stepPickable([week(9), week(5), week(7)], 5, 1)).toBe(7);
  });
});

describe("the sentence beneath the amount", () => {
  const say = (amount: number) => coverageSentence(coverageForAmount(owing, amount), formatMoney);

  it("names the weeks and the leftover in one line", () => {
    expect(say(175_000)).toBe(
      "This covers weeks 5, 6 and 7 in full, and leaves $250 toward week 8.",
    );
  });

  it("says just the weeks when it lands evenly", () => {
    expect(say(100_000)).toBe("This covers weeks 5 and 6 in full.");
  });

  it("reads naturally for a single week", () => {
    expect(say(50_000)).toBe("This covers week 5 in full.");
  });

  it("states a pure partial without dressing it up as an error", () => {
    expect(say(12_345)).toBe("This leaves $123.45 toward week 5.");
  });

  it("says plainly when money fits nowhere", () => {
    const s = coverageSentence(coverageForAmount([week(5)], 80_000), formatMoney);
    expect(s).toContain("$300 fits nowhere");
    expect(s).toContain("reduce the amount");
  });

  it("says nothing has been entered rather than showing a broken sentence", () => {
    expect(say(0)).toBe("Nothing to record yet.");
  });

  it("never emits NaN, undefined or a negative-looking figure", () => {
    for (const amount of [0, 1, 49_999, 50_000, 175_000, 400_000, 999_999_99]) {
      const s = say(amount);
      expect(s).not.toContain("NaN");
      expect(s).not.toContain("undefined");
      expect(s).not.toContain("$-");
    }
  });
});
