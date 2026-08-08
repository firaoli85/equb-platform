import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applicableTypes,
  DEFAULT_TEMPLATES,
  formatWeekList,
  MANUAL_MESSAGE_KEYS,
  MESSAGE_KEYS,
  placeholderValues,
  PLACEHOLDER_DOCS,
  renderMessage,
  renderTemplate,
  hasChaseableWeeks,
  sendDecision,
  unknownPlaceholders,
  type MessageKey,
  type StandingFacts,
} from "./messages";
import { computeStanding, type StandingWeekInput } from "./standing";

// The facts fed to renderMessage come from the REAL derivation engine
// (computeStanding), not hand-built numbers — a message is a statement of
// derived state (2.21), so the tests exercise the same pipeline the send
// path uses: stored receipts → computeStanding → placeholder facts → text.

const START = Date.UTC(2026, 4, 17); // Sunday, May 17 2026 (cycle 1's start)
const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);
const weekDate = (n: number) => new Date(START + (n - 1) * 7 * 86_400_000);

function mkWeeks(
  from: number,
  to: number,
  amountDue: number,
  overrides: Partial<Record<number, Partial<StandingWeekInput>>> = {},
): StandingWeekInput[] {
  const list: StandingWeekInput[] = [];
  for (let n = from; n <= to; n++) {
    list.push({
      weekNumber: n,
      date: weekDate(n),
      amountDue,
      storedPaid: 0,
      isDeferred: false,
      ...overrides[n],
    });
  }
  return list;
}

/** Real standing → the facts shape the messaging layer consumes. */
function factsFrom(
  name: string,
  input: {
    weeklyAmount: number;
    weeksCommitted: number;
    cycleWeek: number;
    today: Date;
    paidThroughWeek: number;
  },
): StandingFacts {
  const s = computeStanding({
    weeklyAmount: input.weeklyAmount,
    startWeek: 1,
    weeksCommitted: input.weeksCommitted,
    cycleWeek: input.cycleWeek,
    today: input.today,
    windowWeeks: mkWeeks(
      1,
      input.weeksCommitted,
      input.weeklyAmount,
      Object.fromEntries(
        Array.from({ length: input.paidThroughWeek }, (_, i) => [
          i + 1,
          { storedPaid: input.weeklyAmount },
        ]),
      ),
    ),
    totalPaid: input.weeklyAmount * input.paidThroughWeek,
  });
  return {
    name,
    weeklyAmount: input.weeklyAmount,
    weeksCommitted: input.weeksCommitted,
    currentCycleWeek: input.cycleWeek,
    finishWeek: s.finishWeek,
    weeksCredited: s.weeksCredited,
    weeksBehind: s.weeksBehind,
    amountOutstanding: s.amountOutstanding,
    totalPaid: s.totalPaid,
    lastPaymentWeek: s.lastPaymentWeek,
    weeks: s.weeks.map((w) => ({ weekNumber: w.weekNumber, status: w.status })),
  };
}

// The ground truth 2.21 example, derived for real: $250/week, 20 committed,
// week 12 of the cycle, money through week 5 → 7 behind, $1,750 outstanding.
const BEHIND_MEMBER = factsFrom("Meheret", {
  weeklyAmount: 25_000,
  weeksCommitted: 20,
  cycleWeek: 12,
  today: utc("2026-08-05"), // inside week 12's still-open window
  paidThroughWeek: 5,
});

const CURRENT_MEMBER = factsFrom("Tizita", {
  weeklyAmount: 25_000,
  weeksCommitted: 20,
  cycleWeek: 6,
  today: utc("2026-06-23"),
  paidThroughWeek: 6,
});

