import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  chooseAutoNumbers,
  describeNumberConflict,
  reconcileWeeklyAmount,
  replaceHolderRefusal,
  validateManualNumbers,
  type NumberHolder,
} from "./lucky-numbers";

// §9 #2 — MONEY OUT WITH NO MONEY IN. A number's amount is a SLICE of the
// member's weekly contribution, and every payout is priced per number. Adding
// one raised their entitlement while their weekly bill never moved; removing
// one left them billed for a number they no longer held.
describe("reconcileWeeklyAmount — the contribution invariant", () => {
  const base = { memberName: "Meheret", payoutCount: 0 };

  it("says nothing when the numbers already add up to the stored weekly", () => {
    const r = reconcileWeeklyAmount({ ...base, storedWeekly: 200_000, numberAmounts: [100_000, 100_000] });
    expect(r.changed).toBe(false);
    expect(r.refusal).toBeNull();
    expect(r.sentence).toBe("");
  });

  it("raises the weekly to match a number added", () => {
    const r = reconcileWeeklyAmount({ ...base, storedWeekly: 200_000, numberAmounts: [100_000, 100_000, 50_000] });
    expect(r.impliedWeekly).toBe(250_000);
    expect(r.delta).toBe(50_000);
    expect(r.refusal).toBeNull();
    expect(r.sentence).toContain("rises from $2,000 to $2,500");
  });

  it("lowers the weekly to match a number removed", () => {
    const r = reconcileWeeklyAmount({ ...base, storedWeekly: 250_000, numberAmounts: [100_000, 100_000] });
    expect(r.impliedWeekly).toBe(200_000);
    expect(r.delta).toBe(-50_000);
    expect(r.sentence).toContain("falls from $2,500 to $2,000");
  });

  it("REFUSES once a payout exists — that difference is a settlement, not a re-price", () => {
    const r = reconcileWeeklyAmount({
      ...base,
      storedWeekly: 200_000,
      numberAmounts: [100_000, 100_000, 50_000],
      payoutCount: 1,
    });
    expect(r.refusal).toContain("already been drawn");
    // Names the route that settles it properly, rather than dead-ending.
    expect(r.refusal).toContain("participation");
    // States both figures so the organizer can judge the size of it.
    expect(r.refusal).toContain("$2,000");
    expect(r.refusal).toContain("$2,500");
    expect(r.sentence).toBe("");
  });

  it("does not refuse a drawn member when nothing actually changes", () => {
    const r = reconcileWeeklyAmount({
      ...base,
      storedWeekly: 200_000,
      numberAmounts: [100_000, 100_000],
      payoutCount: 2,
    });
    expect(r.changed).toBe(false);
    expect(r.refusal).toBeNull();
  });

  it("REFUSES to leave a member with no numbers at all", () => {
    const r = reconcileWeeklyAmount({ ...base, storedWeekly: 100_000, numberAmounts: [] });
    expect(r.refusal).toContain("Remove them from the cycle");
  });

  it("handles irregular slices, not just whole units", () => {
    const r = reconcileWeeklyAmount({ ...base, storedWeekly: 100_000, numberAmounts: [100_000, 32_500] });
    expect(r.impliedWeekly).toBe(132_500);
    expect(r.sentence).toContain("$1,325");
  });
});

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

  // THE RULE, in the organizer's words: "carry-over reuses previous numbers
  // WHERE FREE." These two cases used to assert the opposite — that ONE clash
  // discarded the whole set — which silently renumbered people who could have
  // kept their number. Reuse is per-number, and only the clash is replaced.
  it("keeps the preferred numbers that are free and fills only the clash", () => {
    expect(
      chooseAutoNumbers({ count: 2, taken: new Set([15, 99]), preferred: [15, 155] }),
    ).toEqual([155, 1]);
  });

  it("keeps as many preferred numbers as the new split has room for", () => {
    // Their contribution changed: last cycle 2 numbers, now 1. They keep the
    // first of theirs rather than being renumbered from scratch.
    expect(chooseAutoNumbers({ count: 1, taken: new Set([9]), preferred: [15, 155] })).toEqual([15]);
  });

  it("fills past the preferred set when the split grew", () => {
    // Last cycle 1 number, now 3: theirs is kept and two fresh ones follow.
    expect(chooseAutoNumbers({ count: 3, taken: new Set([2]), preferred: [15] })).toEqual([15, 1, 3]);
  });

  it("never hands out the same number twice, even if preferred repeats it", () => {
    expect(chooseAutoNumbers({ count: 3, taken: new Set(), preferred: [7, 7] })).toEqual([7, 1, 2]);
  });

  it("ignores preferred values that are not usable numbers", () => {
    expect(chooseAutoNumbers({ count: 2, taken: new Set(), preferred: [0, -4, 1.5, 22] })).toEqual([
      22, 1,
    ]);
  });

  it("falls back entirely to sequential when every preferred number is taken", () => {
    expect(
      chooseAutoNumbers({ count: 2, taken: new Set([15, 155]), preferred: [15, 155] }),
    ).toEqual([1, 2]);
  });
});

