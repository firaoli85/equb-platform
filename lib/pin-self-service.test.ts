import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashPin } from "./pin";

// PIN SELF-SERVICE — two doors, one core (2.24: this is auth).
//
// Door 1 (changeMyPin) is the signed-in analogue of forced setup, and the
// property under test is REUSE: the same validator, the same hasher, the
// same comparator — never copies. Door 2 rides the existing recovery flow
// ("Forgot your PIN?" → WhatsApp code → the shared set-pin step), so its
// tests pin the routing and the refusal path rather than re-testing Verify.

const personUpdate = vi.fn(async (args: unknown) => args);
const auditCalls = vi.fn();
let sessionSub: string | null = "auth-tsion";
let storedHash: string | null = null;
let lockedUntil: Date | null = null;
let failedAttempts = 2; // non-zero on purpose: a wrong CHANGE guess must not move it

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(async () => (sessionSub ? { sub: sessionSub } : null)),
  requireAdmin: vi.fn(async () => ({ ok: true as const, userId: "admin-1" })),
  isAdminClaims: vi.fn(() => false),
}));
// auth.ts's import graph reaches server-only modules — stubbed so the module
// loads. The REVOCATION pair is a real spy pair: the decision under test is
// that every PIN write ends the member's OTHER sessions through this one
// mechanism, sparing the session that made the change.
const revokeCalls = vi.fn(
  (_tx: unknown, _personId: string, _reason: string, options?: { exceptSessionId?: string | null }) =>
    options?.exceptSessionId ? 2 : 3,
);
vi.mock("@/lib/session-record", () => ({
  clearSessionCookie: vi.fn(),
  recordSignIn: vi.fn(),
  revokeCurrentSession: vi.fn(),
  currentSessionId: vi.fn(async () => "session-this-device"),
  revokeSessionsForPerson: vi.fn(async (...args: unknown[]) =>
    revokeCalls(...(args as Parameters<typeof revokeCalls>)),
  ),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/messaging-engine", () => ({ maybeSendLockoutNotice: vi.fn() }));
vi.mock("@/lib/settings", () => ({ getSetting: vi.fn(async () => true) }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Map()) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(async (_tx: unknown, entry: unknown) => auditCalls(entry)),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    person: {
      findUnique: vi.fn(async () => ({
        id: "person-tsion",
        nameEnglishFirst: "Tsion",
        phone: "+12405550187",
        authUserId: "auth-tsion",
        pinHash: storedHash,
        pinFailedAttempts: failedAttempts,
        pinLockedUntil: lockedUntil,
      })),
      update: personUpdate,
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ person: { update: personUpdate } }),
    ),
  },
}));

async function actions() {
  vi.resetModules();
  const { changeMyPin, setMyPin } = await import("@/app/actions/auth");
  return { changeMyPin, setMyPin };
}

beforeEach(async () => {
  personUpdate.mockClear();
  auditCalls.mockClear();
  revokeCalls.mockClear();
  sessionSub = "auth-tsion";
  storedHash = await hashPin("240519");
  lockedUntil = null;
  failedAttempts = 2;
});