describe("renderMessage — statements carry the TRUE derived state (2.21)", () => {
  it("the standing behind the ground-truth example derives correctly", () => {
    expect(BEHIND_MEMBER.lastPaymentWeek).toBe(5);
    // Weeks 6-11 have closed unpaid. Week 12 opened Aug 2 and its window is
    // still open on Aug 5, so it is not owed yet — a statement never accuses
    // ahead of the boundary the member's own screen uses (2.16).
    expect(BEHIND_MEMBER.weeksBehind).toBe(6);
    expect(BEHIND_MEMBER.amountOutstanding).toBe(150_000);
  });

  it("the behind-count NEVER exceeds the weeks that actually closed", () => {
    // The contradiction this ruling removes: the old rule counted the current
    // week as behind while the same statement named only the closed weeks.
    const late = (BEHIND_MEMBER.weeks ?? []).filter((w) => w.status === "LATE").length;
    expect(late).toBe(6);
    expect(BEHIND_MEMBER.weeksBehind).toBe(late);
  });

  // The five default bodies are now Meta's APPROVED wording, derived from
  // lib/whatsapp-templates.ts. The approved templates deliberately carry FEWER
  // facts than the freeform ones did — fewer variables is fewer chances of the
  // 21656 mismatch that fabricates figures — so these assert what the approved
  // sentence actually says, not what the old one used to.
  it("BEHIND_NOTICE states last payment, weeks behind, and the amount", () => {
    const text = renderMessage("BEHIND_NOTICE", BEHIND_MEMBER);
    expect(text).toContain("Meheret");
    expect(text).toContain("last payment week 5");
    expect(text).toContain("6 weeks behind");
    expect(text).toContain("$1,500 outstanding");
  });

  it("LATE_NOTICE names the weeks whose windows actually closed", () => {
    // Weeks 6–11 closed unpaid by Aug 5; week 12's window is still open.
    const text = renderMessage("LATE_NOTICE", BEHIND_MEMBER);
    expect(text).toContain("6–11");
    expect(text).not.toContain("12");
    // The amount and the named weeks come from the SAME boundary. The approved
    // LATE_NOTICE does not carry lastPaymentWeek at all.
    expect(text).toContain("$1,500");
    expect(text).toContain("across 6 weeks");
  });

  it("PAYMENT_CONFIRMED states the receipt, the weeks it covered, and progress", () => {
    const text = renderMessage("PAYMENT_CONFIRMED", CURRENT_MEMBER, {
      amountReceived: 75_000,
      weeksCovered: [4, 5, 6],
    });
    expect(text).toContain("Tizita");
    expect(text).toContain("$750");
    expect(text).toContain("4–6");
    expect(text).toContain("6 of 20 weeks");
  });

  it("WINNER_ANNOUNCEMENT carries the drawn week and the net payout", () => {
    const text = renderMessage("WINNER_ANNOUNCEMENT", CURRENT_MEMBER, {
      drawnWeek: 8,
      payoutNet: 490_000,
    });
    expect(text).toContain("week 8");
    expect(text).toContain("$4,900");
    // The approved winner announcement states the finish WEEK, not the paid
    // count — see the note on 2.22 in the build report.
    expect(text).toContain("continue to week 20");
  });

  it("CYCLE_CLOSING_STATEMENT is factual for a completed member ($0)", () => {
    const done = factsFrom("Abel", {
      weeklyAmount: 25_000,
      weeksCommitted: 20,
      cycleWeek: 20,
      today: utc("2026-10-05"),
      paidThroughWeek: 20,
    });
    const text = renderMessage("CYCLE_CLOSING_STATEMENT", done);
    expect(text).toContain("20 of 20 weeks");
    expect(text).toContain("Outstanding balance $0");
  });

  it("CYCLE_CLOSING_STATEMENT is factual for a member who stopped", () => {
    const text = renderMessage("CYCLE_CLOSING_STATEMENT", BEHIND_MEMBER);
    expect(text).toContain("5 of 20 weeks");
    // The approved closing statement carries totalPaid and the balance; it does
    // not name the last payment week.
    expect(text).toContain("$1,500");
  });

  it("LOCKOUT_NOTICE is calm, names the CONFIGURED duration, and promises auto-unlock", () => {
    const text = renderMessage("LOCKOUT_NOTICE", CURRENT_MEMBER, { lockMinutes: 30 });
    expect(text).toContain("Tizita");
    expect(text).toContain("locked for 30 minutes");
    expect(text).toContain("unlock automatically");
    // A different configured duration renders as itself — nothing hardcoded.
    expect(renderMessage("LOCKOUT_NOTICE", CURRENT_MEMBER, { lockMinutes: 7 })).toContain(
      "locked for 7 minutes",
    );
  });

  it("every default template renders with no unresolved placeholders", () => {
    const extras = {
      amountReceived: 25_000,
      weeksCovered: [6],
      drawnWeek: 8,
      payoutNet: 490_000,
      lockMinutes: 30,
    };
    for (const key of MESSAGE_KEYS) {
      const text = renderMessage(key, BEHIND_MEMBER, extras);
      expect(text, `${key} left a placeholder unresolved`).not.toMatch(/\{[a-zA-Z]+\}/);
    }
  });

  it("a member with no payments renders an honest dash, not a fake number", () => {
    const never = factsFrom("Sara", {
      weeklyAmount: 25_000,
      weeksCommitted: 20,
      cycleWeek: 3,
      today: utc("2026-06-02"),
      paidThroughWeek: 0,
    });
    expect(never.lastPaymentWeek).toBeNull();
    expect(renderMessage("BEHIND_NOTICE", never)).toContain("week —");
  });

  it("an unknown placeholder stays literal and is reported", () => {
    const body = "Hi {name}, this has a {bogus} token.";
    expect(renderTemplate(body, placeholderValues(CURRENT_MEMBER))).toContain("{bogus}");
    expect(unknownPlaceholders(body)).toEqual(["bogus"]);
    expect(unknownPlaceholders(DEFAULT_TEMPLATES.BEHIND_NOTICE.body)).toEqual([]);
  });
});

