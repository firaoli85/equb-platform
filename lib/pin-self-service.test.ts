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
// auth.ts's import graph reaches server-only modules the two actions under
// test never call — stubbed so the module loads, never exercised.
vi.mock("@/lib/session-record", () => ({
  clearSessionCookie: vi.fn(),
  recordSignIn: vi.fn(),
  revokeCurrentSession: vi.fn(),
  revokeSessionsForPerson: vi.fn(),
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
  sessionSub = "auth-tsion";
  storedHash = await hashPin("240519");
  lockedUntil = null;
  failedAttempts = 2;
});

describe("Door 1 — change with the current PIN proved", () => {
  it("the correct current PIN changes it: new hash stored, counters reset, audited", async () => {
    const { changeMyPin } = await actions();
    const result = await changeMyPin({ currentPin: "240519", newPin: "873105" });
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
    const result = await changeMyPin({ currentPin: "999999", newPin: "873105" });
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
    const result = await changeMyPin({ currentPin: "240519", newPin: "873105" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.error).toContain("locked");
    expect(personUpdate).not.toHaveBeenCalled();
  });

  it("the phone-digit default is NOT a current PIN — no hash means forced setup owns them", async () => {
    storedHash = null;
    const { changeMyPin } = await actions();
    // Even the correct default (last 4 of their number) does not open this door.
    const result = await changeMyPin({ currentPin: "0187", newPin: "873105" });
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
    expect(tooShortChange.error).toBe("PIN must be 4 to 8 digits.");
    // Nine digits — both refuse; letters — both refuse.
    expect((await changeMyPin({ currentPin: "240519", newPin: "123456789" })).ok).toBe(false);
    expect((await setMyPin({ pin: "12ab" })).ok).toBe(false);
  });

  it("both actions call isValidPinFormat — the rule lives once, in lib/pin.ts", () => {
    const src = readFileSync(join(import.meta.dirname, "..", "app", "actions", "auth.ts"), "utf8");
    const changeBody = src.slice(
      src.indexOf("export async function changeMyPin"),
      src.indexOf("export async function signInAdmin"),
    );
    const setBody = src.slice(
      src.indexOf("export async function setMyPin"),
      src.indexOf("export async function changeMyPin"),
    );
    expect(changeBody).toContain("isValidPinFormat(");
    expect(setBody).toContain("isValidPinFormat(");
    // Neither carries its own copy of the rule.
    expect(changeBody).not.toMatch(/\\d\{4,8\}/);
    expect(setBody).not.toMatch(/\\d\{4,8\}/);
  });
});

describe("Door 2 — the code IS the authorization", () => {
  it("a refused code leaves no session, and without a session no PIN write is reachable", async () => {
    sessionSub = null; // the state a refused code leaves the browser in
    const { setMyPin, changeMyPin } = await actions();
    const set = await setMyPin({ pin: "873105" });
    expect(set.ok).toBe(false);
    if (set.ok) throw new Error("expected refusal");
    expect(set.error).toBe("Not signed in.");
    const change = await changeMyPin({ currentPin: "240519", newPin: "873105" });
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
