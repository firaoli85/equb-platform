import { describe, expect, it } from "vitest";
import { buildContentVariables, APPROVED_TEMPLATES, APPROVED_TEMPLATE_KEYS } from "./whatsapp-templates";
import {
  isMoneyPlaceholder,
  mayRenderAsNoValue,
  MONEY_PLACEHOLDERS,
  NO_VALUE,
} from "./placeholder-kinds";
import { placeholderValues } from "./messages";

// THE MESSAGE A REAL MEMBER RECEIVED:
//
//   "Hi Firaoli, your Equb payout for week 12 is —.
//    Your contributions continue to week 20."
//
// Told he had won. Not told how much. Nothing failed: the send succeeded, the
// log said SENT, and the only way to find it was to read the message.
//
// A message that delivers with a missing amount is worse than one that fails,
// because it looks fine.

const facts = {
  name: "Firaoli",
  weeklyAmount: 100_000,
  weeksCommitted: 20,
  currentCycleWeek: 12,
  finishWeek: 20,
  finishDate: null,
  weeksCredited: 13,
  weeksBehind: 0,
  amountOutstanding: 0,
  totalPaid: 1_300_000,
  lastPaymentWeek: 13,
  weeks: [],
};

describe("the delivered bug, reproduced", () => {
  it("WINNER_ANNOUNCEMENT with no extras renders the payout as a dash", () => {
    // Exactly what sendToMember did: sendStatement with no extras at all.
    const values = placeholderValues(facts, {});
    expect(values.payoutAmount).toBe(NO_VALUE);
  });

  it("and that dash is now REFUSED rather than delivered", () => {
    const values = placeholderValues(facts, {});
    const result = buildContentVariables("WINNER_ANNOUNCEMENT", values);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missing).toContain("payoutAmount");
    // The reason has to name the actual problem, not "invalid variables".
    expect(result.error).toContain("payoutAmount");
    expect(result.error).toContain("money figure");
    expect(result.error).toContain("Nothing was sent");
  });

  it("with the payout supplied it sends, and {{3}} carries the figure", () => {
    const values = placeholderValues(facts, { payoutNet: 1_960_000, drawnWeek: 12 });
    const result = buildContentVariables("WINNER_ANNOUNCEMENT", values);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Position 3 is payoutAmount in this template's variableOrder.
    expect(result.variables["3"]).toBe("$19,600");
    expect(result.variables["2"]).toBe("12");
  });

  // THE SECOND, QUIETER BUG. {week} is not in MONEY_PLACEHOLDERS, so the guard
  // cannot catch it — without drawnWeek it silently falls back to the CURRENT
  // cycle week. In the delivered message those happened to be the same number,
  // which is exactly why nobody noticed.
  it("without drawnWeek, {week} falls back to the current week — a wrong fact the guard cannot see", () => {
    const withDraw = placeholderValues(facts, { payoutNet: 1_960_000, drawnWeek: 6 });
    const without = placeholderValues(facts, { payoutNet: 1_960_000 });
    expect(withDraw.week).toBe("6");
    expect(without.week).toBe("12"); // currentCycleWeek, not the drawn week
    // Both pass the guard — which is why the fix had to supply drawnWeek too,
    // not merely rely on the refusal.
    expect(buildContentVariables("WINNER_ANNOUNCEMENT", without).ok).toBe(true);
  });
});

describe("the guard refuses money holes, and only money holes", () => {
  it("PAYMENT_CONFIRMED sent without its receipt extras is refused", () => {
    const values = placeholderValues(facts, {});
    const result = buildContentVariables("PAYMENT_CONFIRMED", values);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missing).toContain("amountReceived");
  });

  // "—" IS LEGITIMATE ELSEWHERE, and treating it as missing would refuse a
  // perfectly honest message.
  it("BEHIND_NOTICE sends for a member who has NEVER paid, where lastPaymentWeek is a dash", () => {
    const neverPaid = { ...facts, lastPaymentWeek: null, weeksBehind: 7, amountOutstanding: 700_000 };
    const values = placeholderValues(neverPaid, {});
    expect(values.lastPaymentWeek).toBe(NO_VALUE);
    const result = buildContentVariables("BEHIND_NOTICE", values);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.variables["3"]).toBe(NO_VALUE);
    expect(result.variables["5"]).toBe("$7,000");
  });

  it("a money placeholder of $0 is a real figure and sends", () => {
    const settled = { ...facts, amountOutstanding: 0 };
    const values = placeholderValues(settled, {});
    const result = buildContentVariables("CYCLE_CLOSING_STATEMENT", values);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.variables["5"]).toBe("$0");
  });

  it("an empty string is still refused, as before", () => {
    const values = { ...placeholderValues(facts, { payoutNet: 1 }), name: "" };
    const result = buildContentVariables("WINNER_ANNOUNCEMENT", values);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missing).toContain("name");
  });
});

