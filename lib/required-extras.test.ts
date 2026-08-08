import { describe, expect, it } from "vitest";
import { placeholderValues, type MessageExtras, type StandingFacts } from "./messages";
import { buildContentVariables, checkRequiredExtras } from "./whatsapp-templates";

// THE PRODUCTION PATH, RUN END TO END.
//
// Every existing ContentVariables test hand-builds a COMPLETE values object and
// then asserts ordering. The bug was an INCOMPLETE set — the tests' premise was
// the thing that failed, so fourteen green tests sat on top of a live defect
// (lesson 5.1).
//
// These run what production runs:
//
//     extras -> checkRequiredExtras -> placeholderValues -> buildContentVariables
//
// and the expected missing keys are written as LITERALS. Deriving them from
// `requiredExtras` would make the test agree with the code by construction and
// prove nothing (lesson 5.6).

/**
 * A member mid-cycle. currentCycleWeek is 12 DELIBERATELY: the delivered bug
 * read "week 12" because {week} fell through to this value, and it looked
 * right only because the draw happened to be for the current week.
 */
const FACTS: StandingFacts = {
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

/** The full production sequence, in order, stopping where production stops. */
function runSendPath(
  key: Parameters<typeof checkRequiredExtras>[0],
  extras: MessageExtras | undefined,
  facts: StandingFacts = FACTS,
) {
  const required = checkRequiredExtras(key, extras);
  if (!required.ok) return { stage: "extras" as const, ...required };
  const values = placeholderValues(facts, extras ?? {});
  const variables = buildContentVariables(key, values);
  if (!variables.ok) return { stage: "variables" as const, ...variables };
  return { stage: "sent" as const, ...variables, values };
}

describe("WINNER_ANNOUNCEMENT — the message that reached a real phone", () => {
  // EXACTLY what app/actions/member-messaging.ts did at HEAD before the fix:
  // sendStatement({ participationId, key, trigger }) with no extras field.
  it("with extras entirely omitted, REFUSES at the extras boundary", () => {
    const r = runSendPath("WINNER_ANNOUNCEMENT", undefined);
    expect(r.stage).toBe("extras");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // Literals, not derived from requiredExtras.
    expect(r.missing).toEqual(["drawnWeek", "payoutNet"]);
  });

  it("refuses identically when extras is an empty object", () => {
    const r = runSendPath("WINNER_ANNOUNCEMENT", {});
    expect(r.stage).toBe("extras");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.missing).toEqual(["drawnWeek", "payoutNet"]);
  });

  // THE INVISIBLE DEFECT. payoutNet present, drawnWeek absent: the money guard
  // is satisfied, and without this check the message renders and sends with
  // standing.currentCycleWeek in place of the drawn week.
  it("with payoutNet but NO drawnWeek, refuses rather than silently using the current week", () => {
    const r = runSendPath("WINNER_ANNOUNCEMENT", { payoutNet: 1_960_000 });
    expect(r.stage).toBe("extras");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.missing).toEqual(["drawnWeek"]);
    expect(r.missing).not.toContain("payoutNet");
  });

  it("proves the fallback it prevents: without the check, week 6's draw would send as week 12", () => {
    // placeholderValues on its own, with the check bypassed — the state the
    // member's message was rendered in.
    const values = placeholderValues(FACTS, { payoutNet: 1_960_000 });
    expect(values.week).toBe("12"); // currentCycleWeek, NOT a drawn week
    // And it passes every downstream guard, because "12" is a valid string.
    const variables = buildContentVariables("WINNER_ANNOUNCEMENT", values);
    expect(variables.ok).toBe(true);
  });

  it("WITH drawnWeek differing from the current week, the message carries the DRAWN week", () => {
    const r = runSendPath("WINNER_ANNOUNCEMENT", { drawnWeek: 6, payoutNet: 1_960_000 });
    expect(r.stage).toBe("sent");
    expect(r.ok).toBe(true);
    if (!r.ok || r.stage !== "sent") return;
    expect(r.variables["2"]).toBe("6"); // the drawn week
    expect(r.variables["2"]).not.toBe("12"); // not the current week
    expect(r.variables["3"]).toBe("$19,600");
  });

  it("a null drawnWeek counts as absent — a caller that looked and found nothing", () => {
    const r = runSendPath("WINNER_ANNOUNCEMENT", {
      drawnWeek: null as unknown as number,
      payoutNet: 1_960_000,
    });
    expect(r.stage).toBe("extras");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.missing).toEqual(["drawnWeek"]);
  });
});

