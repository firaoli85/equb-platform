import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEMPLATES,
  formatWeekList,
  MANUAL_MESSAGE_KEYS,
  MESSAGE_KEYS,
  placeholderValues,
  renderMessage,
  renderTemplate,
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
    expect(BEHIND_MEMBER.weeksBehind).toBe(7);
    expect(BEHIND_MEMBER.amountOutstanding).toBe(175_000);
  });

  it("BEHIND_NOTICE states last payment, weeks behind, and the amount", () => {
    const text = renderMessage("BEHIND_NOTICE", BEHIND_MEMBER);
    expect(text).toContain("Meheret");
    expect(text).toContain("week 5");
    expect(text).toContain("7 weeks behind");
    expect(text).toContain("$1,750 outstanding");
    expect(text).toContain("5 of 20 weeks");
  });

  it("LATE_NOTICE names the weeks whose windows actually closed", () => {
    // Weeks 6–11 closed unpaid by Aug 5; week 12's window is still open.
    const text = renderMessage("LATE_NOTICE", BEHIND_MEMBER);
    expect(text).toContain("6–11");
    expect(text).not.toContain("12");
    expect(text).toContain("week 5");
    expect(text).toContain("$1,750");
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
    expect(text).toContain("14 weeks left");
  });

  it("WINNER_ANNOUNCEMENT carries the drawn week and the net payout", () => {
    const text = renderMessage("WINNER_ANNOUNCEMENT", CURRENT_MEMBER, {
      drawnWeek: 8,
      payoutNet: 490_000,
    });
    expect(text).toContain("week 8");
    expect(text).toContain("$4,900");
    expect(text).toContain("6 of 20 weeks");
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
    expect(text).toContain("Outstanding: $0");
  });

  it("CYCLE_CLOSING_STATEMENT is factual for a member who stopped", () => {
    const text = renderMessage("CYCLE_CLOSING_STATEMENT", BEHIND_MEMBER);
    expect(text).toContain("5 of 20 weeks");
    expect(text).toContain("Last payment week 5");
    expect(text).toContain("$1,750");
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