describe("formatWeekList", () => {
  it("compacts runs and keeps gaps", () => {
    expect(formatWeekList([])).toBe("—");
    expect(formatWeekList([5])).toBe("5");
    expect(formatWeekList([8, 9, 10])).toBe("8–10");
    expect(formatWeekList([3, 8, 9])).toBe("3, 8–9");
    expect(formatWeekList([9, 8, 8, 10])).toBe("8–10");
  });
});

describe("sendDecision — the 2.20/2.21 gate as law", () => {
  const base = { noMessages: false, hasPhone: true };

  it("AUTOMATIC is legal only for the direct-result types (confirmation, lockout)", () => {
    expect(
      sendDecision({ key: "PAYMENT_CONFIRMED", trigger: "AUTOMATIC", ...base }).send,
    ).toBe(true);
    expect(
      sendDecision({ key: "LOCKOUT_NOTICE", trigger: "AUTOMATIC", ...base }).send,
    ).toBe(true);
    for (const key of MANUAL_MESSAGE_KEYS) {
      const decision = sendDecision({ key, trigger: "AUTOMATIC", ...base });
      expect(decision.send, `${key} must never send automatically`).toBe(false);
    }
  });

  it("MANUAL may send every type", () => {
    for (const key of MESSAGE_KEYS) {
      expect(sendDecision({ key, trigger: "MANUAL", ...base }).send).toBe(true);
    }
  });

  it("the hardship flag silences EVERYTHING — even the automatic confirmation", () => {
    for (const key of MESSAGE_KEYS) {
      for (const trigger of ["AUTOMATIC", "MANUAL"] as const) {
        const decision = sendDecision({ key, trigger, noMessages: true, hasPhone: true });
        expect(decision.send).toBe(false);
        if (!decision.send) expect(decision.reason).toContain("no messages");
      }
    }
  });

  it("imported history NEVER sends, whatever else is true (2.21)", () => {
    for (const key of MESSAGE_KEYS) {
      for (const noMessages of [false, true]) {
        const decision = sendDecision({ key, trigger: "IMPORT", noMessages, hasPhone: true });
        expect(decision.send).toBe(false);
        if (!decision.send) expect(decision.reason).toContain("Imported history");
      }
    }
  });

  it("no phone on file blocks the send with an honest reason", () => {
    const decision = sendDecision({
      key: "PAYMENT_CONFIRMED",
      trigger: "AUTOMATIC",
      noMessages: false,
      hasPhone: false,
    });
    expect(decision.send).toBe(false);
    if (!decision.send) expect(decision.reason).toContain("phone");
  });
});

