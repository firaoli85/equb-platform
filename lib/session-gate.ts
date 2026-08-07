import { createHash } from "node:crypto";
import { prisma } from "./prisma";
import {
  evaluateSession,
  sessionLimits,
  shouldTouch,
  type ExpiryReason,
  type SessionRole,
} from "./session-policy";
import { getSetting } from "./settings";

// THE READ SIDE, run by the proxy on every request. Given the handle cookie,
// decide whether this session is still alive — and slide the idle clock when
// it is.
//
// COST. This is the hot path, so it is one indexed lookup by tokenHash, plus
// a `lastSeenAt` write at most once a minute (see shouldTouch). The four
// limit settings are fetched only when a row was actually found, so requests
// from signed-out visitors do no settings work at all.
//
// FAIL OPEN, DELIBERATELY. If the database is unreachable, `allow` is
// returned: a session-recording feature must not be able to sign the whole
// group out during an outage. The Supabase session gate in the proxy still
// runs, so an unauthenticated request is still refused — this layer only ever
// SHORTENS a session, never grants one.

export type SessionGateResult =
  | { state: "allow" }
  | { state: "expired"; reason: ExpiryReason; role: SessionRole };

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * @param token the raw handle cookie value, or null/undefined when absent.
 * @param isAdmin from the validated JWT claims — NOT from the session row, so
 *        a tampered row could never buy the longer member window for an
 *        organizer session.
 */
export async function checkSession(input: {
  token: string | null | undefined;
  isAdmin: boolean;
  now?: Date;
}): Promise<SessionGateResult> {
  const now = input.now ?? new Date();
  const role: SessionRole = input.isAdmin ? "ADMIN" : "MEMBER";

  // No handle at all. This is a session that predates the record — the
  // organizer's current one, on the day this ships — or a browser that lost
  // the cookie. There is nothing to measure, so it cannot be enforced; the
  // Supabase gate still applies and the next sign-in gets a row.
  if (!input.token) return { state: "allow" };

  try {
    const session = await prisma.signInSession.findUnique({
      where: { tokenHash: hashToken(input.token) },
      select: { id: true, createdAt: true, lastSeenAt: true, revokedAt: true },
    });
    // A handle we do not recognise (revoked long ago and pruned, or forged)
    // buys nothing — but it also must not lock out a valid Supabase session.
    if (!session) return { state: "allow" };

    const limits = sessionLimits(role, {
      memberIdleDays: await getSetting("memberSessionIdleDays"),
      memberMaxDays: await getSetting("memberSessionMaxDays"),
      adminIdleMinutes: await getSetting("adminSessionIdleMinutes"),
      adminMaxHours: await getSetting("adminSessionMaxHours"),
    });

    const verdict = evaluateSession({
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      revokedAt: session.revokedAt,
      now,
      limits,
    });

    if (verdict.state === "expired") {
      // Mark it once so the member's own session list shows it ended and why,
      // rather than a row that silently stops updating.
      if (session.revokedAt === null) {
        await prisma.signInSession.updateMany({
          where: { id: session.id, revokedAt: null },
          data: {
            revokedAt: now,
            revokedReason: verdict.reason === "idle" ? "Idle timeout" : "Maximum session age",
          },
        });
      }
      return { state: "expired", reason: verdict.reason, role };
    }

    // The sliding half — throttled so this is not a write per request.
    if (shouldTouch(session.lastSeenAt, now)) {
      await prisma.signInSession.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { lastSeenAt: now },
      });
    }
    return { state: "allow" };
  } catch (e) {
    console.error("checkSession failed (allowing — see lib/session-gate.ts):", e);
    return { state: "allow" };
  }
}
