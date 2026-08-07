// HOW LONG A SESSION LIVES — pure, so the rule is tested law rather than a
// scatter of comparisons in the proxy.
//
// The organizer's ruling replaced the second factor at the door with limits
// on the SESSION. Two clocks run at once and either one can end it:
//
//   IDLE      — resets every time the session is used (sliding). This is the
//               one that matters day to day: the organizer walks away from a
//               laptop holding everyone's money, and 25 minutes later it is
//               shut whether or not he came back.
//   ABSOLUTE  — measured from sign-in and NEVER extended. Without it, a
//               sliding window alone means a session used daily lives
//               forever, which is exactly what the 30-day cookie cap in
//               lib/supabase/cookie-policy.ts could not fix on its own.
//
// The two roles get very different numbers on purpose. A member checking
// their savings on a phone should not be signed out between visits; the
// organizer's screen holds the whole group's data.
//
// EVERY limit is a setting read at check time (2.6). Nothing here is the
// final word — these constants are only the defaults behind those settings.

export type SessionRole = "MEMBER" | "ADMIN";

export type SessionLimits = {
  /** Sliding: reset on each use. */
  idleMs: number;
  /** From sign-in, never extended. */
  absoluteMs: number;
};

/** Why a session ended — the login page says which, so it is never a mystery. */
export type ExpiryReason = "idle" | "absolute" | "revoked";

export type SessionVerdict =
  | { state: "active"; idleExpiresAt: Date; absoluteExpiresAt: Date }
  | { state: "expired"; reason: ExpiryReason };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Defaults behind the four settings. Never read these directly at check time. */
export const SESSION_LIMIT_DEFAULTS = {
  memberIdleDays: 7,
  memberMaxDays: 30,
  adminIdleMinutes: 25,
  adminMaxHours: 8,
} as const;

/**
 * Turn the configured numbers into the two clocks for a role.
 *
 * A zero or negative configured value would mean "expire instantly", which is
 * a footgun in a settings box, so each falls back to its default. The absolute
 * cap is also floored at the idle window: an absolute shorter than idle would
 * make the idle setting a lie the organizer could not see.
 */
export function sessionLimits(
  role: SessionRole,
  settings: {
    memberIdleDays: number;
    memberMaxDays: number;
    adminIdleMinutes: number;
    adminMaxHours: number;
  },
): SessionLimits {
  const positive = (value: number, fallback: number) =>
    Number.isFinite(value) && value > 0 ? value : fallback;

  const idleMs =
    role === "ADMIN"
      ? positive(settings.adminIdleMinutes, SESSION_LIMIT_DEFAULTS.adminIdleMinutes) * MINUTE
      : positive(settings.memberIdleDays, SESSION_LIMIT_DEFAULTS.memberIdleDays) * DAY;

  const absoluteMs =
    role === "ADMIN"
      ? positive(settings.adminMaxHours, SESSION_LIMIT_DEFAULTS.adminMaxHours) * HOUR
      : positive(settings.memberMaxDays, SESSION_LIMIT_DEFAULTS.memberMaxDays) * DAY;

  return { idleMs, absoluteMs: Math.max(absoluteMs, idleMs) };
}

/**
 * The verdict for one session, right now.
 *
 * Order matters: an explicitly revoked session ("Sign out everywhere else")
 * reports `revoked` even if it was also idle-expired, because that is the
 * fact the member acted on and the one worth showing them.
 */
export function evaluateSession(input: {
  createdAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
  now: Date;
  limits: SessionLimits;
}): SessionVerdict {
  const now = input.now.getTime();
  if (input.revokedAt !== null && input.revokedAt.getTime() <= now) {
    return { state: "expired", reason: "revoked" };
  }

  const absoluteExpiresAt = new Date(input.createdAt.getTime() + input.limits.absoluteMs);
  if (now >= absoluteExpiresAt.getTime()) {
    return { state: "expired", reason: "absolute" };
  }

  const idleExpiresAt = new Date(input.lastSeenAt.getTime() + input.limits.idleMs);
  if (now >= idleExpiresAt.getTime()) {
    return { state: "expired", reason: "idle" };
  }

  return { state: "active", idleExpiresAt, absoluteExpiresAt };
}

/**
 * The sliding half. `lastSeenAt` is what the idle clock reads, so it has to
 * move — but writing it on every request would mean a database write per
 * image, per prefetch, per poll. Move it only once the recorded time is
 * stale by more than the heartbeat, which costs at most one write a minute
 * and can never shorten a session by more than that.
 */
export const SESSION_HEARTBEAT_MS = 60_000;

export function shouldTouch(
  lastSeenAt: Date,
  now: Date,
  heartbeatMs: number = SESSION_HEARTBEAT_MS,
): boolean {
  return now.getTime() - lastSeenAt.getTime() >= heartbeatMs;
}

/**
 * What the login page says after an expiry. Plain, never an error page, and
 * never blaming the member for closing a laptop.
 */
export function expiryNotice(reason: ExpiryReason, role: SessionRole): string {
  switch (reason) {
    case "revoked":
      return "You were signed out of this device from somewhere else. Sign in again to continue.";
    case "absolute":
      return "You've been signed in for a while, so we signed you out. Sign in again to continue.";
    case "idle":
      return role === "ADMIN"
        ? "Signed out after a period of inactivity — the admin screens hold everyone's data. Sign in again to continue."
        : "You haven't used your account in a while, so we signed you out. Sign in again to continue.";
  }
}

/** The query-string marker that carries the reason to the login page. */
export const EXPIRY_PARAM = "expired";

export function isExpiryReason(value: string | null): value is ExpiryReason {
  return value === "idle" || value === "absolute" || value === "revoked";
}