describe("message keys", () => {
  it("the automatic types are not offered as manual batches (2.20)", () => {
    expect(MANUAL_MESSAGE_KEYS).not.toContain<MessageKey>("PAYMENT_CONFIRMED");
    expect(MANUAL_MESSAGE_KEYS).not.toContain<MessageKey>("LOCKOUT_NOTICE");
    expect(MANUAL_MESSAGE_KEYS).toHaveLength(MESSAGE_KEYS.length - 2);
  });
});

// ————— Deferral and the chasing types (organizer ruling, Aug 2026) —————
//
// Deferral suppresses the CHASING, never the debt. These tests pin both
// halves: the reminders stop, and every statement still states the full
// amount owed.
describe("deferral leaves a member out of the chasing, not out of the books", () => {
  const base = { noMessages: false, hasPhone: true, trigger: "MANUAL" as const };

  it("hasChaseableWeeks is true only when a week closed unpaid", () => {
    expect(hasChaseableWeeks([{ status: "LATE" }, { status: "PAID" }])).toBe(true);
    expect(hasChaseableWeeks([{ status: "DEFERRED" }, { status: "PAID" }])).toBe(false);
    expect(hasChaseableWeeks([{ status: "UNPAID" }])).toBe(false);
    expect(hasChaseableWeeks([])).toBe(false);
    expect(hasChaseableWeeks(undefined)).toBe(false);
  });

  it("refuses BEHIND_NOTICE and LATE_NOTICE when the whole shortfall is deferred", () => {
    for (const key of ["BEHIND_NOTICE", "LATE_NOTICE"] as const) {
      const decision = sendDecision({
        ...base,
        key,
        weeks: [{ status: "PAID" }, { status: "DEFERRED" }, { status: "DEFERRED" }],
      });
      expect(decision.send).toBe(false);
      if (!decision.send) {
        expect(decision.reason).toContain("deferred");
        expect(decision.reason).toContain("still owed");
      }
    }
  });

  it("still chases when a NON-deferred week has closed unpaid", () => {
    expect(
      sendDecision({
        ...base,
        key: "LATE_NOTICE",
        weeks: [{ status: "DEFERRED" }, { status: "LATE" }],
      }).send,
    ).toBe(true);
  });

  it("deferral never blocks a STATEMENT — those state the true amount owed", () => {
    for (const key of ["PAYMENT_CONFIRMED", "WINNER_ANNOUNCEMENT", "CYCLE_CLOSING_STATEMENT"] as const) {
      expect(
        sendDecision({
          ...base,
          key,
          trigger: key === "PAYMENT_CONFIRMED" ? "AUTOMATIC" : "MANUAL",
          weeks: [{ status: "DEFERRED" }, { status: "DEFERRED" }],
        }).send,
      ).toBe(true);
    }
  });

  it("{amountOwed} includes deferred weeks — a statement never understates a debt", () => {
    const rendered = renderMessage("CYCLE_CLOSING_STATEMENT", {
      name: "Alem",
      weeklyAmount: 50_000,
      weeksCommitted: 20,
      currentCycleWeek: 10,
      finishWeek: 20,
      weeksCredited: 6,
      weeksBehind: 4,
      // computeStanding counts deferred weeks in this figure (2.14).
      amountOutstanding: 200_000,
      totalPaid: 300_000,
      lastPaymentWeek: 6,
      weeks: [{ weekNumber: 9, status: "DEFERRED" }, { weekNumber: 10, status: "DEFERRED" }],
    });
    expect(rendered).toContain("$2,000");
  });

  it("without weeks the gate behaves exactly as before — no silent filtering", () => {
    expect(sendDecision({ ...base, key: "LATE_NOTICE" }).send).toBe(true);
  });
});

