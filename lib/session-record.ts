import "server-only";
import { Prisma } from "./generated/prisma/client";

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import {
  approximateLocation,
  describeDevice,
  deviceFingerprint,
  isNewDevice,
  type DeviceSignals,
} from "./device";
import { prisma } from "./prisma";
import { SESSION_COOKIE_MAX_AGE_SECONDS } from "./supabase/cookie-policy";
import { SESSION_COOKIE_NAME } from "./session-cookie";
import type { SessionRole } from "./session-policy";

// THE WRITE SIDE of the session record: read the headers a sign-in arrived
// with, store a row, and hand the browser an opaque handle to it.
//
// The handle is a separate cookie from Supabase's. It has to be: the Supabase
// session says WHO you are, and this says WHICH sign-in you are on — which is
// the only way "sign out everywhere else" can spare the device you are
// holding, and the only way two clocks can run per device rather than per
// account.
//
// NOTHING HERE MAY REFUSE A SIGN-IN. Every function is best-effort: if the
// database is unreachable at exactly the wrong moment, the member still gets
// in, just without a row. That is the correct trade for a login path — a
// recording feature that can lock out 26 people is worse than no recording.

export { SESSION_COOKIE_NAME };

/** Sign-in doors, recorded so a member can tell how a session was opened. */
export type SignInMethod = "PIN" | "WHATSAPP" | "SMS" | "PASSWORD";

/**
 * The cookie carries a random token; the table stores only its SHA-256. A
 * plain hash (not bcrypt) is right here: the token is 32 random bytes, so
 * there is no dictionary to attack and the proxy has to look it up on every
 * single request.
 */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Everything about the request that a session row records. */
export type RequestFacts = {
  signals: DeviceSignals;
  ip: string;
  location: string | null;
};

type HeaderBag = { get(name: string): string | null };

/**
 * Pull the facts out of the request headers. The client hints are only sent
 * by Chromium browsers; Safari and Firefox supply the user agent alone, which
 * describeDevice handles — a missing hint degrades the label, never the login.
 */
export function requestFacts(header: HeaderBag, ip: string): RequestFacts {
  return {
    signals: {
      userAgent: header.get("user-agent"),
      chUa: header.get("sec-ch-ua"),
      chPlatform: header.get("sec-ch-ua-platform"),
      chMobile: header.get("sec-ch-ua-mobile"),
    },
    ip,
    // Platform-provided geo headers only — no lookup service is called.
    location: approximateLocation({
      city: header.get("x-vercel-ip-city"),
      region: header.get("x-vercel-ip-country-region"),
      country: header.get("x-vercel-ip-country"),
    }),
  };
}

export type RecordedSignIn = {
  /** False when the row could not be written — the sign-in still stands. */
  recorded: boolean;
  /** True only for a genuinely unfamiliar device AND network (lib/device.ts). */
  isNewDevice: boolean;
  sessionId: string | null;
};

/**
 * Record one sign-in and set the handle cookie.
 *
 * `authUserId` is looked up from the person when not supplied, so callers on
 * the member paths do not have to thread it through. For the organizer there
 * is no Person row, so it is passed directly.
 */
