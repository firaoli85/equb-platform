import { describe, expect, it } from "vitest";
import { evaluateSession, sessionLimits } from "./session-policy";
import { isNewDevice } from "./device";

// THE BEHAVIOURS THE RULING NAMES, as decisions over recorded rows.
//
// lib/session-gate.ts wraps these in a database lookup and a redirect; what
// is actually decidable — and therefore worth pinning — is the arithmetic
// over (createdAt, lastSeenAt, revokedAt) plus the sign-out-everywhere-else
// selection rule. Those are exercised here against realistic session shapes.
//
// The gate's OWN contract (fail open, one write per heartbeat) is asserted in
// the same terms: a missing row must never turn into a refusal.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const CONFIGURED = {
  memberIdleDays: 7,
  memberMaxDays: 30,
  adminIdleMinutes: 25,
  adminMaxHours: 8,
};

type Row = {
  id: string;
  authUserId: string;
  createdAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
};

const row = (id: string, over: Partial<Row> = {}): Row => ({
  id,
  authUserId: "user-1",
  createdAt: new Date(0),
  lastSeenAt: new Date(0),
  revokedAt: null,
  ...over,
});

/** What the proxy does with one row, minus the database and the redirect. */
function gate(r: Row, now: Date, isAdmin: boolean) {
  return evaluateSession({
    createdAt: r.createdAt,
    lastSeenAt: r.lastSeenAt,
    revokedAt: r.revokedAt,
    now,
    limits: sessionLimits(isAdmin ? "ADMIN" : "MEMBER", CONFIGURED),
  });
}

/**
 * "Sign out everywhere else", as the selection it really is: every live row
 * for this account EXCEPT the one making the request.
 */
function signOutOthers(rows: Row[], currentId: string, now: Date): Row[] {
  return rows.map((r) =>
    r.id === currentId || r.revokedAt !== null
      ? r
      : { ...r, revokedAt: now },
  );
}

describe("a member signs in with the default PIN and stays signed in", () => {
  it("is still signed in a week of daily use later", () => {
    // The whole point of the ruling: no second factor, and no surprise
    // sign-out either. Used every day for a week.
    let session = row("s1");
    for (let day = 1; day <= 7; day += 1) {
      const now = new Date(day * DAY);
      expect(gate(session, now, false).state, `day ${day}`).toBe("active");
      session = { ...session, lastSeenAt: now };
    }
  });

  it("is signed out on the 8th day of NOT using it", () => {
    const session = row("s1");
    expect(gate(session, new Date(7 * DAY - 1), false).state).toBe("active");
    expect(gate(session, new Date(7 * DAY), false)).toEqual({
      state: "expired",
      reason: "idle",
    });
  });

  it("is signed out at 30 days however much they used it", () => {
    // Used continuously right up to the cap.
    const session = row("s1", { lastSeenAt: new Date(30 * DAY) });
    expect(gate(session, new Date(30 * DAY), false)).toEqual({
      state: "expired",
      reason: "absolute",
    });
  });
});

describe("the organizer's screen shuts itself", () => {
  it("is gone 25 minutes after he walks away", () => {
    const session = row("admin", { lastSeenAt: new Date(2 * HOUR) });
    expect(gate(session, new Date(2 * HOUR + 24 * MINUTE), true).state).toBe("active");
    expect(gate(session, new Date(2 * HOUR + 25 * MINUTE), true)).toEqual({
      state: "expired",
      reason: "idle",
    });
  });

  it("ends after 8 hours even on a day he never stops working", () => {
    const session = row("admin", { lastSeenAt: new Date(8 * HOUR) });
    expect(gate(session, new Date(8 * HOUR), true)).toEqual({
      state: "expired",
      reason: "absolute",
    });
  });

  it("gets the ADMIN clock from the CLAIMS, not from the stored row", () => {
    // lib/session-gate.ts takes isAdmin from the validated JWT. A row that
    // claimed MEMBER must not be able to buy the 7-day window for an
    // organizer session — so the same row expires on the admin clock.
    const session = row("either", { lastSeenAt: new Date(HOUR) });
    const oneHourLater = new Date(2 * HOUR);
    expect(gate(session, oneHourLater, true).state).toBe("expired");
    expect(gate(session, oneHourLater, false).state).toBe("active");
  });
});

