"use server";

import { CAPS, truncationNotice } from "@/lib/paging";
import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/action-result";
import { getCurrentUser, isAdminClaims, requireAdmin } from "@/lib/auth";
import { newDeviceNotice } from "@/lib/device";
import { prisma } from "@/lib/prisma";
import { currentSessionId } from "@/lib/session-record";
import {
  evaluateSession,
  sessionLimits,
  type SessionRole,
} from "@/lib/session-policy";
import { getSetting } from "@/lib/settings";

// WHERE YOU ARE SIGNED IN (rulings 4, 5, 6).
//
// The member sees their own sessions and can end the others. The organizer
// sees his own, and — on a member's page — that member's recent sign-ins, so
// when someone asks "was that me?" there is an answer instead of a shrug.
//
// PRIVACY (2.8). A member sees only their own rows; the organizer sees a
// member's sign-in history because he is the one who has to answer for it,
// and never another member's session TOKEN — that is hashed and never leaves
// the database in any shape.

export type SessionView = {
  id: string;
  label: string;
  browser: string;
  os: string;
  deviceType: string;
  location: string | null;
  ip: string;
  method: string;
  startedAt: string;
  lastSeenAt: string;
  /** The device the viewer is holding right now. Never offered for sign-out. */
  isCurrent: boolean;
  isNewDevice: boolean;
};

async function limitsFor(role: SessionRole) {
  return sessionLimits(role, {
    memberIdleDays: await getSetting("memberSessionIdleDays"),
    memberMaxDays: await getSetting("memberSessionMaxDays"),
    adminIdleMinutes: await getSetting("adminSessionIdleMinutes"),
    adminMaxHours: await getSetting("adminSessionMaxHours"),
  });
}

/**
 * The viewer's own live sessions, newest first.
 *
 * "Live" is decided by the SAME evaluateSession the proxy uses, not by
 * `revokedAt IS NULL` alone: a session can be past its idle window without
 * anyone having made a request to notice yet, and listing it as active would
 * be a lie the member could act on.
 */
export async function listMySessions(): Promise<
  | { ok: true; data: SessionView[]; notice: string | null }
  | { ok: false; error: string }
> {
  try {
    const claims = await getCurrentUser();
    if (!claims) return { ok: false as const, error: "Not signed in." };

    const role: SessionRole = isAdminClaims(claims) ? "ADMIN" : "MEMBER";
    const limits = await limitsFor(role);
    const now = new Date();
    const currentId = await currentSessionId();

    // THE CAP HAS TO ANNOUNCE ITSELF. `take` alone is a silent truncation, and
    // this is the list a member reads to answer "is anything signed in that
    // should not be?" — a quietly-cut answer to that question is the worst
    // kind. `lib/query-bounds.test.ts` found this one: every other cap in the
    // platform was paired with a notice, and this was not.
    const rows = await prisma.signInSession.findMany({
      where: { authUserId: claims.sub, revokedAt: null },
      orderBy: { lastSeenAt: "desc" },
      take: CAPS.ownSessions,
    });

    const live = rows.filter(
      (r) =>
        evaluateSession({
          createdAt: r.createdAt,
          lastSeenAt: r.lastSeenAt,
          revokedAt: r.revokedAt,
          now,
          limits,
        }).state === "active",
    );

    return {
      ok: true as const,
      /** Null when nothing was cut — a list that fits says nothing at all. */
      notice: truncationNotice({
        shown: rows.length,
        cap: CAPS.ownSessions,
        noun: "signed-in devices",
      }),
      data: live.map((r) => ({
        id: r.id,
        label: `${r.browser} on ${r.os}`,
        browser: r.browser,
        os: r.os,
        deviceType: r.deviceType,
        location: r.location,
        ip: r.ip,
        method: r.method,
        startedAt: r.createdAt.toISOString(),
        lastSeenAt: r.lastSeenAt.toISOString(),
        isCurrent: r.id === currentId,
        isNewDevice: r.isNewDevice,
      })),
    };
  } catch (e) {
    console.error("listMySessions failed:", e);
    return { ok: false as const, error: `Could not load your sessions. ${errorMessage(e)}` };
  }
}

/**
 * "Sign out everywhere else." Ends every other session for this account and
 * spares the one making the request — which is the whole reason the handle
 * cookie exists.
 *
 * If the current session somehow has no row (an old session from before this
 * shipped), NOTHING is revoked rather than everything: signing the member out
 * of the device in their hand while they are using it is the one outcome this
 * action must never produce.
 */
export async function signOutEverywhereElse() {
  try {
    const claims = await getCurrentUser();
    if (!claims) return { ok: false as const, error: "Not signed in." };

    const currentId = await currentSessionId();
    if (!currentId) {
      return {
        ok: false as const,
        error:
          "This device isn't recognised yet, so signing out the others would sign you out too. " +
          "Sign out and back in once, then try again.",
      };
    }

    const result = await prisma.signInSession.updateMany({
      where: { authUserId: claims.sub, revokedAt: null, id: { not: currentId } },
      data: { revokedAt: new Date(), revokedReason: "Signed out from another device" },
    });

    revalidatePath("/me");
    revalidatePath("/admin/settings");
    return { ok: true as const, data: { endedCount: result.count } };
  } catch (e) {
    console.error("signOutEverywhereElse failed:", e);
    return { ok: false as const, error: `Could not sign the others out. ${errorMessage(e)}` };
  }
}

