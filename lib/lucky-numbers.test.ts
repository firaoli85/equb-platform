import { describe, expect, it } from "vitest";
import { chooseAutoNumbers, validateManualNumbers } from "./lucky-numbers";

describe("validateManualNumbers — immediate, plain-language validation", () => {
  const taken = new Set([1, 2, 22, 78]);

  it("accepts free, distinct, positive numbers of the right count", () => {
    expect(validateManualNumbers({ numbers: [5, 55], requiredCount: 2, taken })).toBeNull();
    expect(validateManualNumbers({ numbers: [3], requiredCount: 1, taken })).toBeNull();
  });

  it("says clearly when a number is already used in this cycle", () => {
    expect(validateManualNumbers({ numbers: [22], requiredCount: 1, taken })).toBe(
      "Number 22 is already taken in this cycle.",
    );
  });

  it("enforces the split count", () => {
    expect(validateManualNumbers({ numbers: [5], requiredCount: 2, taken })).toMatch(
      /splits into 2 numbers — enter exactly 2/,
    );
  });

  it("rejects duplicates within the entry", () => {
    expect(validateManualNumbers({ numbers: [5, 5], requiredCount: 2, taken })).toBe(
      "Number 5 is entered twice.",
    );
  });

  it("rejects zero, negatives, and fractions", () => {
    expect(validateManualNumbers({ numbers: [0], requiredCount: 1, taken })).toMatch(/not a valid/);
    expect(validateManualNumbers({ numbers: [-3], requiredCount: 1, taken })).toMatch(/not a valid/);
    expect(validateManualNumbers({ numbers: [1.5], requiredCount: 1, taken })).toMatch(/not a valid/);
  });
});

describe("chooseAutoNumbers — sequential by default, carry-over when possible", () => {
  it("assigns the next FREE sequential values from 1, skipping taken ones", () => {
    expect(chooseAutoNumbers({ count: 2, taken: new Set([1, 2, 78]) })).toEqual([3, 4]);
    expect(chooseAutoNumbers({ count: 1, taken: new Set() })).toEqual([1]);
    // Gaps left by edits are reused naturally.
    expect(chooseAutoNumbers({ count: 3, taken: new Set([1, 3, 5]) })).toEqual([2, 4, 6]);
  });

  it("reuses the carried-over numbers when the whole set is free", () => {
    expect(
      chooseAutoNumbers({ count: 2, taken: new Set([1, 3]), preferred: [15, 155] }),
    ).toEqual([15, 155]);
  });

  it("falls back to sequential numbers when any preferred number is taken", () => {
    expect(
      chooseAutoNumbers({ count: 2, taken: new Set([15, 99]), preferred: [15, 155] }),
    ).toEqual([1, 2]);
  });

  it("falls back when the preferred count no longer matches the split", () => {
    // e.g. their contribution changed: last cycle 2 numbers, now 1
    expect(chooseAutoNumbers({ count: 1, taken: new Set([9]), preferred: [15, 155] })).toEqual([1]);
  });
});