// A NUMBER ALREADY IN USE IS A CHOICE, NOT A DEAD END (organizer's ruling).
// "Number 22 is already taken in this cycle" is true and useless: it never
// says WHO has it, and leaves nothing to do but guess again.
describe("a lucky number already in use — say so, then offer replace or keep", () => {
  const free: NumberHolder = {
    luckyNumberId: "ln-meheret",
    number: 22,
    participationId: "part-meheret",
    memberName: "Meheret",
    drawn: false,
    payoutCount: 0,
  };
  const taken = new Set([1, 2, 22, 78]);

  it("names the holder — never just 'already taken'", () => {
    const c = describeNumberConflict({ number: 22, holder: free, taken });
    expect(c.message).toContain("Meheret");
    expect(c.message).toContain("#22");
    expect(c.holder.memberName).toBe("Meheret");
  });

  it("offers BOTH options when the number can be taken, and names where each lands", () => {
    const c = describeNumberConflict({ number: 22, holder: free, taken });
    expect(c.replaceRefusal).toBeNull();
    // KEEP's alternative is computed, never left for the organizer to guess.
    expect(c.suggestedNumber).toBe(3);
    expect(c.message).toContain("Replace");
    expect(c.message).toContain("keep it where it is");
    expect(c.message).toContain("#3");
  });

  it("makes REPLACE a true swap when the edit vacates a number", () => {
    // Editing #5 to #22: Meheret takes #5, so nobody ends up numberless.
    const c = describeNumberConflict({ number: 22, holder: free, taken, vacating: 5 });
    expect(c.replaceRefusal).toBeNull();
    expect(c.message).toContain("Meheret would take #5 in the swap");
    // The name keeps its capital: it used to be spliced mid-sentence and
    // lowercased, which rendered a real person as "meheret".
    expect(c.message).not.toContain("meheret");
  });

  it("moves the holder to the next free number when nothing is vacated", () => {
    const c = describeNumberConflict({ number: 22, holder: free, taken, vacating: null });
    expect(c.message).toContain("Meheret would move to #3");
  });

  // A DRAWN number is the record of a week someone won. Handing it to another
  // member would rewrite that record from underneath.
  it("refuses REPLACE when the holder's number has been drawn", () => {
    const drawn = { ...free, drawn: true };
    expect(replaceHolderRefusal(drawn)).toMatch(/already been drawn/i);
    const c = describeNumberConflict({ number: 22, holder: drawn, taken });
    expect(c.replaceRefusal).toMatch(/already been drawn/i);
    // Only KEEP is left, and the free number is still named.
    expect(c.message).toContain("#3 is free");
    expect(c.message).not.toContain("Replace it");
  });

  it("refuses REPLACE when money is recorded against the holder's number", () => {
    const paid = { ...free, payoutCount: 1 };
    expect(replaceHolderRefusal(paid)).toMatch(/payout record/i);
    expect(describeNumberConflict({ number: 22, holder: paid, taken }).replaceRefusal).toMatch(
      /payout record/i,
    );
  });

  it("allows REPLACE for an ordinary undrawn, unpaid number", () => {
    expect(replaceHolderRefusal(free)).toBeNull();
  });

  it("never suggests a number that is already taken", () => {
    const c = describeNumberConflict({
      number: 22,
      holder: free,
      taken: new Set([1, 2, 3, 4, 22]),
    });
    expect(c.suggestedNumber).toBe(5);
  });

  it("treats the vacated number as free for the holder to land on", () => {
    // #5 is currently taken by the row BEING edited, so it is available to
    // the holder the moment the edit lands.
    const c = describeNumberConflict({
      number: 22,
      holder: free,
      taken: new Set([1, 2, 22]),
      vacating: 5,
    });
    expect(c.message).toContain("Meheret would take #5");
  });
});