export async function recordSignIn(input: {
  personId?: string | null;
  authUserId?: string | null;
  role?: SessionRole;
  method: SignInMethod;
  header: HeaderBag;
  ip: string;
  now?: Date;
}): Promise<RecordedSignIn> {
  const failed: RecordedSignIn = { recorded: false, isNewDevice: false, sessionId: null };
  try {
    const now = input.now ?? new Date();
    const role: SessionRole = input.role ?? (input.personId ? "MEMBER" : "ADMIN");

    let authUserId = input.authUserId ?? null;
    if (!authUserId && input.personId) {
      const person = await prisma.person.findUnique({
        where: { id: input.personId },
        select: { authUserId: true },
      });
      authUserId = person?.authUserId ?? null;
    }
    // Without an auth user there is nothing to tie the row to. The member is
    // already signed in at this point; skip the record rather than fail.
    if (!authUserId) return failed;

    const facts = requestFacts(input.header, input.ip);
    const device = describeDevice(facts.signals);
    const fingerprint = deviceFingerprint(facts.signals);

    // "New" is judged against this person's OWN history, including sessions
    // that have since expired or been revoked — a device they used last month
    // and signed out of is not a new device.
    const history = await prisma.signInSession.findMany({
      where: input.personId ? { personId: input.personId } : { authUserId },
      select: { fingerprint: true, ip: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    const newDevice = isNewDevice({ fingerprint, ip: facts.ip }, history);

    const token = newSessionToken();
    const session = await prisma.signInSession.create({
      data: {
        authUserId,
        personId: input.personId ?? null,
        role,
        method: input.method,
        tokenHash: hashSessionToken(token),
        fingerprint,
        userAgent: facts.signals.userAgent ?? "",
        browser: device.browser,
        os: device.os,
        deviceType: device.deviceType,
        ip: facts.ip,
        location: facts.location,
        isNewDevice: newDevice,
        createdAt: now,
        lastSeenAt: now,
      },
      select: { id: true },
    });

    const jar = await cookies();
    jar.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      // The row's own clocks decide when the session ends; this only bounds
      // how long the browser keeps the handle, and matches the Supabase
      // cookie so the two never drift apart.
      maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    });

    return { recorded: true, isNewDevice: newDevice, sessionId: session.id };
  } catch (e) {
    // Deliberately swallowed. See the note at the top of the file.
    console.error("recordSignIn failed (sign-in still stands):", e);
    return failed;
  }
}

/** The current request's session row id, or null. Read-only, never throws. */
export async function currentSessionId(): Promise<string | null> {
  try {
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE_NAME)?.value;
    if (!token) return null;
    const row = await prisma.signInSession.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      select: { id: true },
    });
    return row?.id ?? null;
  } catch {
    return null;
  }
}

/** Drop the handle cookie — called alongside Supabase sign-out. */
export async function clearSessionCookie(): Promise<void> {
  try {
    const jar = await cookies();
    jar.set(SESSION_COOKIE_NAME, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  } catch {
    // Outside a request scope; nothing to clear.
  }
}

/**
 * End the CURRENT session (ordinary sign-out). The row is kept and marked,
 * never deleted — the member's history is the whole point of recording it.
 */
export async function revokeCurrentSession(reason = "Signed out"): Promise<void> {
  try {
    const id = await currentSessionId();
    if (id) {
      await prisma.signInSession.updateMany({
        where: { id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: reason },
      });
    }
  } catch (e) {
    console.error("revokeCurrentSession failed:", e);
  }
  await clearSessionCookie();
}

/**
 * End every session this member has open, from the organizer's side.
 *
 * THE GAP THIS CLOSES. A member reports that someone else got into her
 * account. The organizer opens her Settings tab, sees the intruder's row under
 * "Recent sign-ins" with a green "Signed in" pill, and does the one thing that
 * page offers: Reset PIN. That cleared `pinHash` and nothing else — the
 * intruder's SignInSession row still read revokedAt = null and his Supabase
 * cookies still validated, so he kept full access to /me for up to seven more
 * idle days. There was no action anywhere in the codebase that could end a
 * member's session.
 *
 * Changing a credential must end the sessions that credential opened. The rows
 * are REVOKED, never deleted — the history is what lets the member recognise
 * the intruder's device later, and lets the organizer answer "was that you?"
 * months from now (2.14).
 */
export async function revokeSessionsForPerson(
  tx: Prisma.TransactionClient,
  personId: string,
  reason: string,
  options?: {
    /**
     * A session to SPARE — the member's own, when they are the one changing
     * the credential (decision, Aug 2026): the device that made the change
     * stays signed in, everywhere else goes. The organizer's reset passes
     * nothing and keeps ending everything, which is right for HIS case —
     * he is not on any of her devices.
     *
     * Null and undefined both mean "spare nothing": when the current session
     * cannot be identified, revoking everything is the safe direction for a
     * change whose whole motive is worry.
     */
    exceptSessionId?: string | null;
  },
): Promise<number> {
  const result = await tx.signInSession.updateMany({
    where: {
      personId,
      revokedAt: null,
      ...(options?.exceptSessionId ? { id: { not: options.exceptSessionId } } : {}),
    },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return result.count;
}