/**
 * The unread new-device notice for the signed-in member, or null.
 *
 * Deliberately NOT tied to the current session: a member who signs in on a
 * new phone and then opens their laptop should still see that the phone
 * happened. Any unread notice from the last 30 days shows.
 *
 * Built so a WhatsApp or SMS send can attach later without rework — the
 * wording comes from lib/device.ts `newDeviceNotice`, which is pure and takes
 * no request context, so a messaging job can call it with the same row and
 * produce the identical sentence.
 */
export async function myNewDeviceNotice(): Promise<
  { ok: true; data: { sessionId: string; message: string } | null } | { ok: false; error: string }
> {
  try {
    const claims = await getCurrentUser();
    if (!claims) return { ok: true as const, data: null };

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const row = await prisma.signInSession.findFirst({
      where: {
        authUserId: claims.sub,
        isNewDevice: true,
        noticeSeenAt: null,
        createdAt: { gte: thirtyDaysAgo },
      },
      orderBy: { createdAt: "desc" },
    });
    if (!row) return { ok: true as const, data: null };

    return {
      ok: true as const,
      data: {
        sessionId: row.id,
        message: newDeviceNotice({
          label: `${row.browser} on ${row.os}`,
          location: row.location,
          when: row.createdAt.toLocaleDateString("en-US", {
            day: "numeric",
            month: "short",
            timeZone: "UTC",
          }),
        }),
      },
    };
  } catch (e) {
    console.error("myNewDeviceNotice failed:", e);
    return { ok: false as const, error: errorMessage(e) };
  }
}

/** Mark the notice read so it stops showing. Their own rows only. */
export async function dismissNewDeviceNotice(input: { sessionId: string }) {
  try {
    const claims = await getCurrentUser();
    if (!claims) return { ok: false as const, error: "Not signed in." };
    await prisma.signInSession.updateMany({
      where: { id: input.sessionId, authUserId: claims.sub },
      data: { noticeSeenAt: new Date() },
    });
    revalidatePath("/me");
    return { ok: true as const, data: { dismissed: true } };
  } catch (e) {
    console.error("dismissNewDeviceNotice failed:", e);
    return { ok: false as const, error: errorMessage(e) };
  }
}

export type AdminSignInRow = {
  id: string;
  label: string;
  location: string | null;
  ip: string;
  method: string;
  startedAt: string;
  lastSeenAt: string;
  isActive: boolean;
  isNewDevice: boolean;
  endedReason: string | null;
};

/**
 * ADMIN (ruling 6): a member's recent sign-ins, so the organizer can answer
 * "was that you?". Includes ended sessions — the question is almost always
 * about one that is already over.
 */
export async function listMemberSignIns(input: { personId: string }): Promise<
  | { ok: true; data: { total: number; rows: AdminSignInRow[] } }
  | { ok: false; error: string }
> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    // 2.4: the sign-in history is device and network detail about a named
    // person — exactly what presentation mode exists to keep off a shared
    // screen.
    if (await getSetting("presentationMode"))
      return { ok: true as const, data: { total: 0, rows: [] } };

    const limits = await limitsFor("MEMBER");
    const now = new Date();
    // Capped at 25 and, until now, silently — the screen showed a list
    // that looked complete. It answers "was that really them?", so a reader
    // has to know whether they are looking at all of it. The count comes back
    // with the rows and the screen states the truncation when it happens.
    const signInTotal = await prisma.signInSession.count({
      where: { personId: input.personId },
    });
    const rows = await prisma.signInSession.findMany({
      where: { personId: input.personId },
      orderBy: { createdAt: "desc" },
      take: CAPS.memberSignIns,
    });

    return {
      ok: true as const,
      data: {
        // The TRUE count travels with the capped rows, so the screen can say
        // "25 of 63" rather than presenting 25 as the whole history.
        total: signInTotal,
        rows: rows.map((r) => ({
        id: r.id,
        label: `${r.browser} on ${r.os}`,
        location: r.location,
        ip: r.ip,
        method: r.method,
        startedAt: r.createdAt.toISOString(),
        lastSeenAt: r.lastSeenAt.toISOString(),
        isActive:
          evaluateSession({
            createdAt: r.createdAt,
            lastSeenAt: r.lastSeenAt,
            revokedAt: r.revokedAt,
            now,
            limits,
          }).state === "active",
        isNewDevice: r.isNewDevice,
        endedReason: r.revokedReason,
        })),
      },
    };
  } catch (e) {
    console.error("listMemberSignIns failed:", e);
    return { ok: false as const, error: `Could not load sign-ins. ${errorMessage(e)}` };
  }
}