describe("the money classification is complete and honest", () => {
  it("names every placeholder that formatMoney produces", () => {
    // If a new money placeholder is added to placeholderValues and not here,
    // it can deliver a dash. This catches that by checking the VALUES: every
    // placeholder whose value looks like money must be classified.
    const values = placeholderValues(facts, { payoutNet: 1, amountReceived: 1 });
    for (const [name, value] of Object.entries(values)) {
      if (/^\$[\d,]/.test(value)) {
        expect(isMoneyPlaceholder(name), `${name} renders money but is not classified`).toBe(true);
      }
    }
  });

  it("classifies exactly the five, and nothing that is not money", () => {
    expect([...MONEY_PLACEHOLDERS].sort()).toEqual([
      "amountOwed",
      "amountReceived",
      "payoutAmount",
      "totalPaid",
      "weeklyAmount",
    ]);
    for (const notMoney of ["name", "week", "weeksPaid", "lastPaymentWeek", "lateWeeks"]) {
      expect(isMoneyPlaceholder(notMoney)).toBe(false);
    }
  });

  it("every approved template's money variables are covered by the guard", () => {
    // Which templates can even reach this failure — stated, not assumed.
    const atRisk = APPROVED_TEMPLATE_KEYS.filter((k) =>
      APPROVED_TEMPLATES[k].variableOrder.some((v) => isMoneyPlaceholder(v)),
    );
    expect(atRisk.sort()).toEqual([
      "BEHIND_NOTICE",
      "CYCLE_CLOSING_STATEMENT",
      "LATE_NOTICE",
      "PAYMENT_CONFIRMED",
      "WINNER_ANNOUNCEMENT",
    ]);
  });
});

// ————————————————————————————————————————————————————————————————
// THE AUDIT: the same class of gap in the other four templates.
//
// Guarding MONEY closed the hole where it was noticed. It is not a money
// problem — it is a MISSING FACT problem, and two more placeholders reach the
// sentinel with nothing between them and a member.
//
// Each case below RENDERS THE BUG first, through the real placeholderValues,
// so the test fails for the same reason the member's message did rather than
// against a hand-built string.
// ————————————————————————————————————————————————————————————————

/** A member mid-cycle, paid through week 6 of 20. */
const STANDING = {
  name: "Tizita",
  weeklyAmount: 100_000,
  weeksCommitted: 20,
  currentCycleWeek: 12,
  finishWeek: 20,
  finishDate: null,
  weeksCredited: 6,
  weeksBehind: 6,
  amountOutstanding: 600_000,
  totalPaid: 600_000,
  lastPaymentWeek: 6,
  weeks: [],
};

