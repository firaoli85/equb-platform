import { describe, expect, it } from "vitest";
import {
  evaluateSession,
  expiryNotice,
  isExpiryReason,
  SESSION_LIMIT_DEFAULTS,
  sessionLimits,
  shouldTouch,
  type SessionLimits,
} from "./session-policy";

// The organizer's ruling traded a door nobody could pass for limits on the
// session. These tests are that trade, stated: both clocks, both roles.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const CONFIGURED = {
  memberIdleDays: 7,
  memberMaxDays: 30,
  adminIdleMinutes: 25,
  adminMaxHours: 8,
};

const at = (ms: number) => new Date(ms);

function alive(input: {
  createdAt: number;
  lastSeenAt: number;
  now: number;
  limits: SessionLimits;
}) {
  return evaluateSession({
    createdAt: at(input.createdAt),
    lastSeenAt: at(input.lastSeenAt),
    revokedAt: null,
    now: at(input.now),
    limits: input.limits,
  });
}

describe("the configured limits (2.6 — read at check time, never hardcoded)", () => {
  it("gives the organizer 25 idle MINUTES and members 7 idle DAYS", () => {
    expect(sessionLimits("ADMIN", CONFIGURED).idleMs).toBe(25 * MINUTE);
    expect(sessionLimits("MEMBER", CONFIGURED).idleMs).toBe(7 * DAY);
  });

  it("caps the organizer at 8 hours and members at 30 days", () => {
    expect(sessionLimits("ADMIN", CONFIGURED).absoluteMs).toBe(8 * HOUR);
    expect(sessionLimits("MEMBER", CONFIGURED).absoluteMs).toBe(30 * DAY);
  });

  it("follows a CHANGED setting — the numbers are not baked in", () => {
    const strict = sessionLimits("ADMIN", { ...CONFIGURED, adminIdleMinutes: 5 });
    expect(strict.idleMs).toBe(5 * MINUTE);
    const generous = sessionLimits("MEMBER", { ...CONFIGURED, memberIdleDays: 14 });
    expect(generous.idleMs).toBe(14 * DAY);
  });

  it("falls back to the default rather than expiring instantly on a 0 or negative", () => {
    // A settings box is a place a typo lands. "0 minutes" must not mean
    // "sign the organizer out mid-keystroke, forever".
    for (const bad of [0, -5, Number.NaN]) {
      expect(sessionLimits("ADMIN", { ...CONFIGURED, adminIdleMinutes: bad }).idleMs).toBe(
        SESSION_LIMIT_DEFAULTS.adminIdleMinutes * MINUTE,
      );
      expect(sessionLimits("MEMBER", { ...CONFIGURED, memberIdleDays: bad }).idleMs).toBe(
        SESSION_LIMIT_DEFAULTS.memberIdleDays * DAY,
      );
    }
  });

  it("never lets the absolute cap fall below the idle window", () => {
    // Otherwise the idle setting would be a lie the organizer cannot see.
    const limits = sessionLimits("ADMIN", { ...CONFIGURED, adminIdleMinutes: 600, adminMaxHours: 1 });
    expect(limits.absoluteMs).toBe(limits.idleMs);
  });
});

describe("IDLE expiry — sliding, and it slides", () => {
  const admin = sessionLimits("ADMIN", CONFIGURED);
  const member = sessionLimits("MEMBER", CONFIGURED);

  it("the organizer is signed out 25 minutes after his LAST use", () => {
    // Signed in at 0, last used at 60 minutes: still alive at 84, gone at 85.
    expect(alive({ createdAt: 0, lastSeenAt: 60 * MINUTE, now: 84 * MINUTE, limits: admin }).state)
      .toBe("active");
    const dead = alive({ createdAt: 0, lastSeenAt: 60 * MINUTE, now: 85 * MINUTE, limits: admin });
    expect(dead).toEqual({ state: "expired", reason: "idle" });
  });

  it("USING it extends it — that is what sliding means", () => {
    // Same sign-in, same wall-clock moment; only lastSeenAt differs.
    const moment = 200 * MINUTE;
    expect(alive({ createdAt: 0, lastSeenAt: 10 * MINUTE, now: moment, limits: admin }).state)
      .toBe("expired");
    expect(alive({ createdAt: 0, lastSeenAt: 190 * MINUTE, now: moment, limits: admin }).state)
      .toBe("active");
  });

  it("a member is not signed out between visits — 6 days idle is fine", () => {
    expect(alive({ createdAt: 0, lastSeenAt: 0, now: 6 * DAY, limits: member }).state)
      .toBe("active");
    expect(alive({ createdAt: 0, lastSeenAt: 0, now: 7 * DAY, limits: member }))
      .toEqual({ state: "expired", reason: "idle" });
  });
});

