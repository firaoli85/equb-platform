import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { effectiveFinishWeek, legacyBreak } from "./participation-close";

// GUARD — BRINGING SOMEONE BACK MUST NOT ERASE THE WEEKS THEY PAID.
//
// `removeFromCycle`'s "keep their money records" choice writes
// `status: CLOSED, closedAtWeek: null` and no break row at all. Reactivating
// such a member has to invent the break they are inside, and the inline
// derivation in app/actions/participation-close.ts did it as
//
//     fromWeek = (closedAtWeek ?? startWeek - 1) + 1
//
// which, with closedAtWeek null, opens the break at the START OF THE CYCLE.
// Every week the member actually paid falls inside it, so the cycle expects
// nothing from them for any week, ever.
//
// IT HAPPENED, ON THE LIVE CYCLE. Alem was removed that way on 12 Aug having
// paid weeks 1 to 7, was brought back from week 13, and got a break of 1→12.
// `shouldHaveCollected` came out $3,500 light and the by-week Expected column
// showed $16,875 for weeks 1 to 7 where it should have shown $17,375. No cash
// figure moved, which is why it went unnoticed: the money was all correctly
// recorded, and only what the cycle CLAIMED to be owed was wrong.
//
// Nothing failed. `legacyBreak` had the right rule the whole time — the read
// path used it and the write path did not. Two derivations of one fact.

const ROOT = join(import.meta.dirname, "..");
const ACTION = readFileSync(join(ROOT, "app/actions/participation-close.ts"), "utf8");

/** The file with its comments taken out — a guard a comment can satisfy is no guard. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n");
}

describe("the rule for where a closed member stopped", () => {
  it("prefers the recorded closing week", () => {
    expect(
      legacyBreak({ status: "CLOSED", startWeek: 1, closedAtWeek: 6, lastWeekWithMoney: 6 }),
    ).toEqual({ fromWeek: 7, toWeek: null });
  });

  it("falls back to their LAST PAID WEEK when no closing week was recorded", () => {
    // Alem's exact shape. Removed with "keep their money records", so
    // closedAtWeek is null; she had paid weeks 1 to 7.
    expect(
      legacyBreak({ status: "CLOSED", startWeek: 1, closedAtWeek: null, lastWeekWithMoney: 7 }),
    ).toEqual({ fromWeek: 8, toWeek: null });
  });

  it("only reaches week 1 when they never paid at all", () => {
    // The one case where starting at the beginning is the honest answer:
    // nothing was ever expected from them, because they were never there.
    expect(
      legacyBreak({ status: "CLOSED", startWeek: 1, closedAtWeek: null, lastWeekWithMoney: null }),
    ).toEqual({ fromWeek: 1, toWeek: null });
  });

  it("THE BUG: the old inline rule back-dated Alem's break to week 1", () => {
    // Kept as an executable statement of what was wrong, so the difference
    // between the two rules is a number rather than a description.
    const old = (closedAtWeek: number | null, startWeek: number) => (closedAtWeek ?? startWeek - 1) + 1;
    expect(old(null, 1)).toBe(1);
    expect(
      legacyBreak({ status: "CLOSED", startWeek: 1, closedAtWeek: null, lastWeekWithMoney: 7 })
        ?.fromWeek,
    ).toBe(8);
  });
});

describe("what the wrong break costs, priced", () => {
  const WEEKLY = 50_000; // Alem, $500

  const expectedFromHer = (breaks: { fromWeek: number; toWeek: number | null }[], throughWeek: number) => {
    let total = 0;
    for (let w = 1; w <= throughWeek; w++) {
      const onBreak = breaks.some((b) => w >= b.fromWeek && (b.toWeek === null || w <= b.toWeek));
      if (!onBreak) total += WEEKLY;
    }
    return total;
  };

  it("a break from week 1 charges her for nothing at all", () => {
    const bad = [
      { fromWeek: 1, toWeek: 12 },
      { fromWeek: 8, toWeek: null },
    ];
    expect(expectedFromHer(bad, 14)).toBe(0);
  });

  it("the corrected break charges her for the seven weeks she was there", () => {
    const good = [
      { fromWeek: 8, toWeek: 12 },
      { fromWeek: 8, toWeek: null },
    ];
    expect(expectedFromHer(good, 14)).toBe(7 * WEEKLY);
    // $3,500 — exactly what shouldHaveCollected was short by.
    expect(expectedFromHer(good, 14) - expectedFromHer([
      { fromWeek: 1, toWeek: 12 },
      { fromWeek: 8, toWeek: null },
    ], 14)).toBe(350_000);
  });

  it("and the CASH side never moved either way", () => {
    // effectiveFinishWeek reads only OPEN breaks, so the bad closed row never
    // touched it. This is why the money figures were right while the
    // collection figures were wrong, and why the fix cannot move the cash.
    const withBad = effectiveFinishWeek({
      startWeek: 1,
      weeksCommitted: 20,
      breaks: [
        { fromWeek: 1, toWeek: 12 },
        { fromWeek: 8, toWeek: null },
      ],
    });
    const withGood = effectiveFinishWeek({
      startWeek: 1,
      weeksCommitted: 20,
      breaks: [
        { fromWeek: 8, toWeek: 12 },
        { fromWeek: 8, toWeek: null },
      ],
    });
    expect(withBad).toBe(7);
    expect(withGood).toBe(7);
  });
});

describe("the write path uses the shared rule", () => {
  it("reactivate derives its break through legacyBreak", () => {
    expect(ACTION).toContain("legacyBreak");
    expect(code(ACTION)).toMatch(/legacyBreak\(\{/);
  });

  it("and no longer carries its own copy of the derivation", () => {
    // THE regression, pinned as a string. If this expression comes back, so
    // does the bug.
    expect(code(ACTION)).not.toMatch(/closedAtWeek \?\? \w+\.startWeek - 1/);
  });

  it("it feeds legacyBreak the member's real last paid week", () => {
    // Passing null here would compile, pass every type check, and reintroduce
    // the bug in full.
    expect(code(ACTION)).toMatch(/lastWeekWithMoney:\s*paidWeeks\.length > 0/);
  });
});