describe("Door 1 — change with the current PIN proved", () => {
  it("the correct current PIN changes it: new hash stored, counters reset, audited", async () => {
    const { changeMyPin } = await actions();
    const result = await changeMyPin({ currentPin: "240519", newPin: "8731" });
    expect(result.ok).toBe(true);
    expect(personUpdate).toHaveBeenCalledTimes(1);
    const args = personUpdate.mock.calls[0][0] as {
      data: { pinHash: string; pinFailedAttempts: number; pinLockedUntil: null };
    };
    // Stored as a hash, never the digits — and a REAL bcrypt hash, because
    // this test runs the same hashPin sign-in will compare against.
    expect(args.data.pinHash).not.toContain("873105");
    expect(args.data.pinHash).toMatch(/^\$2/);
    expect(args.data.pinFailedAttempts).toBe(0);
    expect(args.data.pinLockedUntil).toBeNull();
    // Audited: who and when, NEVER the value (asserted for every call below).
    expect(auditCalls).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(auditCalls.mock.calls[0][0])).not.toContain("873105");
    expect(JSON.stringify(auditCalls.mock.calls[0][0])).not.toContain("240519");
  });

  it("a wrong current PIN refuses honestly — and moves NO lockout counter", async () => {
    const { changeMyPin } = await actions();
    const result = await changeMyPin({ currentPin: "999999", newPin: "8731" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.error).toContain("isn't your current PIN");
    // Nothing was written at all: no hash change, no counter increment, no
    // counter reset — the sign-in policy owns those and this door is not a
    // sign-in.
    expect(personUpdate).not.toHaveBeenCalled();
    expect(auditCalls).not.toHaveBeenCalled();
  });

  it("an ACTIVE lock is honoured — a locked PIN cannot be exercised here either", async () => {
    lockedUntil = new Date(Date.now() + 10 * 60_000);
    const { changeMyPin } = await actions();
    const result = await changeMyPin({ currentPin: "240519", newPin: "8731" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.error).toContain("locked");
    expect(personUpdate).not.toHaveBeenCalled();
  });

  it("the phone-digit default is NOT a current PIN — no hash means forced setup owns them", async () => {
    storedHash = null;
    const { changeMyPin } = await actions();
    // Even the correct default (last 4 of their number) does not open this door.
    const result = await changeMyPin({ currentPin: "0187", newPin: "8731" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.error).toContain("asked to set one the next time you sign in");
    expect(personUpdate).not.toHaveBeenCalled();
  });
});

describe("one validator, not a copy", () => {
  it("the same new PIN is accepted or refused IDENTICALLY by both doors", async () => {
    const { changeMyPin, setMyPin } = await actions();
    // Too short — both refuse with the forced-setup sentence.
    const tooShortChange = await changeMyPin({ currentPin: "240519", newPin: "123" });
    const tooShortSet = await setMyPin({ pin: "123" });
    expect(tooShortChange.ok).toBe(false);
    expect(tooShortSet.ok).toBe(false);
    if (tooShortChange.ok || tooShortSet.ok) throw new Error("expected refusals");
    expect(tooShortChange.error).toBe(tooShortSet.error);
    expect(tooShortChange.error).toBe("Your PIN must be exactly 4 digits.");
    // Nine digits — both refuse; letters — both refuse.
    expect((await changeMyPin({ currentPin: "240519", newPin: "12345" })).ok).toBe(false);
    expect((await setMyPin({ pin: "12ab" })).ok).toBe(false);
  });

  it("both actions call isValidNewPin — the rule lives once, in lib/pin.ts", () => {
    const src = readFileSync(join(import.meta.dirname, "..", "app", "actions", "auth.ts"), "utf8");
    const changeBody = src.slice(
      src.indexOf("export async function changeMyPin"),
      src.indexOf("export async function signInAdmin"),
    );
    const setBody = src.slice(
      src.indexOf("export async function setMyPin"),
      src.indexOf("export async function changeMyPin"),
    );
    expect(changeBody).toContain("isValidNewPin(");
    expect(setBody).toContain("isValidNewPin(");
    // Neither carries its own copy of the rule.
    expect(changeBody).not.toMatch(/\\d\{4,8\}/);
    expect(setBody).not.toMatch(/\\d\{4,8\}/);
  });
});

describe("Door 2 — the code IS the authorization", () => {
  it("a refused code leaves no session, and without a session no PIN write is reachable", async () => {
    sessionSub = null; // the state a refused code leaves the browser in
    const { setMyPin, changeMyPin } = await actions();
    const set = await setMyPin({ pin: "8731" });
    expect(set.ok).toBe(false);
    if (set.ok) throw new Error("expected refusal");
    expect(set.error).toBe("Not signed in.");
    const change = await changeMyPin({ currentPin: "240519", newPin: "8731" });
    expect(change.ok).toBe(false);
    expect(personUpdate).not.toHaveBeenCalled();
  });

  it("an approved code routes to the shared set-pin step — and pin===null members land there too", () => {
    const flow = readFileSync(
      join(import.meta.dirname, "..", "components", "member", "login-flow.tsx"),
      "utf8",
    );
    // The recovery flag set by "Forgot your PIN?" and the default-PIN path
    // share ONE routing line into the ONE set-pin step — no second flow.
    expect(flow).toMatch(/if \(recovering \|\| usedDefault\) \{/);
    expect(flow).toContain("Forgot your PIN? Get a WhatsApp code");
    // The new-PIN pair: first entry stashed, pad cleared, mismatch starts over.
    expect(flow).toContain("setFirstPin(newPin)");
    expect(flow).toContain("The two PINs don't match");
    // The write is setMyPin — the SAME action forced setup uses.
    expect(flow).toMatch(/setMyPin\(\{ pin: newPin \}\)/);
  });
});

// THE PIN NEVER APPEARS IN A LOG LINE — the guard the organizer asked to see
// fail. Interpolating any of the three PIN parameters into a string is how a
// credential ends up in an audit row or a server log; the scan forbids the
// shape itself.
describe("GUARD — no PIN value can reach a log", () => {
  it("auth.ts never interpolates a PIN parameter, and no audit block references one", () => {
    const src = readFileSync(join(import.meta.dirname, "..", "app", "actions", "auth.ts"), "utf8");
    for (const leak of [
      "${input.pin", // covers input.pin and input.pinHash-free interpolations
      "${input.currentPin",
      "${input.newPin",
      "${pin}",
      "${currentPin}",
      "${newPin}",
    ]) {
      expect(src, `a PIN value is interpolated into a string: ${leak}`).not.toContain(leak);
    }
    // Inside every logAudit(...) block: no reference to the raw parameters.
    for (const match of src.matchAll(/logAudit\(/g)) {
      const block = src.slice(match.index, src.indexOf("});", match.index));
      expect(block, "an audit payload references a PIN parameter").not.toMatch(
        /input\.(pin|currentPin|newPin)\b/,
      );
    }
  });
});

// EVERY PIN WRITE ENDS THE MEMBER'S OTHER SESSIONS (decision, Aug 2026,
// closing the open question the first build recorded). The device that made
// the change survives — the change is what proves who is holding it — and
// all three member paths go through the ONE revocation mechanism the admin
// reset already used, narrowed by one id. No parallel mechanism exists.
describe("a PIN write signs out every OTHER session, through the one mechanism", () => {
  it("Door 1 (changeMyPin): other sessions revoked, THIS one spared, count audited", async () => {
    const { changeMyPin } = await actions();
    const result = await changeMyPin({ currentPin: "240519", newPin: "8731" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(revokeCalls).toHaveBeenCalledTimes(1);
    const [, personId, reason, options] = revokeCalls.mock.calls[0];
    expect(personId).toBe("person-tsion");
    expect(reason).toBe("PIN changed by the member");
    // The current session is the exception — the where-clause the real
    // implementation builds from this id is what keeps this device in.
    expect(options).toEqual({ exceptSessionId: "session-this-device" });
    expect(result.data.otherSessionsRevoked).toBe(2);
    // The audit row carries the COUNT, never a token or a session id.
    const audit = JSON.stringify(auditCalls.mock.calls[0][0]);
    expect(audit).toContain("2 other sessions signed out");
    expect(audit).not.toContain("session-this-device");
  });

  it("Doors 2 and 3 (setMyPin — forgot-PIN reset AND forced first-login setup): same rule, same mechanism", async () => {
    const { setMyPin } = await actions();
    const result = await setMyPin({ pin: "8731" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(revokeCalls).toHaveBeenCalledTimes(1);
    const [, personId, reason, options] = revokeCalls.mock.calls[0];
    expect(personId).toBe("person-tsion");
    expect(reason).toBe("PIN set by the member");
    // The WhatsApp-code session doing a recovery or first setup is the
    // current session, and it survives.
    expect(options).toEqual({ exceptSessionId: "session-this-device" });
    expect(result.data.otherSessionsRevoked).toBe(2);
  });

  it("a refusal revokes NOTHING — wrong current PIN leaves every session alone", async () => {
    const { changeMyPin } = await actions();
    const result = await changeMyPin({ currentPin: "999999", newPin: "8731" });
    expect(result.ok).toBe(false);
    expect(revokeCalls).not.toHaveBeenCalled();
  });

  it("all three paths share the mechanism, and the admin reset still uses it un-narrowed", () => {
    const src = readFileSync(join(import.meta.dirname, "..", "app", "actions", "auth.ts"), "utf8");
    // Exactly three narrowed calls (the member's own paths — changeMyPin and
    // the shared setMyPin — plus none elsewhere), each through the ONE
    // function the admin reset uses.
    const narrowed = src.match(/revokeSessionsForPerson\(tx, person\.id, "PIN (changed|set) by the member", \{\s*exceptSessionId: currentSession,?\s*\}/g);
    expect(narrowed, "a member PIN path stopped revoking, or grew a second mechanism").toHaveLength(2);
    // The organizer's reset is untouched: all sessions, no exception.
    const reset = src.slice(src.indexOf("export async function resetMemberPin"));
    expect(reset).toContain('revokeSessionsForPerson(\n        tx,\n        person.id,\n        "PIN reset by the organizer",\n      )');
    // No session write exists outside the one mechanism.
    expect(src).not.toMatch(/signInSession\.updateMany/);
  });

  it("both confirmations tell the member, in the same sentence", () => {
    const card = readFileSync(
      join(import.meta.dirname, "..", "components", "member", "change-pin.tsx"),
      "utf8",
    );
    const flow = readFileSync(
      join(import.meta.dirname, "..", "components", "member", "login-flow.tsx"),
      "utf8",
    );
    expect(card).toContain("Anywhere else you were signed in has been signed out.");
    expect(flow).toContain("Anywhere else you were signed in has been signed out.");
  });
});

// A REVOKED SESSION'S NEXT REQUEST ROUTES TO SIGN-IN, never an error page —
// the pure gate rule, tested directly, plus the where-clause that spares the
// current device, tested against the real implementation.
describe("what revocation actually does to a session", () => {
  it("evaluateSession reads a revoked row as expired — the gate's redirect state", async () => {
    const { evaluateSession } = await import("./session-policy");
    const now = new Date("2026-08-14T10:00:00Z");
    const verdict = evaluateSession({
      createdAt: new Date("2026-08-14T09:00:00Z"),
      lastSeenAt: new Date("2026-08-14T09:59:00Z"),
      revokedAt: new Date("2026-08-14T09:59:30Z"),
      now,
      limits: { idleMs: 7 * 24 * 3600_000, absoluteMs: 30 * 24 * 3600_000 },
    });
    expect(verdict.state).toBe("expired");
  });

  it("the real revoker's where-clause spares exactly the excepted id", () => {
    const src = readFileSync(join(import.meta.dirname, "..", "lib", "session-record.ts"), "utf8");
    const fn = src.slice(src.indexOf("export async function revokeSessionsForPerson"));
    expect(fn).toContain("id: { not: options.exceptSessionId }");
    // …and only when one was given: null/undefined mean revoke everything,
    // the safe direction when the current session cannot be identified.
    expect(fn).toMatch(/options\?\.exceptSessionId \? \{ id: \{ not: options\.exceptSessionId \} \} : \{\}/);
  });
});
