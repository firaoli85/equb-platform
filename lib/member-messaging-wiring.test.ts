import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TEMPLATES } from "./messages";
import { messagingSubject, type MessagingParticipationRow } from "./messaging-subject";

// THE WIRING, NOT THE FUNCTION (audit gap 8).
//
// lib/messages.test.ts tested `applicableTypes` and nothing else, and it passed
// throughout — because the defect was never inside that function. It was in the
// two lines that fed it:
//
//     cycleClosed:      active === null          // ~line 119
//     participationId:  active?.id ?? null       // ~line 151
//
// where `active` was a participation that had to be ACTIVE inside an ACTIVE
// cycle. Those are mutually exclusive by construction, so the closing statement
// 2.18 requires for EVERY member at cycle end could not be sent from a member's
// profile at any moment of a cycle's life:
//
//   while the cycle ran   → cycleClosed false → "the cycle is still running —
//                           the closing statement is sent when it ends"
//   once it closed        → participationId null → the send card was replaced
//                           wholesale, no applicable list, no preview, and
//                           nothing to send with even if there had been
//
// Meanwhile the BATCH did the obligation correctly (app/actions/messages.ts
// drops the ACTIVE-participation filter for CYCLE_CLOSING_STATEMENT alone) and
// app/actions/cycle-close.ts states the rule out loud: statements "must go out
// BEFORE the status flips". So the platform contained both the rule and its
// contradiction, and every test agreed with both.
//
// The property that was missing is a relationship between two values, so it can
// only be tested where both exist: at the action. These drive the real
// `getMemberMessaging` over a fake database and assert the one thing no unit
// test of a pure function could — that the offer and the means to act on it
// cannot disagree.

// ————————————————— The fake database —————————————————

type Row = MessagingParticipationRow;

let participations: Row[] = [];
/** `phone: string | null` on purpose — a member with none blocks every type. */
let person: {
  id: string;
  nameEnglishFirst: string;
  phone: string | null;
  noMessages: boolean;
} = {
  id: "person-1",
  nameEnglishFirst: "Tsion",
  phone: "+12405550187",
  noMessages: false,
};
/** A recorded payout makes the winner announcement have something to say. */
let drawnPayout: { draw: { week: { weekNumber: number } } } | null = null;
/** The participation row `findUnique` serves — reset by beforeEach. */
let sendStateRow: {
  agreementRequiredAt: Date | null;
  status: string;
  cycle: { status: string };
  person: { nameEnglishFirst: string };
  _count: { payments: number };
};

const cycle = (status: Row["cycle"]["status"], closedAt: Date | null = null) => ({
  status,
  closedAt,
});

vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ ok: true as const, userId: "admin-1" })),
}));

vi.mock("@/lib/settings", () => ({
  // Presentation mode off — the only setting this action reads (2.4).
  getSetting: vi.fn(async () => false),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    person: { findUnique: vi.fn(async () => person) },
    participation: {
      // The WHERE is honoured rather than ignored, so a DRAFT cycle really is
      // excluded by the query the action writes and not merely by the fixture.
      findMany: vi.fn(async (args: { where?: { cycle?: { status?: { in?: string[] } } } }) => {
        const allowed = args?.where?.cycle?.status?.in ?? ["DRAFT", "ACTIVE", "CLOSED"];
        return participations.filter((p) => allowed.includes(p.cycle.status));
      }),
      // ONE ROW SERVES BOTH SELECTS: getMemberMessaging reads the requirement
      // and the paid count; resendWelcome reads the requirement, the statuses
      // and the name. A superset, driven by the mutable fixture below so each
      // test states the world it is about.
      findUnique: vi.fn(async () => sendStateRow),
    },
    messageLog: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    payout: { findFirst: vi.fn(async () => drawnPayout) },
  },
}));

/** Meheret's ground-truth position: $250/week, 20 weeks, money through week 5. */
const FACTS = {
  name: "Tsion",
  weeklyAmount: 25_000,
  weeksCommitted: 20,
  currentCycleWeek: 20,
  finishWeek: 20,
  finishDate: null,
  weeksCredited: 5,
  weeksBehind: 6,
  amountOutstanding: 150_000,
  totalPaid: 125_000,
  lastPaymentWeek: 5,
  weeks: [{ weekNumber: 6, status: "LATE" }],
};