describe("AUDIT — every placeholder that can reach the sentinel", () => {
  it("PAYMENT_CONFIRMED: weeksCovered dashes when the caller omits its extras", () => {
    // Reproduce: no extras at all, exactly as the winner bug happened.
    const values = placeholderValues(STANDING, {});
    expect(values.weeksCovered).toBe(NO_VALUE);
    expect(values.amountReceived).toBe(NO_VALUE);

    // The sentence this WOULD have produced:
    //   "we received — for your Equb — recorded on week(s) —."
    const r = buildContentVariables("PAYMENT_CONFIRMED", values);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.missing).toContain("amountReceived"); // money — was guarded
      expect(r.missing).toContain("weeksCovered"); // NOT money — was not
    }
  });

  it("weeksCovered alone is enough to refuse, even with the money present", () => {
    // The case the money guard could never catch: the figure is there, and the
    // weeks it landed on are not.
    const values = placeholderValues(STANDING, { amountReceived: 75_000 });
    expect(values.amountReceived).toBe("$750");
    expect(values.weeksCovered).toBe(NO_VALUE);

    const r = buildContentVariables("PAYMENT_CONFIRMED", values);
    expect(r.ok, "a confirmation must say which weeks the money landed on").toBe(false);
    if (!r.ok) {
      expect(r.missing).toEqual(["weeksCovered"]);
      expect(r.error).toContain("hole where a fact belongs");
    }
  });

  it("LATE_NOTICE: lateWeeks dashes when no week has closed unpaid", () => {
    // sendDecision normally refuses this — but only when `weeks` is supplied.
    // A caller that omits them skips that gate and lands here.
    const values = placeholderValues({ ...STANDING, weeks: [] }, {});
    expect(values.lateWeeks).toBe(NO_VALUE);

    // "your Equb week(s) — closed without a payment recorded."
    const r = buildContentVariables("LATE_NOTICE", values);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toContain("lateWeeks");
  });

  it("BEHIND_NOTICE: lastPaymentWeek MAY dash — it is the honest answer", () => {
    // The exception, and the reason an allowlist is the right shape: a member
    // who has never paid genuinely has no last payment week.
    const values = placeholderValues({ ...STANDING, lastPaymentWeek: null }, {});
    expect(values.lastPaymentWeek).toBe(NO_VALUE);

    const r = buildContentVariables("BEHIND_NOTICE", values);
    expect(r.ok, "a never-paid member must still be reachable").toBe(true);
    if (r.ok) expect(r.variables["3"]).toBe(NO_VALUE);
  });

  it("CYCLE_CLOSING_STATEMENT is safe — every figure comes from standing", () => {
    // totalPaid and amountOwed run through formatMoney on derived numbers, so
    // they are always a real amount, "$0" included. Asserted so a future change
    // that routes one through `extras` shows up here.
    const values = placeholderValues({ ...STANDING, totalPaid: 0, amountOutstanding: 0 }, {});
    expect(values.totalPaid).toBe("$0");
    expect(values.amountOwed).toBe("$0");
    expect(buildContentVariables("CYCLE_CLOSING_STATEMENT", values).ok).toBe(true);
  });

  it("WINNER_ANNOUNCEMENT: the original bug still refuses", () => {
    const values = placeholderValues(STANDING, {});
    expect(values.payoutAmount).toBe(NO_VALUE);
    const r = buildContentVariables("WINNER_ANNOUNCEMENT", values);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("money figure");
  });

  it("with real extras, all five build cleanly — the guard is not over-eager", () => {
    const values = placeholderValues(
      { ...STANDING, weeks: [{ weekNumber: 7, status: "LATE" }] },
      { amountReceived: 75_000, weeksCovered: [4, 5, 6], payoutNet: 980_000, drawnWeek: 12 },
    );
    for (const key of APPROVED_TEMPLATE_KEYS) {
      expect(buildContentVariables(key, values).ok, key).toBe(true);
    }
  });

  it("EVERY approved variable is either dashable or cannot reach the sentinel", () => {
    // The standing check: no approved template may carry a placeholder that
    // can dash and is not on the allowlist without this failing.
    const noExtras = placeholderValues(STANDING, {});
    const offenders: string[] = [];
    for (const key of APPROVED_TEMPLATE_KEYS) {
      for (const name of APPROVED_TEMPLATES[key].variableOrder) {
        if (noExtras[name] === NO_VALUE && mayRenderAsNoValue(name)) continue;
        if (noExtras[name] === NO_VALUE) offenders.push(`${key}.${name}`);
      }
    }
    // These are the four that CAN dash — all now refused rather than sent.
    expect(offenders.sort()).toEqual([
      "LATE_NOTICE.lateWeeks",
      "PAYMENT_CONFIRMED.amountReceived",
      "PAYMENT_CONFIRMED.weeksCovered",
      "WINNER_ANNOUNCEMENT.payoutAmount",
    ]);
    for (const key of APPROVED_TEMPLATE_KEYS) {
      const r = buildContentVariables(key, noExtras);
      const canDash = APPROVED_TEMPLATES[key].variableOrder.some(
        (n) => noExtras[n] === NO_VALUE && !mayRenderAsNoValue(n),
      );
      expect(r.ok, key).toBe(!canDash);
    }
  });
});
