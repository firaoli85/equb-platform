import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  APPROVED_TEMPLATES,
  APPROVED_TEMPLATE_KEYS,
  buildContentVariables,
} from "./whatsapp-templates";

// THE SEND PATH, END TO END — the gap the pre-build diagnostic found.
//
// Nothing covered deliver(): no test built a MessageLog row, and none proved
// what actually goes on the wire. That mattered less while statements refused
// outright. Now that they send to real members, the two things that can go
// wrong silently are (a) the ContentVariables in the WRONG ORDER, which
// delivers a fluent sentence with the figures swapped, and (b) an INCOMPLETE
// set, which makes Twilio substitute the approval samples — "Sara", "$7,000.00"
// — so a real member reads a fabricated name and invented arrears as fact.
//
// Both are silent at the provider: Twilio returns 201.

const messageLogCreate = vi.fn(async (args: unknown) => args);

// The MessageTemplate rows as they actually stand: Build 1 rewrote every
// approved row to the registry's namedBody, and lib/whatsapp-templates.test.ts
// fails the build if one drifts. deliver() prefers the row over the default,
// so the row is what lands in MessageLog — which is exactly why the drift
// guard matters: a drifted row would log text no member ever received.
const templateRows = [
  ...APPROVED_TEMPLATE_KEYS.map((key) => ({
    id: `t-${key}`,
    key,
    name: key,
    body: APPROVED_TEMPLATES[key].namedBody,
    metaTemplateSid: APPROVED_TEMPLATES[key].contentSid,
  })),
  {
    id: "t-lockout",
    key: "LOCKOUT_NOTICE",
    name: "Lockout notice",
    body: "{name}, your Equb account is locked for {lockMinutes} minutes.",
    metaTemplateSid: null,
  },
];

let whatsappEnabled = true;

vi.mock("./settings", () => ({
  getSetting: vi.fn(async (key: string) => (key === "whatsappEnabled" ? whatsappEnabled : true)),
  WHATSAPP_DISABLED_REASON: "SWITCH OFF",
  WHATSAPP_STATEMENTS_BLOCKED_REASON: "NO TEMPLATES",
}));