vi.mock("@/lib/messaging-engine", () => ({
  // Standing loads for ANY participation id — the point being that the action,
  // not the engine, decides which id to ask about.
  loadStandingFacts: vi.fn(async (id: string) => ({
    participation: { id },
    standing: { weeksBehind: FACTS.weeksBehind, amountOutstanding: FACTS.amountOutstanding },
    facts: FACTS,
  })),
  loadTemplates: vi.fn(
    async () =>
      new Map(
        Object.entries(DEFAULT_TEMPLATES).map(([key, t]) => [key, { id: `t-${key}`, ...t }]),
      ),
  ),
  sendStatement: vi.fn(async () => ({ status: "ACCEPTED" as const, body: "" })),
}));

vi.mock("@/lib/winner-extras", () => ({
  winnerExtrasForParticipation: vi.fn(async () => ({ drawnWeek: 7, payoutNet: 490_000 })),
}));

type View = Awaited<
  ReturnType<typeof import("@/app/actions/member-messaging").getMemberMessaging>
>;

/** Run the REAL action against whatever the fake database currently holds. */
async function load(): Promise<Extract<View, { ok: true }>["data"]> {
  vi.resetModules();
  const { getMemberMessaging } = await import("@/app/actions/member-messaging");
  const result = await getMemberMessaging({ personId: person.id });
  // 5.20: a refusal must never let a test pass with zero assertions.
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

const closing = (data: Awaited<ReturnType<typeof load>>) =>
  data.types.find((t) => t.key === "CYCLE_CLOSING_STATEMENT")!;

beforeEach(() => {
  participations = [];
  person = { id: "person-1", nameEnglishFirst: "Tsion", phone: "+12405550187", noMessages: false };
  drawnPayout = null;
  sendStateRow = {
    agreementRequiredAt: null,
    status: "ACTIVE",
    cycle: { status: "ACTIVE" },
    person: { nameEnglishFirst: "Tsion" },
    _count: { payments: 1 },
  };
});

// ————————————— The rule, before it reaches a database —————————————

describe("which participation a member's statements are about", () => {
  const live: Row = { id: "p-live", status: "ACTIVE", cycle: cycle("ACTIVE") };
  const stopped: Row = { id: "p-stopped", status: "CLOSED", cycle: cycle("ACTIVE") };
  const lastCycle: Row = {
    id: "p-2025",
    status: "ACTIVE",
    cycle: cycle("CLOSED", new Date("2025-09-28")),
  };
  const older: Row = {
    id: "p-2024",
    status: "ACTIVE",
    cycle: cycle("CLOSED", new Date("2024-09-29")),
  };

  it("prefers the running cycle over every closed one", () => {
    expect(messagingSubject([older, lastCycle, live])).toEqual({
      participationId: "p-live",
      participation: "live",
      cycleClosed: false,
    });
  });

  it("falls back to the member who stopped early — the one the batch keeps (2.18)", () => {
    // prepareBatch drops the ACTIVE-participation filter for the closing
    // statement, so a stopped member still has a final position to state.
    expect(messagingSubject([older, stopped])).toEqual({
      participationId: "p-stopped",
      participation: "ended",
      cycleClosed: false,
    });
  });

  it("uses the most recently CLOSED cycle when nothing is running", () => {
    expect(messagingSubject([older, lastCycle])).toEqual({
      participationId: "p-2025",
      participation: "ended",
      cycleClosed: true,
    });
  });

  it("says 'none' — and holds no id — for a person in no cycle at all", () => {
    expect(messagingSubject([])).toEqual({
      participationId: null,
      participation: "none",
      cycleClosed: false,
    });
  });

  // THE INVARIANT, SWEPT rather than sampled (lesson 5.7). Every combination of
  // the rows a person can have, checked for the two things the old code got
  // wrong: an id without a subject, or a subject without an id.
  it("an id exists exactly when there is a position to state — in EVERY combination", () => {
    const all = [live, stopped, lastCycle, older];
    for (let mask = 0; mask < 1 << all.length; mask++) {
      const rows = all.filter((_, i) => mask & (1 << i));
      const subject = messagingSubject(rows);
      expect(subject.participationId === null, `rows ${mask}`).toBe(
        subject.participation === "none",
      );
      // A live participation lives in a running cycle. The combination the old
      // code produced — "the cycle has closed" AND "here is the live member" —
      // is not constructible.
      if (subject.participation === "live") expect(subject.cycleClosed, `rows ${mask}`).toBe(false);
      if (subject.cycleClosed) {
        expect(rows.find((r) => r.id === subject.participationId)!.cycle.status).toBe("CLOSED");
      }
    }
  });
});

// ————————————— The wiring: the two halves, at the action —————————————

describe("the closing statement can be sent from a profile, in both cycle states", () => {
  // COULD NOT HAVE PASSED BEFORE. With the cycle ACTIVE the old action derived
  // `cycleClosed: active === null` → false, and applicableTypes refused with
  // "The cycle is still running — the closing statement is sent when it ends."
  // The close flow (app/actions/cycle-close.ts) says the opposite in words:
  // statements go out BEFORE the status flips.
  // A LIVE MEMBER OF A RUNNING CYCLE HAS NO FINAL POSITION, so the statement
  // is refused — but it is refused with an ID IN HAND, which is the whole
  // point. The bug was never "it is refused here"; it was that the refusal and
  // the missing id were the same fact, so no state could ever satisfy both.
  it("WHILE THE CYCLE RUNS — an id and a preview exist, and the type is refused honestly", async () => {
    participations = [{ id: "p-live", status: "ACTIVE", cycle: cycle("ACTIVE") }];
    const data = await load();

    expect(data.participationId).toBe("p-live");
    expect(closing(data).applicable).toBe(false);
    expect(closing(data).reason).toContain("still contributing");
    // The chasing types ARE sendable in this state, from the same id — which
    // is what proves the id is real rather than incidental.
    const late = data.types.find((t) => t.key === "LATE_NOTICE")!;
    expect(late.applicable).toBe(true);
    // 2.20: nothing is sent that the organizer has not read first.
    expect(late.preview).toContain("$1,500");
  });

  // COULD NOT HAVE PASSED BEFORE, for the opposite reason: `active` was null, so
  // `participationId` was null, `loaded` was null (no preview could render), and
  // the profile replaced the whole send card with "is not in the running cycle".
  // The offer was on screen in the message centre with nothing behind it.
  it("ONCE THE CYCLE HAS CLOSED — still offered, still with an id and a preview", async () => {
    participations = [
      { id: "p-2026", status: "ACTIVE", cycle: cycle("CLOSED", new Date("2026-09-27")) },
    ];
    const data = await load();

    expect(data.participationId).toBe("p-2026");
    expect(closing(data).applicable).toBe(true);
    expect(closing(data).preview).toContain("Outstanding balance $1,500");
  });

  // 2.18: closed members stay visible and keep their record. The batch includes
  // them in this one statement and nothing else; so does the profile.
  it("TO A MEMBER WHO STOPPED EARLY — offered, while the chases are not", async () => {
    participations = [{ id: "p-stopped", status: "CLOSED", cycle: cycle("ACTIVE") }];
    const data = await load();

    expect(data.participationId).toBe("p-stopped");
    expect(closing(data).applicable).toBe(true);
    for (const key of ["BEHIND_NOTICE", "LATE_NOTICE"] as const) {
      const type = data.types.find((t) => t.key === key)!;
      // Rule 17: stopped is not behind. Their standing still shows six weeks
      // behind — the refusal is about the participation, not the arithmetic.
      expect(type.applicable, key).toBe(false);
      expect(type.reason, key).toContain("stopped contributing");
    }
  });

  it("a DRAFT cycle is not a position to state", async () => {
    // Nothing has happened in one. Excluded by the query itself, so a future
    // reader cannot conclude the fixture was doing the work.
    participations = [{ id: "p-draft", status: "ACTIVE", cycle: cycle("DRAFT") }];
    const data = await load();

    expect(data.participationId).toBeNull();
    expect(closing(data).applicable).toBe(false);
  });
});

describe("the two halves of the send panel can no longer contradict each other", () => {
  /** Every state a person can be in, as the database presents it. */
  const STATES: { name: string; rows: Row[]; noMessages?: boolean; phone?: string | null }[] = [
    { name: "live in the running cycle", rows: [{ id: "p1", status: "ACTIVE", cycle: cycle("ACTIVE") }] },
    { name: "stopped early, cycle running", rows: [{ id: "p2", status: "CLOSED", cycle: cycle("ACTIVE") }] },
    {
      name: "cycle closed",
      rows: [{ id: "p3", status: "ACTIVE", cycle: cycle("CLOSED", new Date("2026-09-27")) }],
    },
    { name: "no participation at all", rows: [] },
    { name: "draft cycle only", rows: [{ id: "p5", status: "ACTIVE", cycle: cycle("DRAFT") }] },
    {
      name: "no phone on file",
      rows: [{ id: "p6", status: "ACTIVE", cycle: cycle("ACTIVE") }],
      phone: null,
    },
    {
      name: "marked no messages (2.28)",
      rows: [{ id: "p7", status: "ACTIVE", cycle: cycle("ACTIVE") }],
      noMessages: true,
    },
  ];

  // THE PROPERTY THAT WAS MISSING, stated once and swept over every state.
  //
  // Both surfaces — the profile card and the message centre's SendFromHere —
  // render a send button for each APPLICABLE type and then call
  // `sendToMember({ participationId: view.participationId!, key })`. Both begin
  // that call with `if (!view.participationId) return;`, which does nothing and
  // says nothing. So an applicable type with no id was a button that swallowed
  // the click in silence, which is precisely what a closed cycle produced.
  it("an offered type always carries the id it would be sent with", async () => {
    for (const state of STATES) {
      participations = state.rows;
      person = {
        ...person,
        phone: state.phone === undefined ? "+12405550187" : state.phone,
        noMessages: state.noMessages ?? false,
      };
      const data = await load();

      const offered = data.types.filter((t) => t.applicable);
      if (offered.length > 0) {
        expect(data.participationId, `${state.name}: offered ${offered.map((t) => t.key)}`).not.toBeNull();
      }
      // And the reverse: nothing is silently offered with no text behind it.
      for (const type of offered) {
        expect(type.preview, `${state.name}: ${type.key} has no preview`).toBeTruthy();
      }
    }
  });

  // 2.18 makes the closing statement an obligation for every member at cycle
  // end. It is therefore the one type whose ABSENCE is a defect, so it gets its
  // own sweep: it is offered in every state where a position exists.
  it("the closing statement is offered wherever a position exists to state", async () => {
    for (const state of STATES) {
      participations = state.rows;
      person = {
        ...person,
        phone: state.phone === undefined ? "+12405550187" : state.phone,
        noMessages: state.noMessages ?? false,
      };
      const data = await load();

      const deliverable = person.phone !== null && !person.noMessages;
      // A FINAL POSITION EXISTS in exactly two shapes, and they are the two
      // the batch reaches: the member's participation has ENDED (2.18 — they
      // stopped while the cycle ran on), or the CYCLE itself has closed.
      //
      // A live member of a running cycle is deliberately NOT one of them. The
      // first repair of this gap made the type applicable there, and the
      // message it produced read "you paid 0 of 20 weeks, $0.00 in total" — a
      // false statement in Meta's approved wording. This sweep is where that
      // would have been caught.
      const row = state.rows[0];
      const hasFinalPosition =
        row !== undefined && (row.status === "CLOSED" || row.cycle.status === "CLOSED");
      expect(closing(data).applicable, state.name).toBe(
        data.participationId !== null && deliverable && hasFinalPosition,
      );
    }
  });

  // 5.15: a reason string that outlives its cause is a lie. Three different
  // states used to produce the same sentence, and two of them were false.
  it("every refusal names the state it is actually in", async () => {
    participations = [];
    let data = await load();
    expect(closing(data).reason).toContain("not in a cycle");
    expect(closing(data).reason).not.toContain("still running");

    participations = [{ id: "p1", status: "CLOSED", cycle: cycle("ACTIVE") }];
    data = await load();
    expect(data.types.find((t) => t.key === "LATE_NOTICE")!.reason).toContain("stopped contributing");

    participations = [
      { id: "p2", status: "ACTIVE", cycle: cycle("CLOSED", new Date("2026-09-27")) },
    ];
    data = await load();
    const late = data.types.find((t) => t.key === "LATE_NOTICE")!;
    expect(late.applicable).toBe(false);
    // 2.19: after the close, what is owed is a ledger balance on the person —
    // chasing a cycle week that no longer exists would be chasing the wrong
    // record.
    expect(late.reason).toContain("carried balance");
  });
});

// ————————————— Both surfaces read the same derivation —————————————

describe("the surfaces that render this view", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const action = read("app/actions/member-messaging.ts");
  const profile = read("app/admin/(protected)/people/[id]/member-messaging.tsx");
  const centre = read("app/admin/(protected)/messages/message-centre.tsx");
  const page = read("app/admin/(protected)/messages/page.tsx");

  /**
   * COMMENTS STRIPPED FIRST. 5.3: an over-strict guard that flags its own
   * documentation gets switched off by whoever meets it next — and this one
   * did exactly that on first run, matching the comment in the action that
   * QUOTES the old `cycleClosed: active === null` line to explain the defect.
   * Deleting the explanation to satisfy the guard would have thrown away the
   * only record of why the code is shaped this way.
   */
  const code = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("the cycle's status is READ, never inferred from a missing participation", () => {
    // The exact shape of the defect, as a mechanical property: two facts, one
    // source. `cycleClosed: active === null` cannot come back unnoticed.
    expect(code(action)).not.toMatch(/cycleClosed:\s*\w+\s*===\s*null/);
    expect(action).toContain("cycleClosed: subject.cycleClosed");
    expect(action).toContain("participation: subject.participation");
    expect(action).toContain("messagingSubject(");
  });

  it("the profile no longer claims a member is 'not in the running cycle'", () => {
    // That sentence was shown to every member of a CLOSED cycle — all 27 of
    // them, on the day the closing statement was meant to go out.
    expect(profile).not.toContain("is not in the running cycle");
    expect(profile).toContain("not the running one, and not a closed one");
  });

  it("the message centre reads the SAME derivation, so the two cannot diverge", () => {
    expect(page).toContain("getMemberMessaging");
    expect(centre).toContain("sendToMember");
    // Both surfaces guard the send on the id; the sweep above is what makes
    // that guard unreachable rather than a silent dead end.
    expect(profile).toContain("if (!view.participationId) return;");
    expect(centre).toContain("if (!view.participationId) return;");
  });
});

