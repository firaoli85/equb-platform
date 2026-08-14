import { describe, expect, it } from "vitest";
import { placeholderValues, type MessageExtras, type StandingFacts } from "./messages";
import { APPROVED_TEMPLATES, buildContentVariables, checkRequiredExtras } from "./whatsapp-templates";

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
const wd = (w: number) => new Date(Date.UTC(2026, 4, 17 + (w - 1) * 7));
const FACTS: StandingFacts = {
  name: "Firaoli",
  weeklyAmount: 100_000,
  weeksCommitted: 20,
  currentCycleWeek: 12,
  finishWeek: 20,
  finishDate: wd(20),
  weeksCredited: 13,
  weeksBehind: 0,
  amountOutstanding: 0,
  totalPaid: 1_300_000,
  lastPaymentWeek: 13,
  weeks: Array.from({ length: 20 }, (_, i) => ({ weekNumber: i + 1, status: "PAID", date: wd(i + 1) })),
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
    expect(r.missing).toEqual(["payoutNet"]);
  });

  it("refuses identically when extras is an empty object", () => {
    const r = runSendPath("WINNER_ANNOUNCEMENT", {});
    expect(r.stage).toBe("extras");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.missing).toEqual(["payoutNet"]);
  });

  // THE DRAWN-WEEK ERA IS OVER (winner_announcement_v2, 13 Aug 2026). The v1
  // body carried "{week}", which without `drawnWeek` silently fell back to
  // the CURRENT cycle week — the invisible defect this file was written for.
  // The v2 body has NO week slot at all, so the entire fallback class is gone
  // structurally: `drawnWeek` is no longer required, and no slot exists for
  // it to mis-fill.
  it("with payoutNet alone it SENDS — no drawn-week slot exists to mis-fill", () => {
    const r = runSendPath("WINNER_ANNOUNCEMENT", { payoutNet: 1_960_000 });
    expect(r.stage).toBe("sent");
    expect(r.ok).toBe(true);
    if (!r.ok || r.stage !== "sent") return;
    // v3 slots (14 Aug 2026): payout · paid · committed · payments left ·
    // finish date.
    expect(r.variables["2"]).toBe("$19,600");
    expect(r.variables["3"]).toBe("13");
    expect(r.variables["4"]).toBe("20");
    expect(r.variables["5"]).toBe("7"); // 20 committed − 13 paid: PAYMENTS left
    // The member's own finish DATE — D-38's resolution retained in v3.
    expect(r.variables["6"]).toBe("Sunday, September 27, 2026");
    expect(Object.values(r.variables)).not.toContain("12");
  });

  // The registry's own contract, pinned as a literal so a resubmission that
  // reintroduces a week slot re-arms the old defect loudly.
  it("drawnWeek is NOT required, and {week} is not a v2 variable", () => {
    const check = checkRequiredExtras("WINNER_ANNOUNCEMENT", { payoutNet: 1 });
    expect(check.ok).toBe(true);
    expect(
      APPROVED_TEMPLATES.WINNER_ANNOUNCEMENT.variableOrder as readonly string[],
    ).not.toContain("week");
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
    // v2: the member's own numbering with dates (start week 1 here, so own
    // numbers coincide with the cycle's).
    expect(r.variables["3"]).toBe("12–13 (Aug 2 – Aug 9)");
  });
});

// THE SWITCHOVER'S NEW EXTRAS-FED TEMPLATE (13 Aug 2026).
//
// The build order asked for this plant-proof on the WELCOME — but the welcome
// REQUIRES no extras: {portalUrl} is a standing fact read from settings, and
// welcomeSendCheck refuses an unset one before any network. GROUP_ANNOUNCEMENT
// is the one NEW template with a required extra, so the proof runs here. An
// omitted composition would not blank the message — Twilio would deliver the
// approval SAMPLE ("The draw this week moves to Saturday 7pm...") as if the
// organizer had said it today. Same defect class as drawnWeek: silent,
// plausible, wrong.
describe("GROUP_ANNOUNCEMENT — the organizer's words are required, never sampled", () => {
  it("with extras entirely omitted, REFUSES at the extras boundary", () => {
    const r = runSendPath("GROUP_ANNOUNCEMENT", undefined);
    expect(r.stage).toBe("extras");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // A literal, not derived from requiredExtras (lesson 5.6).
    expect(r.missing).toEqual(["announcementText"]);
  });

  it("a whitespace-only composition is caught at the variables layer — two nets", () => {
    // It passes the extras boundary (the key IS present) and becomes NO_VALUE
    // in placeholderValues; announcementText is not DASHABLE, so the variables
    // layer refuses. Different net, same outcome: nothing sampled is sent.
    const r = runSendPath("GROUP_ANNOUNCEMENT", { announcementText: "   " });
    expect(r.stage).toBe("variables");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.missing).toContain("announcementText");
  });

  it("with the text supplied, sends the organizer's words verbatim", () => {
    const r = runSendPath("GROUP_ANNOUNCEMENT", {
      announcementText: "The draw this week moves to Saturday 7pm. Same Zoom link as always.",
    });
    expect(r.stage).toBe("sent");
    expect(r.ok).toBe(true);
    if (!r.ok || r.stage !== "sent") return;
    expect(r.variables["1"]).toBe("Firaoli");
    expect(r.variables["2"]).toBe(
      "The draw this week moves to Saturday 7pm. Same Zoom link as always.",
    );
  });
});