describe("ABSOLUTE expiry — from sign-in, never extended", () => {
  const admin = sessionLimits("ADMIN", CONFIGURED);
  const member = sessionLimits("MEMBER", CONFIGURED);

  it("ends the organizer's session at 8 hours even while he is actively using it", () => {
    // lastSeenAt === now: as active as a session can be. The cap still wins.
    const verdict = alive({
      createdAt: 0,
      lastSeenAt: 8 * HOUR,
      now: 8 * HOUR,
      limits: admin,
    });
    expect(verdict).toEqual({ state: "expired", reason: "absolute" });
  });

  it("ends a member's session at 30 days of continuous use", () => {
    expect(alive({ createdAt: 0, lastSeenAt: 30 * DAY, now: 30 * DAY, limits: member }))
      .toEqual({ state: "expired", reason: "absolute" });
    expect(alive({ createdAt: 0, lastSeenAt: 29 * DAY, now: 29 * DAY, limits: member }).state)
      .toBe("active");
  });

  it("reports ABSOLUTE, not idle, when both have run out", () => {
    // The absolute cap is the more honest explanation: extending use would
    // not have saved this session.
    expect(alive({ createdAt: 0, lastSeenAt: 0, now: 90 * DAY, limits: member }))
      .toEqual({ state: "expired", reason: "absolute" });
  });

  it("an active session reports both deadlines, so the UI can show them", () => {
    const verdict = alive({ createdAt: 0, lastSeenAt: HOUR, now: HOUR, limits: admin });
    expect(verdict).toEqual({
      state: "active",
      idleExpiresAt: at(HOUR + 25 * MINUTE),
      absoluteExpiresAt: at(8 * HOUR),
    });
  });
});

describe("REVOKED — 'sign out everywhere else' takes effect immediately", () => {
  const member = sessionLimits("MEMBER", CONFIGURED);

  it("a revoked session is expired even though both clocks have time left", () => {
    expect(
      evaluateSession({
        createdAt: at(0),
        lastSeenAt: at(DAY),
        revokedAt: at(DAY),
        now: at(DAY + MINUTE),
        limits: member,
      }),
    ).toEqual({ state: "expired", reason: "revoked" });
  });

  it("reports REVOKED ahead of idle — that is the fact the member acted on", () => {
    expect(
      evaluateSession({
        createdAt: at(0),
        lastSeenAt: at(0),
        revokedAt: at(DAY),
        now: at(90 * DAY),
        limits: member,
      }).state,
    ).toBe("expired");
    expect(
      evaluateSession({
        createdAt: at(0),
        lastSeenAt: at(0),
        revokedAt: at(DAY),
        now: at(90 * DAY),
        limits: member,
      }),
    ).toEqual({ state: "expired", reason: "revoked" });
  });

  it("a revocation timestamped in the FUTURE does not end it yet", () => {
    expect(
      evaluateSession({
        createdAt: at(0),
        lastSeenAt: at(0),
        revokedAt: at(2 * DAY),
        now: at(DAY),
        limits: member,
      }).state,
    ).toBe("active");
  });
});

describe("the heartbeat — sliding without a write per request", () => {
  it("does not touch a session that was seen seconds ago", () => {
    expect(shouldTouch(at(0), at(30_000))).toBe(false);
  });

  it("touches once the record is a minute stale", () => {
    expect(shouldTouch(at(0), at(60_000))).toBe(true);
    expect(shouldTouch(at(0), at(5 * MINUTE))).toBe(true);
  });

  it("can never shorten a session by more than one heartbeat", () => {
    // The worst case: used continuously, but lastSeenAt lags by the interval.
    const limits = sessionLimits("ADMIN", CONFIGURED);
    const lag = 59_999;
    expect(alive({ createdAt: 0, lastSeenAt: HOUR - lag, now: HOUR, limits }).state).toBe("active");
  });
});

describe("what the member is told", () => {
  it("explains an idle sign-out differently for the organizer", () => {
    expect(expiryNotice("idle", "ADMIN")).toContain("inactivity");
    expect(expiryNotice("idle", "MEMBER")).toContain("haven't used your account");
  });

  it("never shows an error — every reason has plain wording and a next step", () => {
    for (const reason of ["idle", "absolute", "revoked"] as const) {
      for (const role of ["MEMBER", "ADMIN"] as const) {
        const text = expiryNotice(reason, role);
        expect(text.length).toBeGreaterThan(20);
        expect(text).toContain("Sign in again");
        expect(text.toLowerCase()).not.toContain("error");
      }
    }
  });

  it("only accepts reasons it can actually explain", () => {
    expect(isExpiryReason("idle")).toBe(true);
    expect(isExpiryReason("absolute")).toBe(true);
    expect(isExpiryReason("revoked")).toBe(true);
    expect(isExpiryReason("banana")).toBe(false);
    expect(isExpiryReason(null)).toBe(false);
  });
});