// ————————————— The deliberate re-send (organizer, Aug 2026) —————————————
//
// Its server precondition is the MIRROR IMAGE of the ordinary send's: refused
// unless a welcome was already sent. Between them the two actions cover every
// state and neither can be reached by mistaking it for the other.
describe("resendWelcome — refused until it is the deliberate case", () => {
  async function resend() {
    vi.resetModules();
    const { resendWelcome } = await import("@/app/actions/member-messaging");
    return resendWelcome({ participationId: "p-live" });
  }

  it("refuses a member who was never welcomed, and points at the first send", async () => {
    sendStateRow.agreementRequiredAt = null;
    const result = await resend();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error).toContain("has not been welcomed yet");
  });

  it("refuses a stopped member, and a member of a finished cycle", async () => {
    sendStateRow.agreementRequiredAt = new Date("2026-08-10T14:00:00Z");
    sendStateRow.status = "CLOSED";
    const stopped = await resend();
    expect(stopped.ok).toBe(false);
    if (stopped.ok) throw new Error("expected a refusal");
    expect(stopped.error).toContain("no longer contributing");

    sendStateRow.status = "ACTIVE";
    sendStateRow.cycle = { status: "CLOSED" };
    const closed = await resend();
    expect(closed.ok).toBe(false);
    if (closed.ok) throw new Error("expected a refusal");
    expect(closed.error).toContain("no longer contributing");
  });

  it("sends WHATSAPP_WELCOME through the SAME engine path once welcomed", async () => {
    sendStateRow.agreementRequiredAt = new Date("2026-08-10T14:00:00Z");
    vi.resetModules();
    const engine = await import("@/lib/messaging-engine");
    const { resendWelcome } = await import("@/app/actions/member-messaging");
    const result = await resendWelcome({ participationId: "p-live" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    // ACCEPTED passes through with no reason — the engine mock's answer.
    expect(result.data.status).toBe("ACCEPTED");
    expect(result.data.reason).toBeNull();
    // The one path every gate lives in (hardship, opt-out, welcomeSendCheck,
    // the requirement write) — never a second implementation.
    expect(engine.sendStatement).toHaveBeenCalledWith({
      participationId: "p-live",
      key: "WHATSAPP_WELCOME",
      trigger: "MANUAL",
    });
  });
});

// THE MIRROR IS ENFORCED ON BOTH SIDES (verifier finding, 13 Aug). The UI
// stops OFFERING the welcome once sent — but a server action cannot lean on
// what a screen offers (2.21): a stale tab or crafted request through the
// ordinary path would re-gate a member as a routine send.
describe("sendToMember refuses a second welcome — resendWelcome is the only door", () => {
  it("refuses WHATSAPP_WELCOME for an already-welcomed member, naming the card", async () => {
    sendStateRow.agreementRequiredAt = new Date("2026-08-10T14:00:00Z");
    vi.resetModules();
    const { sendToMember } = await import("@/app/actions/member-messaging");
    const result = await sendToMember({ participationId: "p-live", key: "WHATSAPP_WELCOME" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error).toContain("already been sent");
    expect(result.error).toContain("Send the welcome again");
  });

  it("still sends the FIRST welcome through the ordinary path", async () => {
    sendStateRow.agreementRequiredAt = null;
    vi.resetModules();
    const engine = await import("@/lib/messaging-engine");
    const { sendToMember } = await import("@/app/actions/member-messaging");
    const result = await sendToMember({ participationId: "p-live", key: "WHATSAPP_WELCOME" });
    expect(result.ok).toBe(true);
    expect(engine.sendStatement).toHaveBeenCalledWith(
      expect.objectContaining({ key: "WHATSAPP_WELCOME" }),
    );
  });
});

// THE CARD NEVER OUTLIVES THE ACTION (verifier finding, 13 Aug): a stopped
// member's participation keeps its agreementRequiredAt forever, and a card
// keyed on the timestamp alone would render a button resendWelcome refuses
// every time — an offer without the means to act on it.
describe("welcomeSentAt reaches the view only while the re-send can succeed", () => {
  const welcomedAt = new Date("2026-08-10T14:00:00Z");

  it("carries the timestamp for a live member of the running cycle", async () => {
    participations.push({ id: "p-live", status: "ACTIVE", cycle: cycle("ACTIVE") });
    sendStateRow.agreementRequiredAt = welcomedAt;
    const data = await load();
    expect(data.welcomeSentAt).toBe(welcomedAt.toISOString());
  });

  it("is null for a stopped member and for a closed cycle, whatever the row says", async () => {
    sendStateRow.agreementRequiredAt = welcomedAt;
    participations.push({ id: "p-stopped", status: "CLOSED", cycle: cycle("ACTIVE") });
    expect((await load()).welcomeSentAt).toBeNull();

    participations.length = 0;
    participations.push({
      id: "p-2025",
      status: "ACTIVE",
      cycle: cycle("CLOSED", new Date("2026-09-28")),
    });
    expect((await load()).welcomeSentAt).toBeNull();
  });
});