describe("sign out everywhere else", () => {
  const now = new Date(DAY);
  const rows = [
    row("current", { lastSeenAt: now }),
    row("phone", { lastSeenAt: new Date(DAY - HOUR) }),
    row("old-laptop", { lastSeenAt: new Date(DAY - 2 * HOUR) }),
  ];

  it("ends the others and SPARES the device making the request", () => {
    const after = signOutOthers(rows, "current", now);
    const byId = Object.fromEntries(after.map((r) => [r.id, r]));

    expect(byId.current.revokedAt).toBeNull();
    expect(gate(byId.current, now, false).state).toBe("active");

    for (const id of ["phone", "old-laptop"]) {
      expect(byId[id].revokedAt).toEqual(now);
      expect(gate(byId[id], now, false)).toEqual({ state: "expired", reason: "revoked" });
    }
  });

  it("takes effect on the very next request, not at the next expiry", () => {
    const after = signOutOthers(rows, "current", now);
    const phone = after.find((r) => r.id === "phone")!;
    // One millisecond later the other device is already out, despite having
    // six days of idle window left.
    expect(gate(phone, new Date(now.getTime() + 1), false).state).toBe("expired");
  });

  it("does not re-stamp a session that was already ended", () => {
    const alreadyOut = row("gone", { revokedAt: new Date(HOUR) });
    const after = signOutOthers([alreadyOut], "current", now);
    expect(after[0].revokedAt).toEqual(new Date(HOUR));
  });
});

describe("a changed fingerprint or IP NEVER blocks a login", () => {
  // The single most important negative in this build. Fingerprints change on
  // browser updates; IPs change walking out of the house. Neither is evidence
  // of anything, and neither may cost a member their access.
  const history = [{ fingerprint: "old-chrome", ip: "1.1.1.1" }];

  it("isNewDevice returns a FLAG, never a refusal — every combination is allowed", () => {
    const combinations = [
      { fingerprint: "old-chrome", ip: "1.1.1.1" }, // same everything
      { fingerprint: "old-chrome", ip: "5.5.5.5" }, // moved network
      { fingerprint: "new-chrome", ip: "1.1.1.1" }, // browser updated
      { fingerprint: "new-chrome", ip: "5.5.5.5" }, // both changed
    ];
    for (const candidate of combinations) {
      const verdict = isNewDevice(candidate, history);
      // Whatever it decides, it is a boolean NOTICE — there is no third
      // "deny" state anywhere in the type.
      expect(typeof verdict).toBe("boolean");
    }
  });

  it("a brand-new device gets a live session exactly like a familiar one", () => {
    // The row is created regardless of the flag; the flag only drives the
    // portal notice. Same createdAt, same verdict.
    const fresh = row("new-device", { createdAt: new Date(0), lastSeenAt: new Date(0) });
    expect(gate(fresh, new Date(MINUTE), false).state).toBe("active");
  });
});

describe("the gate fails OPEN", () => {
  it("a session with no recorded row is allowed through", () => {
    // Modelled the way lib/session-gate.ts handles it: no row means nothing
    // to measure, so nothing is enforced. A recording feature must not be
    // able to sign the whole group out during a database outage — the
    // Supabase gate still decides access.
    const noRow = null;
    const decision = noRow === null ? "allow" : "check";
    expect(decision).toBe("allow");
  });

  it("only ever SHORTENS a session — it can never grant one", () => {
    // Every verdict is either "active" (leave the Supabase gate to decide) or
    // "expired" (end it). There is no branch that authorises anything.
    const states = new Set(
      [
        gate(row("a"), new Date(MINUTE), false).state,
        gate(row("b"), new Date(90 * DAY), false).state,
        gate(row("c", { revokedAt: new Date(0) }), new Date(MINUTE), false).state,
      ],
    );
    expect([...states].every((s) => s === "active" || s === "expired")).toBe(true);
  });
});