describe("PAYMENT_CONFIRMED — the other extras-fed template", () => {
  it("with amountReceived omitted, refuses at the extras boundary", () => {
    const r = runSendPath("PAYMENT_CONFIRMED", { weeksCovered: [13] });
    expect(r.stage).toBe("extras");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.missing).toEqual(["amountReceived"]);
  });

  it("with weeksCovered omitted, refuses at the extras boundary", () => {
    const r = runSendPath("PAYMENT_CONFIRMED", { amountReceived: 200_000 });
    expect(r.stage).toBe("extras");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.missing).toEqual(["weeksCovered"]);
  });

  it("with both supplied, sends — and carries the real figures", () => {
    const r = runSendPath("PAYMENT_CONFIRMED", {
      amountReceived: 200_000,
      weeksCovered: [12, 13],
    });
    expect(r.stage).toBe("sent");
    expect(r.ok).toBe(true);
    if (!r.ok || r.stage !== "sent") return;
    expect(r.variables["2"]).toBe("$2,000");
    expect(r.variables["3"]).toBe("12–13");
  });
});

// THIS TEST GUARDS AGAINST OVER-REFUSING. A guard that blocks legitimate
// messages is its own defect, and the temptation after a bug like this is to
// require everything everywhere.
describe("templates that need no extras still send", () => {
  it("BEHIND_NOTICE with NO extras sends, and a never-paid member's dash is kept", () => {
    const neverPaid: StandingFacts = {
      ...FACTS,
      lastPaymentWeek: null,
      weeksBehind: 7,
      amountOutstanding: 700_000,
    };
    const r = runSendPath("BEHIND_NOTICE", undefined, neverPaid);
    expect(r.stage).toBe("sent");
    expect(r.ok).toBe(true);
    if (!r.ok || r.stage !== "sent") return;
    // "—" is the honest answer here and must survive both guards.
    expect(r.variables["3"]).toBe("—");
    expect(r.variables["5"]).toBe("$7,000");
  });

  it("CYCLE_CLOSING_STATEMENT with NO extras sends — it has no extras-fed variables", () => {
    const r = runSendPath("CYCLE_CLOSING_STATEMENT", undefined);
    expect(r.stage).toBe("sent");
    expect(r.ok).toBe(true);
    if (!r.ok || r.stage !== "sent") return;
    expect(r.variables["4"]).toBe("$13,000");
    expect(r.variables["5"]).toBe("$0");
  });
});

// LATE_NOTICE ON ITS OWN TERMS.
//
// Its protection today is `hasChaseableWeeks` inside `sendDecision` — a policy
// check in a different module, which these tests deliberately do not call. If
// that policy is ever relaxed, the refusal must still hold here.
describe("LATE_NOTICE refuses an empty week list without help from sendDecision", () => {
  it("with no LATE weeks, refuses — sendDecision is never consulted in this path", () => {
    const nothingLate: StandingFacts = { ...FACTS, weeks: [] };
    const r = runSendPath("LATE_NOTICE", undefined, nothingLate);
    // It passes the extras boundary — LATE_NOTICE requires none — and is
    // caught at the variables layer instead. Two nets, different failures.
    expect(r.stage).toBe("variables");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.missing).toContain("lateWeeks");
  });

  it("refuses even when weeks exist but none are LATE", () => {
    const paidUp: StandingFacts = {
      ...FACTS,
      weeks: [
        { weekNumber: 1, status: "PAID" },
        { weekNumber: 2, status: "DEFERRED" },
      ],
    };
    const r = runSendPath("LATE_NOTICE", undefined, paidUp);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.missing).toContain("lateWeeks");
  });

  it("sends when weeks really are late", () => {
    const late: StandingFacts = {
      ...FACTS,
      weeksBehind: 2,
      amountOutstanding: 200_000,
      weeks: [
        { weekNumber: 7, status: "LATE" },
        { weekNumber: 8, status: "LATE" },
      ],
    };
    const r = runSendPath("LATE_NOTICE", undefined, late);
    expect(r.stage).toBe("sent");
    expect(r.ok).toBe(true);
    if (!r.ok || r.stage !== "sent") return;
    expect(r.variables["2"]).toBe("7–8");
  });
});

describe("the refusal tells the caller what to DO", () => {
  const r = checkRequiredExtras("WINNER_ANNOUNCEMENT", {});

  it("names the template and the exact extras keys", () => {
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("WINNER_ANNOUNCEMENT");
    expect(r.error).toContain("extras.drawnWeek");
    expect(r.error).toContain("extras.payoutNet");
  });

  it("explains that the failure is SILENT, not loud", () => {
    if (r.ok) return;
    expect(r.error).toContain("does not fail");
    expect(r.error).toContain("CURRENT cycle week");
  });

  it("names the caller-side fix, not just the symptom", () => {
    if (r.ok) return;
    expect(r.error).toContain("winnerExtrasForParticipation");
    expect(r.error).toContain("Fix the CALLER");
    expect(r.error).toContain("Nothing was sent");
  });
});