vi.mock("./prisma", () => ({
  prisma: {
    messageTemplate: {
      findMany: vi.fn(async () => templateRows),
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    messageLog: { create: messageLogCreate },
    participation: { findUnique: vi.fn(async () => PARTICIPATION) },
  },
}));

// NO vi.setSystemTime HERE. It swaps the global Date constructor, and these
// week rows are built with the ORIGINAL one — so lib/money.ts assertValidDate,
// which tests `date instanceof Date`, starts rejecting perfectly good dates.
// The cycle simply starts far enough back that the real clock puts it mid-cycle.
/** Week rows for a 20-week cycle starting 2026-05-17 (a Sunday). */
const WEEKS = Array.from({ length: 20 }, (_, i) => ({
  id: `w${i + 1}`,
  weekNumber: i + 1,
  date: new Date(Date.UTC(2026, 4, 17 + i * 7)),
  isSkipped: false,
}));

/** Paid weeks 1–6 at $1,000; cycle is at week 12, so 6 weeks are behind. */
const PARTICIPATION = {
  id: "p1",
  weeklyAmount: 100_000,
  startWeek: 1,
  weeksCommitted: 20,
  person: { id: "person-1", nameEnglishFirst: "Tizita", phone: "+12405550187", noMessages: false },
  payments: WEEKS.slice(0, 6).map((w) => ({ weekId: w.id, amountPaid: 100_000, isDeferred: false })),
  paymentEvents: [],
  cycle: { startDate: WEEKS[0].date, weeks: WEEKS },
};

function twilioOk() {
  return { ok: true, status: 201, text: async () => JSON.stringify({ sid: "SM_REAL", status: "queued" }) };
}
function twilioErr(code: number) {
  return { ok: false, status: 400, text: async () => JSON.stringify({ code, message: `err ${code}` }) };
}

async function engine() {
  vi.resetModules();
  return import("./messaging-engine");
}

beforeEach(() => {
  whatsappEnabled = true;
  messageLogCreate.mockClear();
  vi.stubEnv("TWILIO_ACCOUNT_SID", "ACtest");
  vi.stubEnv("TWILIO_AUTH_TOKEN", "token");
  vi.stubEnv("TWILIO_WHATSAPP_FROM", "+15559620327");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ————————————————————————————————————————————————————————————————
// ORDER. Asserted as literal keys and values.
//
// Deriving the expectation the same way the code does would pass no matter
// what order it produced (lesson 5.6), so the names come from the registry —
// which is what the ORDER means — and the produced object is written out.
// ————————————————————————————————————————————————————————————————

describe("ContentVariables are built in the approved ORDER", () => {
  const VALUES = {
    name: "Tizita",
    week: "12",
    weeksPaid: "6",
    weeksTotal: "20",
    weeksBehind: "6",
    amountOwed: "$6,000",
    lastPaymentWeek: "6",
    amountReceived: "$750",
    weeksCovered: "4–6",
    lateWeeks: "7–11",
    payoutAmount: "$9,800",
    finishWeek: "20",
    totalPaid: "$6,000",
  };

  it("PAYMENT_CONFIRMED — name, amount, weeks covered, paid, total", () => {
    const r = buildContentVariables("PAYMENT_CONFIRMED", VALUES);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.variables).toEqual({
        "1": "Tizita",
        "2": "$750",
        "3": "4–6",
        "4": "6",
        "5": "20",
      });
    }
  });

  it("BEHIND_NOTICE — name, week, last payment, weeks behind, outstanding", () => {
    const r = buildContentVariables("BEHIND_NOTICE", VALUES);
    if (r.ok) {
      expect(r.variables).toEqual({
        "1": "Tizita",
        "2": "12",
        "3": "6",
        "4": "6",
        "5": "$6,000",
      });
    }
  });

  it("LATE_NOTICE — name, late weeks, outstanding, weeks behind (only four)", () => {
    const r = buildContentVariables("LATE_NOTICE", VALUES);
    if (r.ok) {
      expect(r.variables).toEqual({
        "1": "Tizita",
        "2": "7–11",
        "3": "$6,000",
        "4": "6",
      });
      expect(Object.keys(r.variables)).toHaveLength(4);
    }
  });

  it("WINNER_ANNOUNCEMENT — name, drawn week, payout, finish week", () => {
    const r = buildContentVariables("WINNER_ANNOUNCEMENT", VALUES);
    if (r.ok) {
      expect(r.variables).toEqual({
        "1": "Tizita",
        "2": "12",
        "3": "$9,800",
        "4": "20",
      });
    }
  });

  it("CYCLE_CLOSING_STATEMENT — name, paid, total, total paid, outstanding", () => {
    const r = buildContentVariables("CYCLE_CLOSING_STATEMENT", VALUES);
    if (r.ok) {
      expect(r.variables).toEqual({
        "1": "Tizita",
        "2": "6",
        "3": "20",
        "4": "$6,000",
        "5": "$6,000",
      });
    }
  });

  it("the literal expectations above match the registry's variableOrder", () => {
    // The cross-check: if someone reorders variableOrder, the explicit
    // objects above start failing, and this says why.
    expect(APPROVED_TEMPLATES.PAYMENT_CONFIRMED.variableOrder).toEqual([
      "name", "amountReceived", "weeksCovered", "weeksPaid", "weeksTotal",
    ]);
    expect(APPROVED_TEMPLATES.LATE_NOTICE.variableOrder).toEqual([
      "name", "lateWeeks", "amountOwed", "weeksBehind",
    ]);
  });
});

describe("an incomplete variable set REFUSES", () => {
  it("names the missing variable and produces no partial object", () => {
    const r = buildContentVariables("PAYMENT_CONFIRMED", {
      name: "Tizita",
      amountReceived: "$750",
      // weeksCovered missing
      weeksPaid: "6",
      weeksTotal: "20",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.missing).toEqual(["weeksCovered"]);
      expect(r.error).toContain("weeksCovered");
      // The reason has to say WHY refusing beats sending.
      expect(r.error).toContain("SAMPLE");
    }
  });

  it("treats an EMPTY STRING as missing — Twilio would sample-fill it", () => {
    const r = buildContentVariables("PAYMENT_CONFIRMED", {
      name: "", amountReceived: "$750", weeksCovered: "4–6", weeksPaid: "6", weeksTotal: "20",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toEqual(["name"]);
  });

  it("accepts the em-dash sentinel — it is a VALUE, not a gap", () => {
    // lastPaymentWeek is legitimately "—" for a member who has never paid,
    // and "no payment recorded" is exactly what they should read.
    const r = buildContentVariables("BEHIND_NOTICE", {
      name: "Tizita", week: "12", lastPaymentWeek: "—", weeksBehind: "12", amountOwed: "$12,000",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.variables["3"]).toBe("—");
  });
});

describe("deliver() end to end", () => {
  async function send(key: string, extras: Record<string, unknown> = {}) {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        calls.push(String(init.body));
        return twilioOk();
      }),
    );
    const { sendStatement } = await engine();
    const outcome = await sendStatement({
      participationId: "p1",
      key: key as never,
      trigger: "MANUAL",
      extras: extras as never,
    });
    return { outcome, calls };
  }

  it("PAYMENT_CONFIRMED writes a SENT log row carrying the provider SID", async () => {
    const { outcome, calls } = await send("PAYMENT_CONFIRMED", {
      amountReceived: 75_000,
      weeksCovered: [4, 5, 6],
    });
    expect(outcome.status).toBe("SENT");
    expect(calls).toHaveLength(1);

    const row = messageLogCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(row.data.templateKey).toBe("PAYMENT_CONFIRMED");
    expect(row.data.status).toBe("SENT");
    expect(row.data.providerSid).toBe("SM_REAL");
    expect(row.data.error).toBeNull();
    expect(row.data.toPhone).toBe("+12405550187");
    // The logged body is the sentence the member reads.
    expect(String(row.data.body)).toContain("Tizita");
    expect(String(row.data.body)).toContain("$750");
  });

  it("sends the right ContentSid for each of the five", async () => {
    for (const key of ["PAYMENT_CONFIRMED", "BEHIND_NOTICE", "LATE_NOTICE", "WINNER_ANNOUNCEMENT", "CYCLE_CLOSING_STATEMENT"] as const) {
      messageLogCreate.mockClear();
      const { outcome, calls } = await send(key, {
        amountReceived: 75_000,
        weeksCovered: [4, 5, 6],
        drawnWeek: 12,
        payoutNet: 980_000,
      });
      expect(outcome.status, key).toBe("SENT");
      const sent = new URLSearchParams(calls[0]);
      expect(sent.get("ContentSid"), key).toBe(APPROVED_TEMPLATES[key].contentSid);
      expect(sent.get("Body"), key).toBeNull();
      const vars = JSON.parse(sent.get("ContentVariables")!) as Record<string, string>;
      expect(Object.keys(vars), key).toHaveLength(APPROVED_TEMPLATES[key].variableOrder.length);
      expect(vars["1"], key).toBe("Tizita");
    }
  });

  it("LOCKOUT_NOTICE is SKIPPED, sends nothing, and does not throw", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { sendStatement } = await engine();

    const outcome = await sendStatement({
      participationId: "p1",
      key: "LOCKOUT_NOTICE",
      trigger: "AUTOMATIC",
      extras: { lockMinutes: 30 },
    });
    expect(outcome.status).toBe("SKIPPED");
    if (outcome.status === "SKIPPED") {
      expect(outcome.reason).toContain("LOCKOUT_NOTICE");
      expect(outcome.reason).toContain("no Meta-approved");
    }
    // A lockout must never become an error on top of a lockout.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(messageLogCreate).not.toHaveBeenCalled();
  });

  it("the switch OFF sends nothing, even with templates approved", async () => {
    whatsappEnabled = false;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { sendStatement, STATEMENTS_DELIVERABLE } = await engine();

    // The point of the test: deliverable and still not sent.
    expect(STATEMENTS_DELIVERABLE).toBe(true);
    const outcome = await sendStatement({
      participationId: "p1",
      key: "BEHIND_NOTICE",
      trigger: "MANUAL",
    });
    expect(outcome.status).toBe("SKIPPED");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(messageLogCreate).not.toHaveBeenCalled();
  });

  it("a provider failure writes a FAILED row with the error and no SID", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => twilioErr(21656)));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { sendStatement } = await engine();

    const outcome = await sendStatement({
      participationId: "p1",
      key: "BEHIND_NOTICE",
      trigger: "MANUAL",
    });
    expect(outcome.status).toBe("FAILED");
    const row = messageLogCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(row.data.status).toBe("FAILED");
    expect(row.data.providerSid).toBeNull();
    expect(String(row.data.error)).toContain("21656");
  });
});