// ————————————————————————————————————————————————————————————————
// GUARD — every path that assigns a lucky number offers the same choice.
//
// The replace/keep choice was built on the member profile's number rows and
// nowhere else, so the ADD-MEMBER WIZARD — where most numbers are first
// assigned — still answered "Number 22 is already taken in this cycle": true,
// and useless, since it names neither the holder nor a way forward.
//
// This scans the actions that create or renumber a LuckyNumber and fails when
// one resolves a clash by itself instead of through the shared module.
// ————————————————————————————————————————————————————————————————

const GUARD_ROOT = join(import.meta.dirname, "..");

describe("GUARD — a taken number is never a bare error", () => {
  // Every action file that writes a LuckyNumber the organizer can name.
  const ASSIGNING_PATHS = [
    "app/actions/participations.ts",
    "app/actions/edits.ts",
  ];

  it("both assignment paths resolve conflicts through the shared module", () => {
    for (const file of ASSIGNING_PATHS) {
      const source = readFileSync(join(GUARD_ROOT, file), "utf8");
      // CALLS, not names. Matching the bare identifier made this guard
      // vacuous: the import line alone satisfied it, so replacing the lookup
      // with `const holder = null` still passed. Proven by planting exactly
      // that and watching it go green.
      expect(source, `${file} must find out WHO holds the number`).toMatch(
        /findNumberHolder\(/,
      );
      expect(source, `${file} must offer the choice, not just report the clash`).toMatch(
        /describeNumberConflict\(/,
      );
      expect(source, `${file} must be able to act on REPLACE`).toMatch(/renumberHolder\(/);
      // The organizer's answer is threaded from their input, never defaulted:
      // a hardcoded "replace" would silently renumber someone.
      expect(source, `${file} must not assume the answer`).not.toMatch(
        /onConflict:\s*["'`]replace["'`]/,
      );
    }
  });

  it("the two-step park lives in ONE place, so no path can duplicate a number", () => {
    // renumberHolder parks the holder above the cycle's highest number before
    // handing the contested one over, because @@unique([cycleId, number]) is
    // checked per statement rather than deferred. A second copy of that logic
    // is a second chance to get it wrong.
    const shared = readFileSync(join(GUARD_ROOT, "lib/number-conflict.ts"), "utf8");
    expect(shared).toContain("Math.max(0, ...taken) + 1");

    for (const file of ASSIGNING_PATHS) {
      const source = readFileSync(join(GUARD_ROOT, file), "utf8");
      expect(source, `${file} re-implements the park instead of importing it`).not.toContain(
        "Math.max(0, ...taken) + 1",
      );
    }
  });

  it("the UI offers the choice in one component, shown by both screens", () => {
    for (const file of [
      "app/admin/(protected)/cycle/add/add-member-wizard.tsx",
      "app/admin/(protected)/people/[id]/participation-editor.tsx",
    ]) {
      expect(readFileSync(join(GUARD_ROOT, file), "utf8"), file).toContain(
        "NumberConflictPanel",
      );
    }
  });
});