// ————— 2.22: a member's own finish DATE, in a message —————
//
// "Every member sees their own finish date, always." A statement that names a
// finish WEEK and no date makes the member do the arithmetic the organizer is
// forbidden from doing.
describe("{finishDate} — the member's own finish date is renderable", () => {
  const FACTS = {
    name: "Meheret",
    weeklyAmount: 150_000,
    weeksCommitted: 10,
    currentCycleWeek: 12,
    finishWeek: 19,
    finishDate: new Date(Date.UTC(2026, 8, 20)),
    weeksCredited: 3,
    weeksBehind: 0,
    amountOutstanding: 0,
    totalPaid: 450_000,
    lastPaymentWeek: 12,
    weeks: [],
  };

  it("is offered as a token the organizer can put in any template", () => {
    expect(PLACEHOLDER_DOCS.map((p) => p.token)).toContain("{finishDate}");
  });

  it("renders the real calendar date wherever a template uses the token", () => {
    // The token still works; what changed is which template spends a variable
    // on it. Asserted through a custom body so the capability stays covered.
    expect(
      renderMessage("WINNER_ANNOUNCEMENT", FACTS, { payoutNet: 1_960_000, drawnWeek: 12 }, "You finish {finishDate}."),
    ).toContain("Sunday, September 20, 2026");
  });

  // 2.22 SAYS A MEMBER ALWAYS SEES THEIR OWN FINISH DATE. The Meta-approved
  // WINNER_ANNOUNCEMENT states the finish WEEK and not the date — the date was
  // one of two variables dropped to get the template from six to four. This is
  // a real narrowing of 2.22 on this one message, it arrived with Meta's
  // approval, and only re-submission can undo it. Pinned so the loss is a
  // recorded decision rather than something noticed later by a member.
  it("the approved winner announcement states the finish WEEK, not the date", () => {
    const text = renderMessage("WINNER_ANNOUNCEMENT", FACTS, {
      payoutNet: 1_960_000,
      drawnWeek: 12,
    });
    expect(text).toContain("continue to week 19");
    expect(text).not.toContain("Sunday, September 20, 2026");
  });

  it("falls back to the week number when no date is supplied — never blank", () => {
    const text = renderMessage(
      "WINNER_ANNOUNCEMENT",
      { ...FACTS, finishDate: null },
      { payoutNet: 1_960_000, drawnWeek: 12 },
    );
    expect(text).toContain("week 19");
    expect(text).not.toContain("{finishDate}");
    expect(text).not.toContain("undefined");
  });
});

// ————————————— Per-member sending: which types apply —————————————
//
// The batch composer sends one type to everyone it applies to. This is the
// individual case — the organizer on Tsion's profile who wants to send HER a
// notice — and the risk it introduces is offering a type her state cannot
// support: a winner announcement for someone never drawn renders a payout of
// zero and a drawn week of nothing.