// THIS TEST GUARDS AGAINST OVER-REFUSING. A guard that blocks legitimate
// messages is its own defect, and the temptation after a bug like this is to
// require everything everywhere.
describe("templates that need no extras still send", () => {
  it("BEHIND_NOTICE still sends after the cycle runs past the member's own window", () => {
    // The cycle calendar keeps counting after a member's window ends —
    // currentCycleWeek 25 in a 20-week window here. Unclamped, myCurrentWeek
    // looked up a week the member does not have, composed to the sentinel,
    // and the notice became permanently unsendable for exactly the members
    // most behind (verifier finding, 14 Aug 2026). Their record stops
    // changing at their final week, so "the current week is week 20" IS
    // their frame's answer — the clamp states it instead of refusing.
    const pastWindow: StandingFacts = {
      ...FACTS,
      currentCycleWeek: 25,
      weeksBehind: 7,
      amountOutstanding: 700_000,
    };
    const r = runSendPath("BEHIND_NOTICE", undefined, pastWindow);
    expect(r.stage).toBe("sent");
    expect(r.ok).toBe(true);
    if (!r.ok || r.stage !== "sent") return;
    // v3 slots: behind count · amount · paid-up-to · current week (full date).
    expect(r.variables["2"]).toBe("7");
    expect(r.variables["3"]).toBe("$7,000");
    expect(r.variables["5"]).toBe("20 (Sunday, September 27)");
  });

  it("BEHIND_NOTICE for a NEVER-PAID member composes 'the start', not a dash (v3)", () => {
    // The v2 body dashed {myLastPaymentWeek} here. The v3 rule supersedes the
    // sentinel: the paid-up-to fact is ALWAYS composable — a member with no
    // fully-paid week is paid up to "the start", with their own start date.
    const neverPaid: StandingFacts = {
      ...FACTS,
      lastPaymentWeek: null,
      weeksCredited: 0,
      totalPaid: 0,
      weeksBehind: 12,
      amountOutstanding: 1_200_000,
      weeks: Array.from({ length: 20 }, (_, i) => ({
        weekNumber: i + 1,
        status: i < 12 ? "LATE" : "UNPAID",
        date: wd(i + 1),
      })),
    };
    const r = runSendPath("BEHIND_NOTICE", undefined, neverPaid);
    expect(r.stage).toBe("sent");
    expect(r.ok).toBe(true);
    if (!r.ok || r.stage !== "sent") return;
    expect(r.variables["2"]).toBe("12");
    expect(r.variables["3"]).toBe("$12,000");
    // wd(1) is Sunday, May 17 2026 — the exact sample form the order pinned.
    expect(r.variables["4"]).toBe("the start (Sunday, May 17)");
    expect(r.variables["5"]).toBe("12 (Sunday, August 2)");
    expect(Object.values(r.variables)).not.toContain("—");
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
    expect(r.missing).toContain("myLateWeeks");
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
    expect(r.missing).toContain("myLateWeeks");
  });

  it("sends when weeks really are late", () => {
    const late: StandingFacts = {
      ...FACTS,
      weeksBehind: 2,
      amountOutstanding: 200_000,
      weeks: Array.from({ length: 20 }, (_, i) => ({
        weekNumber: i + 1,
        status: i < 6 ? "PAID" : i < 8 ? "LATE" : "UNPAID",
        date: wd(i + 1),
      })),
    };
    const r = runSendPath("LATE_NOTICE", undefined, late);
    expect(r.stage).toBe("sent");
    expect(r.ok).toBe(true);
    if (!r.ok || r.stage !== "sent") return;
    // v3 list form: no ranges, no dashes, dates grouped in one bracket —
    // then the paid-up-to and current-week anchors repeat the story.
    expect(r.variables["2"]).toBe("7 and 8 (Jun 28 and Jul 5)");
    expect(r.variables["3"]).toBe("$2,000");
    expect(r.variables["4"]).toBe("6 (Sunday, June 21)");
    expect(r.variables["5"]).toBe("12 (Sunday, August 2)");
  });
});

describe("the refusal tells the caller what to DO", () => {
  const r = checkRequiredExtras("WINNER_ANNOUNCEMENT", {});

  it("names the template and the exact extras keys", () => {
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("WINNER_ANNOUNCEMENT");
    expect(r.error).toContain("extras.payoutNet");
    expect(r.error).not.toContain("extras.drawnWeek");
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