describe("which message types apply to one member", () => {
  const base = {
    name: "Tsion",
    weeksBehind: 0,
    amountOutstanding: 0,
    drawnWeek: null as number | null,
    cycleClosed: false,
    noMessages: false,
    hasPhone: true,
  };

  const forKey = (state: Parameters<typeof applicableTypes>[0], key: string) =>
    applicableTypes(state).find((t) => t.key === key)!;

  it("never offers an automatic type by hand", () => {
    // PAYMENT_CONFIRMED and LOCKOUT_NOTICE fire from their own events (2.20).
    const keys = applicableTypes(base).map((t) => t.key);
    expect(keys).not.toContain("PAYMENT_CONFIRMED");
    expect(keys).not.toContain("LOCKOUT_NOTICE");
  });

  it("offers the behind notice only to someone actually behind", () => {
    expect(forKey(base, "BEHIND_NOTICE").applicable).toBe(false);
    expect(forKey({ ...base, weeksBehind: 6 }, "BEHIND_NOTICE").applicable).toBe(true);
  });

  it("says WHY a type is not offered, naming the member", () => {
    // A greyed option with no explanation is a bug report waiting to be filed.
    const reason = forKey(base, "BEHIND_NOTICE").reason ?? "";
    expect(reason).toContain("Tsion");
    expect(reason).toContain("window has closed");
  });

  it("offers the late notice only when money is actually owed", () => {
    expect(forKey(base, "LATE_NOTICE").applicable).toBe(false);
    expect(forKey({ ...base, amountOutstanding: 250_000 }, "LATE_NOTICE").applicable).toBe(true);
  });

  it("refuses a winner announcement for someone never drawn", () => {
    // It would render a payout of zero and a drawn week of nothing.
    const undrawn = forKey(base, "WINNER_ANNOUNCEMENT");
    expect(undrawn.applicable).toBe(false);
    expect(undrawn.reason).toContain("not been drawn");
    expect(forKey({ ...base, drawnWeek: 7 }, "WINNER_ANNOUNCEMENT").applicable).toBe(true);
  });

  it("holds the closing statement until the cycle has actually closed", () => {
    expect(forKey(base, "CYCLE_CLOSING_STATEMENT").applicable).toBe(false);
    expect(forKey({ ...base, cycleClosed: true }, "CYCLE_CLOSING_STATEMENT").applicable).toBe(true);
  });

  it("blocks EVERY type for a member with no phone, and says so once", () => {
    const all = applicableTypes({
      ...base,
      hasPhone: false,
      weeksBehind: 6,
      amountOutstanding: 250_000,
      drawnWeek: 7,
      cycleClosed: true,
    });
    expect(all.every((t) => !t.applicable)).toBe(true);
    expect(all.every((t) => (t.reason ?? "").includes("no phone number"))).toBe(true);
  });

  it("blocks EVERY type for a member who has opted out (2.28)", () => {
    const all = applicableTypes({
      ...base,
      noMessages: true,
      weeksBehind: 6,
      amountOutstanding: 250_000,
      drawnWeek: 7,
      cycleClosed: true,
    });
    expect(all.every((t) => !t.applicable)).toBe(true);
    expect(all.every((t) => (t.reason ?? "").includes("no messages"))).toBe(true);
  });

  it("marks the two chasing types, and only those", () => {
    const chasing = applicableTypes(base)
      .filter((t) => t.chasing)
      .map((t) => t.key);
    expect(chasing.sort()).toEqual(["BEHIND_NOTICE", "LATE_NOTICE"]);
  });

  it("offers everything at once to a member whose state supports it", () => {
    const all = applicableTypes({
      ...base,
      weeksBehind: 6,
      amountOutstanding: 250_000,
      drawnWeek: 7,
      cycleClosed: true,
    });
    expect(all.every((t) => t.applicable)).toBe(true);
    expect(all.every((t) => t.reason === null)).toBe(true);
  });
});

describe("per-member sending inherits the batch's gate, never its own", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const action = read("app/actions/member-messaging.ts");

  it("sends through sendStatement, the same path the batch uses", () => {
    // A second implementation of "may this leave" is how two screens end up
    // disagreeing about whether a member can be messaged.
    expect(action).toContain("sendStatement(");
  });

  it("does not reimplement any gate inside the SEND path", () => {
    // READING the statements flag to say why nothing can leave is fine — the
    // screen has to state it. DECIDING with it in the send path is not: that
    // is deliver()'s job, and a second copy is how the two drift apart.
    //
    // The first version of this test forbade the flag anywhere in the file
    // and failed on the line that renders the explanation. The distinction is
    // display versus decision, so the assertion is scoped to the function
    // that actually sends.
    const send = action.slice(action.indexOf("export async function sendToMember"));
    const code = send.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toContain("STATEMENTS_DELIVERABLE");
    expect(code).not.toContain("noMessages");
    expect(code).not.toContain("twilio");
    expect(code).not.toContain("hardship");
  });

  it("refuses the automatic types by hand (2.20)", () => {
    // PAYMENT_CONFIRMED and LOCKOUT_NOTICE fire from their own events.
    expect(action).toContain('input.key === "PAYMENT_CONFIRMED"');
    expect(action).toContain('input.key === "LOCKOUT_NOTICE"');
  });

  it("re-validates the key server-side rather than trusting the browser", () => {
    expect(action).toContain("isMessageKey(input.key)");
  });

  it("reports a SKIP as neither sent nor failed", () => {
    // The organizer pressed send and nothing left. He has to be told which,
    // and why, in the engine's own words — not a generic "done".
    expect(action).toContain('outcome.status === "SKIPPED"');
    expect(action).toContain("outcome.reason");
  });

  it("states the statements block rather than hiding the buttons", () => {
    const ui = read("app/admin/(protected)/people/[id]/member-messaging.tsx");
    expect(ui).toContain("Statements cannot send yet");
    expect(ui).toContain("Login codes are unaffected");
  });
});
