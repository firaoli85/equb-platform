"use server";

import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { firebaseConfigured, verifyFirebaseIdToken } from "@/lib/firebase-verify";
import { getCurrentUser, isAdminClaims, requireAdmin } from "@/lib/auth";
import { allowLookup, callerIp, LOOKUP_THROTTLE_MESSAGE } from "@/lib/lookup-throttle";
import { maybeSendLockoutNotice } from "@/lib/messaging-engine";
import {
  hashPin,
  isPinLocked,
  isValidPinFormat,
  lockoutAfterFailure,
  requiresSecondFactor,
  verifyPin,
} from "@/lib/pin";
import { findPeopleByPhone } from "@/lib/people-lookup";
import { samePhone, toE164 } from "@/lib/phone";
import { prisma, serializableTransaction } from "@/lib/prisma";
import { clearSessionCookie, recordSignIn, revokeCurrentSession, revokeSessionsForPerson } from "@/lib/session-record";
import { getSetting } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { checkWhatsAppVerification, sendWhatsAppVerification } from "@/lib/whatsapp";

const GENERIC_PIN_ERROR = "Phone number or PIN is incorrect.";
const PIN_DISABLED_ERROR =
  "PIN sign-in is turned off. Use the WhatsApp code instead.";

/**
 * The internal bridge credential: after the PIN verifies, the server signs
 * the member into Supabase with a password only the server can derive. The
 * member's real credential is the PIN; this secret never leaves the server.
 * Retiring PIN login later removes this file's PIN path — nothing else.
 */
function bridgePassword(authUserId: string): string {
  return createHmac("sha256", process.env.AUTH_BRIDGE_SECRET!)
    .update(authUserId)
    .digest("base64url");
}

/**
 * Synthetic, never-deliverable identity for the PIN bridge (.invalid is the
 * RFC-reserved TLD). Members never see it, and it keeps PIN login working
 * even while the project's Phone auth provider / SMS sender is not yet
 * configured. The OTP path attaches the real phone to the same auth user
 * once phone auth is enabled.
 */
function bridgeEmail(personId: string): string {
  return `pin-${personId}@members.invalid`;
}

/**
 * Convert an ALREADY-VERIFIED person into the bridge Supabase session —
 * shared by the PIN path and the WhatsApp-code path so both end in the
 * identical session (same RLS, same requireMember). Callers must have
 * verified the member's real credential (PIN or WhatsApp code) first.
 */
async function mintBridgeSession(person: {
  id: string;
  authUserId: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  // Ensure a Supabase auth user exists and is linked. The bridge uses a
  // synthetic email identity so it works with or without the Phone auth
  // provider being enabled.
  const admin = createAdminClient();
  let authUserId = person.authUserId;
  if (!authUserId) {
    const created = await admin.auth.admin.createUser({
      email: bridgeEmail(person.id),
      email_confirm: true,
    });
    if (created.error || !created.data.user) {
      console.error("mintBridgeSession createUser failed:", created.error);
      return {
        ok: false as const,
        error: "Could not set up your sign-in — contact the organizer.",
      };
    }
    authUserId = created.data.user.id;
    await prisma.person.update({ where: { id: person.id }, data: { authUserId } });
  }

  // The auth user may predate the bridge (e.g. created by OTP) and lack an
  // email identity — give it the synthetic one; members never use email.
  const existing = await admin.auth.admin.getUserById(authUserId);

  // SECURITY (audit C4): the member paths must never mint an ORGANIZER
  // session. If a Person row ever points at the admin auth user — one phone
  // claim on that account is enough (see linkCurrentUserToPerson) — passing
  // that person's PIN would otherwise hand out `is_admin` and, worse, the
  // password reset below would silently lock the organizer out of
  // /admin/login. Refuse before touching anything.
  if (existing.data.user?.app_metadata?.is_admin === true) {
    console.error("mintBridgeSession refused: target auth user carries the admin claim", {
      personId: person.id,
    });
    return {
      ok: false as const,
      error: "This number belongs to the organizer — use the organizer sign-in page.",
    };
  }

  let signInEmail = existing.data.user?.email || null;
  if (!signInEmail) {
    const withEmail = await admin.auth.admin.updateUserById(authUserId, {
      email: bridgeEmail(person.id),
      email_confirm: true,
    });
    if (withEmail.error) {
      console.error("mintBridgeSession bridge email failed:", withEmail.error);
      return { ok: false as const, error: "Could not sign you in — contact the organizer." };
    }
    signInEmail = bridgeEmail(person.id);
  }

  // SECURITY (audit C4): do NOT rewrite the password on every sign-in. It is
  // set once — on the first bridge for this auth user — and only re-set if a
  // sign-in actually fails (a drifted or never-set password). In steady state
  // this path performs zero privileged writes against the account.
  const password = bridgePassword(authUserId);
  const supabase = await createClient();
  let signIn = await supabase.auth.signInWithPassword({ email: signInEmail, password });

  if (signIn.error) {
    const setPw = await admin.auth.admin.updateUserById(authUserId, { password });
    if (setPw.error) {
      console.error("mintBridgeSession bridge password failed:", setPw.error);
      return { ok: false as const, error: "Could not sign you in — contact the organizer." };
    }
    signIn = await supabase.auth.signInWithPassword({ email: signInEmail, password });
  }

  if (signIn.error) {
    console.error("mintBridgeSession bridge sign-in failed:", signIn.error);
    return { ok: false as const, error: "Could not sign you in — contact the organizer." };
  }
  return { ok: true as const };
}

/**
 * Member sign-in with phone + PIN (transition period; default method).
 * Both toggles are enforced HERE, server-side (2.6): the global
 * pinLoginEnabled setting and the per-person pinLoginAllowed override —
 * never by the UI merely hiding the option. Ends in the same Supabase
 * session as the OTP path, so RLS and requireMember are identical.
 */
export async function signInWithPin(input: { phone: string; pin: string }) {
  try {
    const phone = input.phone?.trim();
    const pin = input.pin?.trim();
    if (!phone || !pin) return { ok: false as const, error: GENERIC_PIN_ERROR };

    // SECURITY (audit C3): this was the ONLY unauthenticated endpoint with no
    // throttle at all — the per-person counter alone let an attacker sweep the
    // whole directory for `members × maxAttempts` free guesses per window.
    // Throttled before any database work, per caller and per tried number.
    const header = await headers();
    const ip = callerIp(header);
    if (!allowLookup(`pin-ip:${ip}`) || !allowLookup(`pin-phone:${toE164(phone)}`)) {
      return { ok: false as const, error: LOOKUP_THROTTLE_MESSAGE };
    }

    // Digit-based matching, same as the lookup step — a formatted or
    // autofilled number must never fail a member who exists.
    const candidates = await findPeopleByPhone(phone);
    if (candidates.length === 0) return { ok: false as const, error: GENERIC_PIN_ERROR };

    const globallyEnabled = await getSetting("pinLoginEnabled");
    const allowed = candidates.filter((p) => p.pinLoginAllowed ?? globallyEnabled);
    if (allowed.length === 0) return { ok: false as const, error: PIN_DISABLED_ERROR };

    // The phone-digit default (2.6): checked at sign-in only, never stored,
    // and only for members with NO real PIN — evaluatePinAttempt enforces
    // both, plus the lockout. The lockout LIMITS are settings, read here at
    // check time — never hardcoded (2.6).
    const allowDefaultFromPhone = await getSetting("defaultPinFromPhone");
    const maxAttempts = await getSetting("pinMaxAttempts");
    const lockMinutes = await getSetting("pinLockMinutes");

    const now = new Date();
    const matches: typeof allowed = [];
    const usedDefaultFor = new Set<string>();
    let lockedUntil: Date | null = null;
    for (const person of allowed) {
      // SECURITY (audit C3): RESERVE the attempt with an atomic increment
      // BEFORE comparing. Postgres serializes this row update, so concurrent
      // requests each receive a distinct attemptNumber — N simultaneous
      // guesses consume N, and the lock trips exactly on schedule. Reading
      // the counter first and writing an absolute value afterwards (the old
      // shape) let every racer read 0 and write 1.
      const reserved = await prisma.person.update({
        where: { id: person.id },
        data: { pinFailedAttempts: { increment: 1 } },
        select: { pinFailedAttempts: true, pinLockedUntil: true, pinHash: true, phone: true },
      });

      if (isPinLocked(reserved.pinLockedUntil, now)) {
        // The attempt is still consumed — fail closed.
        if (!lockedUntil || reserved.pinLockedUntil! > lockedUntil) {
          lockedUntil = reserved.pinLockedUntil;
        }
        continue;
      }

      const verdict = await verifyPin(reserved, pin, { allowDefaultFromPhone });
      if (verdict.result === "no-pin") continue;

      if (verdict.result === "match") {
        matches.push(person);
        if (verdict.usedDefault) usedDefaultFor.add(person.id);
        continue;
      }

      const after = lockoutAfterFailure({
        attemptNumber: reserved.pinFailedAttempts,
        maxAttempts,
        lockMinutes,
        now,
      });
      await prisma.person.update({
        where: { id: person.id },
        data: { pinFailedAttempts: after.failedAttempts, pinLockedUntil: after.lockedUntil },
      });
      if (after.lockedUntil) {
        if (!lockedUntil || after.lockedUntil > lockedUntil) lockedUntil = after.lockedUntil;
        // This attempt TRIPPED the lock — tell them on WhatsApp (2.28),
        // best-effort and behind the notifyOnLockout setting. The outcome
        // lands in MessageLog either way.
        await maybeSendLockoutNotice(person.id, lockMinutes);
      }
    }

    if (matches.length === 0) {
      if (lockedUntil) {
        const minutesLeft = Math.max(
          1,
          Math.ceil((lockedUntil.getTime() - now.getTime()) / 60_000),
        );
        return {
          ok: false as const,
          error:
            `Too many attempts. Your account is locked for about ${minutesLeft} more ` +
            `minute${minutesLeft === 1 ? "" : "s"} — it unlocks by itself. ` +
            "Or use the WhatsApp code to sign in now.",
        };
      }
      return { ok: false as const, error: GENERIC_PIN_ERROR };
    }
    if (matches.length > 1) {
      return {
        ok: false as const,
        error: "This phone and PIN match more than one member — contact the organizer.",
      };
    }
    const person = matches[0];

    // Success: clear the failure counter.
    await prisma.person.update({
      where: { id: person.id },
      data: { pinFailedAttempts: 0, pinLockedUntil: null },
    });

    // ORGANIZER'S RULING: the phone-digit default signs in DIRECTLY. The old
    // C2 branch returned here without a session and demanded a code first —
    // which, with the code channels down, locked out every member who had not
    // set their own PIN. requiresSecondFactor now returns false for everyone
    // and carries the full reasoning; the risk is answered by the session
    // layer instead of at the door.
    const usedDefaultPin = usedDefaultFor.has(person.id);
    if (requiresSecondFactor({ usedDefault: usedDefaultPin })) {
      // Unreachable under the current ruling — requiresSecondFactor returns
      // false for everyone. Kept as the single place a future gate would go,
      // so re-introducing one is an edit to lib/pin.ts and nothing else.
      return {
        ok: false as const,
        error: "A second step is required — use the code instead.",
      };
    }

    const session = await mintBridgeSession(person);
    if (!session.ok) return session;

    // AWARENESS, not blocking (ruling 2/5): record the device, browser and IP
    // behind this session and report whether the combination is new. Failure
    // here must never cost anyone their sign-in.
    const signIn = await recordSignIn({
      personId: person.id,
      method: "PIN",
      header,
      ip,
    });

    return {
      ok: true as const,
      data: {
        needsSecondFactor: false as const,
        personId: person.id as string | null,
        name: person.nameEnglishFirst as string | null,
        // True when the phone-digit default got them in — the client shows
        // an encouraging, SKIPPABLE "set your own PIN" prompt (never a wall).
        usedDefaultPin,
        newDevice: signIn.isNewDevice,
      },
    };
  } catch (e) {
    console.error("signInWithPin failed:", e);
    return { ok: false as const, error: `Could not sign you in. ${errorMessage(e)}` };
  }
}

/**
 * MEMBER: set their own PIN for their own record — offered right after a
 * default-PIN sign-in. From that moment the phone-digit default is dead for
 * them (rule 1): the hash exists, so sign-in only ever compares the hash.
 */
export async function setMyPin(input: { pin: string }) {
  try {
    const claims = await getCurrentUser();
    if (!claims) return { ok: false as const, error: "Not signed in." };
    if (!isValidPinFormat(input.pin)) {
      return { ok: false as const, error: "PIN must be 4 to 8 digits." };
    }
    const person = await prisma.person.findUnique({ where: { authUserId: claims.sub } });
    if (!person) return { ok: false as const, error: "No member record is linked to this sign-in." };
    await prisma.person.update({
      where: { id: person.id },
      data: {
        pinHash: await hashPin(input.pin),
        pinFailedAttempts: 0,
        pinLockedUntil: null,
      },
    });
    return { ok: true as const, data: { set: true } };
  } catch (e) {
    console.error("setMyPin failed:", e);
    return { ok: false as const, error: `Could not save your PIN. ${errorMessage(e)}` };
  }
}

/**
 * ORGANIZER sign-in, performed SERVER-side (audit H2).
 *
 * This used to run in the browser via createBrowserClient, which stores the
 * session with document.cookie — and a cookie written by JavaScript can
 * never be httpOnly. That left the most privileged session in the platform
 * readable by any script on the page, no matter what the server-side cookie
 * policy said. Signing in here routes the cookie write through the server
 * client, so hardenSessionCookie applies (httpOnly, secure in production,
 * sameSite lax, 30-day cap) exactly as it does for members.
 *
 * The is_admin claim lives in app_metadata, which only the service role can
 * write — a member can never grant it to themselves (lib/auth.ts).
 */
export async function signInAdmin(input: { email: string; password: string }) {
  try {
    const email = input.email?.trim();
    const password = input.password;
    if (!email || !password) {
      return { ok: false as const, error: "Email and password are required." };
    }

    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) {
      // One message for both causes — never reveal which accounts exist.
      return { ok: false as const, error: "Email or password is incorrect." };
    }
    if (data.user.app_metadata?.is_admin !== true) {
      // A real member's credentials must not leave an admin-shaped session
      // behind on a failed admin sign-in.
      await supabase.auth.signOut();
      return { ok: false as const, error: "This account is not the organizer." };
    }

    // The organizer's session is recorded exactly like a member's — it is the
    // one that most needs the 25-minute idle clock and a list he can review.
    // There is no Person row for him, so the auth user is passed directly.
    const header = await headers();
    await recordSignIn({
      authUserId: data.user.id,
      role: "ADMIN",
      method: "PASSWORD",
      header,
      ip: callerIp(header),
    });

    return { ok: true as const, data: { signedIn: true } };
  } catch (e) {
    console.error("signInAdmin failed:", e);
    return { ok: false as const, error: `Could not sign you in. ${errorMessage(e)}` };
  }
}

/**
 * Step 1 of WhatsApp sign-in (2.28: the only OTP channel that actually
 * works): send a 6-digit code to the member's WhatsApp via Twilio Verify —
 * the Meta-approved integration ported from the previous build. Throttled
 * like the lookup step so the sender cannot be used to spam members.
 */
export async function requestWhatsAppCode(input: { phone: string }) {
  try {
    const phone = input.phone?.trim();
    if (!phone) return { ok: false as const, error: "Enter your phone number." };

    const header = await headers();
    const ip = callerIp(header);
    if (!allowLookup(`wa-send-ip:${ip}`) || !allowLookup(`wa-send:${toE164(phone)}`)) {
      return { ok: false as const, error: LOOKUP_THROTTLE_MESSAGE };
    }

    const candidates = await findPeopleByPhone(phone);
    if (candidates.length === 0) {
      return {
        ok: false as const,
        error: "That number isn't registered. Check it, or contact the organizer.",
      };
    }

    const result = await sendWhatsAppVerification(toE164(phone));
    if (!result.ok) {
      // Provider/config failures are OUR problem, not the member's — log the
      // real reason, say so plainly.
      console.error("requestWhatsAppCode send failed:", result.error);
      return {
        ok: false as const,
        error: "Could not send the WhatsApp code right now — contact the organizer.",
      };
    }
    return { ok: true as const, data: { sent: true } };
  } catch (e) {
    console.error("requestWhatsAppCode failed:", e);
    return { ok: false as const, error: `Could not send the code. ${errorMessage(e)}` };
  }
}

/**
 * Step 2: check the WhatsApp code with Twilio Verify and, when approved,
 * mint the SAME bridge session as the PIN path. The code proves control of
 * the phone line; as in the previous build, the first directory match wins
 * when a line is shared.
 */
export async function signInWithWhatsAppCode(input: { phone: string; code: string }) {
  try {
    const phone = input.phone?.trim();
    const code = input.code?.trim();
    if (!phone || !code || !/^\d{4,10}$/.test(code)) {
      return { ok: false as const, error: "Enter the code from WhatsApp." };
    }

    const header = await headers();
    const ip = callerIp(header);
    if (!allowLookup(`wa-check-ip:${ip}`) || !allowLookup(`wa-check:${toE164(phone)}`)) {
      return { ok: false as const, error: LOOKUP_THROTTLE_MESSAGE };
    }

    const candidates = await findPeopleByPhone(phone);
    if (candidates.length === 0) {
      return { ok: false as const, error: "Phone number not found." };
    }
    const person = candidates[0];

    const check = await checkWhatsAppVerification(toE164(phone), code);
    if (check !== "approved") {
      // ONE SENTENCE PER OUTCOME, and the last one is why this exists.
      //
      // This used to be two buckets: 404 → "has expired", everything else →
      // "That code is not right." A Twilio outage, a rate limit, bad
      // credentials and missing config all told the member they had mistyped
      // a code that was perfectly correct — sending them to retype it, which
      // could not work, instead of telling them to wait or to contact the
      // organizer. Blaming a member for our own failure is the defect.
      const MESSAGES: Record<Exclude<typeof check, "approved">, string> = {
        "wrong-code": "That code isn't right — check the most recent message and try again.",
        "no-verification": "That code is no longer valid — request a new one.",
        "rate-limited": "Too many attempts — wait a few minutes and try again.",
        unavailable:
          "We couldn't check your code just now — this is on our side, not yours. " +
          "Try again in a moment.",
      };
      // The OUTCOME travels with the message, unchanged — the mapping above is
      // untouched. The screen needs to know WHICH failure this was, because
      // the remedy differs: a dead verification is fixed by sending again, an
      // outage on our side is not, and an error that names an action the
      // screen cannot offer is the 2.10 gap this closes.
      return { ok: false as const, error: MESSAGES[check], outcome: check };
    }

    const session = await mintBridgeSession(person);
    if (!session.ok) return session;

    const signIn = await recordSignIn({
      personId: person.id,
      method: "WHATSAPP",
      header,
      ip,
    });

    return {
      ok: true as const,
      data: {
        personId: person.id,
        name: person.nameEnglishFirst,
        newDevice: signIn.isNewDevice,
      },
    };
  } catch (e) {
    console.error("signInWithWhatsAppCode failed:", e);
    return { ok: false as const, error: `Could not sign you in. ${errorMessage(e)}` };
  }
}

/**
 * SMS sign-in via Firebase Phone Auth (restored Aug 2026).
 *
 * Firebase sends the code from Google's own infrastructure, so it needs no
 * carrier A2P registration — the TCR ruling in 2.28 was about sending OUR
 * OWN messages, which Firebase genuinely cannot do and which stays on
 * WhatsApp. A login code is a different thing entirely.
 *
 * The client passes the Firebase ID TOKEN it received after confirming the
 * code, never a bare phone number. The token is verified against Google
 * (lib/firebase-verify.ts) and the phone it proves must be the SAME line as
 * the one being signed in as — checked with the ONE canonical comparison
 * (audit H1), so a token for another number can never open this door.
 *
 * Ends in the IDENTICAL bridge session as the PIN and WhatsApp paths.
 */
export async function signInWithFirebaseSms(input: { phone: string; idToken: string }) {
  try {
    const phone = input.phone?.trim();
    if (!phone) return { ok: false as const, error: "Enter your phone number." };
    if (!firebaseConfigured()) {
      return { ok: false as const, error: "SMS sign-in is not available." };
    }

    const header = await headers();
    const ip = callerIp(header);
    if (!allowLookup(`sms-ip:${ip}`) || !allowLookup(`sms:${toE164(phone)}`)) {
      return { ok: false as const, error: LOOKUP_THROTTLE_MESSAGE };
    }

    // Proof first: Google validates the token's signature, audience and
    // expiry, and tells us which phone it actually verified.
    const verified = await verifyFirebaseIdToken(input.idToken);
    if (!verified.ok) return { ok: false as const, error: verified.error };

    // The verified line must be the line being signed in as. Without this a
    // valid token for ANY number would sign in as whoever was typed.
    if (!samePhone(verified.phoneNumber, phone)) {
      console.error("signInWithFirebaseSms: verified phone does not match the typed number");
      return {
        ok: false as const,
        error: "That code was for a different number. Start again with the number you verified.",
      };
    }

    const candidates = await findPeopleByPhone(verified.phoneNumber);
    if (candidates.length === 0) {
      return {
        ok: false as const,
        error: "That number isn't registered. Check it, or contact the organizer.",
      };
    }
    const person = candidates[0];

    const session = await mintBridgeSession(person);
    if (!session.ok) return session;

    const signIn = await recordSignIn({
      personId: person.id,
      method: "SMS",
      header,
      ip,
    });

    return {
      ok: true as const,
      data: {
        personId: person.id,
        name: person.nameEnglishFirst,
        newDevice: signIn.isNewDevice,
      },
    };
  } catch (e) {
    console.error("signInWithFirebaseSms failed:", e);
    return { ok: false as const, error: `Could not sign you in. ${errorMessage(e)}` };
  }
}

/**
 * After a first-ever OTP sign-in there is an auth user but possibly no link
 * to a Person yet. Link by exact phone match when it is unambiguous.
 */
export async function linkCurrentUserToPerson() {
  try {
    const claims = await getCurrentUser();
    if (!claims) return { ok: false as const, error: "Not signed in." };

    // SECURITY (audit C4): never bind the ORGANIZER's auth identity to a
    // directory Person. That binding is the precondition for the member PIN
    // path minting an admin session, and it is reachable the moment a phone
    // is attached to the admin account. The organizer uses /admin/login.
    if (isAdminClaims(claims)) {
      return {
        ok: false as const,
        error: "The organizer account cannot be linked to a member record.",
      };
    }

    const existing = await prisma.person.findUnique({ where: { authUserId: claims.sub } });
    if (existing) return { ok: true as const, data: existing };

    const phone = typeof claims.phone === "string" ? claims.phone : null;
    if (!phone) return { ok: false as const, error: "No member record is linked to this sign-in." };

    // Audit H1: this is a BINDING — it attaches an auth identity to a
    // directory person — so it must use the SAME canonical comparison as
    // lookup and sending, not its own string matching. The old
    // `OR: [{ phone }, { phone: "+" + phone }]` was a second normalisation:
    // it missed every directory entry stored in a formatted shape and
    // matched on raw text rather than the canonical number.
    const candidates = await prisma.person.findMany({
      where: { authUserId: null, phone: { not: null } },
    });
    const unlinked = candidates.filter((p) => p.phone !== null && samePhone(p.phone, phone));
    if (unlinked.length !== 1) {
      return {
        ok: false as const,
        error: "No member record is linked to this sign-in — contact the organizer.",
      };
    }
    const person = await prisma.person.update({
      where: { id: unlinked[0].id },
      data: { authUserId: claims.sub },
    });
    return { ok: true as const, data: person };
  } catch (e) {
    console.error("linkCurrentUserToPerson failed:", e);
    return { ok: false as const, error: `Could not link this sign-in. ${errorMessage(e)}` };
  }
}

/** ADMIN: set or reset a member's PIN (stored as a bcrypt hash only). */
export async function setMemberPin(input: { personId: string; pin: string }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    if (!isValidPinFormat(input.pin)) {
      return { ok: false as const, error: "PIN must be 4 to 8 digits." };
    }
    const person = await prisma.person.findUnique({ where: { id: input.personId } });
    if (!person) return { ok: false as const, error: "Person not found." };

    const hadOwnPin = person.pinHash !== null;
    const hash = await hashPin(input.pin);

    // AUDITED (2.23). This action had no audit entry at all, while the two
    // actions either side of it — unlock and reset — both write one. It is the
    // one place the ORGANIZER LEARNS AND SETS a member's credential, so it is
    // the one that most needs a record: afterwards, someone other than the
    // member knows a PIN that can open their account.
    //
    // The PIN itself is never recorded, only that it was set and by whom.
    await serializableTransaction(async (tx) => {
      await tx.person.update({
        where: { id: input.personId },
        data: { pinHash: hash, pinFailedAttempts: 0, pinLockedUntil: null },
      });
      // Replacing a compromised PIN must also end the sessions the old one
      // opened. The audit entry below already acknowledges the risk — "the
      // organizer knows this PIN" — and leaving the intruder signed in was
      // the other half of the same problem.
      const endedSessions = await revokeSessionsForPerson(
        tx,
        input.personId,
        "PIN changed by the organizer",
      );
      await logAudit(tx, {
        entity: "Person",
        entityId: input.personId,
        action: "update",
        summary:
          `Organizer ${hadOwnPin ? "REPLACED" : "set"} ${person.nameEnglishFirst}'s PIN. ` +
          `The organizer knows this PIN — the member should change it. ` +
          `Any lock and failed-attempt count were cleared.` +
          (endedSessions > 0
            ? ` ${endedSessions} open session${endedSessions === 1 ? "" : "s"} ended, so anyone signed in with the old PIN is out.`
            : ""),
        before: { hadOwnPin, pinFailedAttempts: person.pinFailedAttempts, pinLockedUntil: person.pinLockedUntil },
        after: { hadOwnPin: true, pinFailedAttempts: 0, pinLockedUntil: null },
      });
    });

    revalidatePath(`/admin/people/${input.personId}`);
    revalidatePath("/admin/audit");
    return { ok: true as const, data: { personId: input.personId, replaced: hadOwnPin } };
  } catch (e) {
    console.error("setMemberPin failed:", e);
    return { ok: false as const, error: `Could not save the PIN. ${errorMessage(e)}` };
  }
}

/**
 * ADMIN: clear a member's PIN lock and failure counter (2.23) — for the
 * member who is stuck NOW and should not have to wait out the timer.
 */
export async function unlockMemberPin(input: { personId: string }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const person = await prisma.person.findUnique({ where: { id: input.personId } });
    if (!person) return { ok: false as const, error: "Person not found." };
    if (person.pinFailedAttempts === 0 && person.pinLockedUntil === null) {
      return { ok: true as const, data: { alreadyUnlocked: true } };
    }

    await prisma.$transaction(async (tx) => {
      await tx.person.update({
        where: { id: person.id },
        data: { pinFailedAttempts: 0, pinLockedUntil: null },
      });
      await logAudit(tx, {
        entity: "Person",
        entityId: person.id,
        action: "update",
        summary: `Unlocked PIN sign-in for ${person.nameEnglishFirst}`,
        before: {
          pinFailedAttempts: person.pinFailedAttempts,
          pinLockedUntil: person.pinLockedUntil,
        },
        after: { pinFailedAttempts: 0, pinLockedUntil: null },
      });
    });

    revalidatePath(`/admin/people/${person.id}`);
    revalidatePath("/admin/people");
    revalidatePath("/admin");
    return { ok: true as const, data: { alreadyUnlocked: false } };
  } catch (e) {
    console.error("unlockMemberPin failed:", e);
    return { ok: false as const, error: `Could not unlock the account. ${errorMessage(e)}` };
  }
}

/**
 * ADMIN: clear a member's PIN entirely (2.23) — they fall back to the
 * phone-digit default (while that setting is on) and can set their own
 * again. The organizer never sees or chooses a PIN value here; clearing is
 * the whole action.
 */
export async function resetMemberPin(input: { personId: string }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const person = await prisma.person.findUnique({ where: { id: input.personId } });
    if (!person) return { ok: false as const, error: "Person not found." };
    if (person.pinHash === null && person.pinFailedAttempts === 0 && person.pinLockedUntil === null) {
      return { ok: false as const, error: "They have no PIN set — there is nothing to reset." };
    }

    await prisma.$transaction(async (tx) => {
      await tx.person.update({
        where: { id: person.id },
        data: { pinHash: null, pinFailedAttempts: 0, pinLockedUntil: null },
      });
      // A PIN is reset because somebody should no longer be able to use it.
      // Clearing the hash while leaving their sessions open answered the wrong
      // half of that: whoever was already inside stayed inside.
      const endedSessions = await revokeSessionsForPerson(
        tx,
        person.id,
        "PIN reset by the organizer",
      );
      await logAudit(tx, {
        entity: "Person",
        entityId: person.id,
        action: "update",
        summary:
          `Reset ${person.nameEnglishFirst}'s PIN — back to the phone-digit default` +
          (endedSessions > 0
            ? `; ${endedSessions} open session${endedSessions === 1 ? "" : "s"} ended, so anyone already signed in is out`
            : ""),
        before: {
          hadPin: person.pinHash !== null,
          pinFailedAttempts: person.pinFailedAttempts,
          pinLockedUntil: person.pinLockedUntil,
        },
        after: { hadPin: false, pinFailedAttempts: 0, pinLockedUntil: null },
      });
    });

    revalidatePath(`/admin/people/${person.id}`);
    revalidatePath("/admin/people");
    return { ok: true as const, data: { reset: true } };
  } catch (e) {
    console.error("resetMemberPin failed:", e);
    return { ok: false as const, error: `Could not reset the PIN. ${errorMessage(e)}` };
  }
}

/** ADMIN: per-person PIN override — null follows the global setting. */
export async function setPinLoginAllowed(input: { personId: string; allowed: boolean | null }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    if (input.allowed !== null && typeof input.allowed !== "boolean") {
      return { ok: false as const, error: "Invalid value." };
    }
    const person = await prisma.person.findUnique({ where: { id: input.personId } });
    if (!person) return { ok: false as const, error: "Person not found." };
    await prisma.person.update({
      where: { id: input.personId },
      data: { pinLoginAllowed: input.allowed },
    });
    revalidatePath(`/admin/people/${input.personId}`);
    return { ok: true as const, data: { personId: input.personId, allowed: input.allowed } };
  } catch (e) {
    console.error("setPinLoginAllowed failed:", e);
    return { ok: false as const, error: `Could not save. ${errorMessage(e)}` };
  }
}

/** Sign out and land on the appropriate login page. */
export async function signOutAction() {
  const supabase = await createClient();
  const claims = await getCurrentUser();
  const wasAdmin = claims?.app_metadata?.is_admin === true;
  // Mark the row ended and drop the handle BEFORE the Supabase sign-out, so
  // this device stops appearing as active in "Where you are signed in" the
  // moment they tap it. The row is kept, never deleted (2.14).
  await revokeCurrentSession("Signed out");
  // SCOPE: LOCAL — this device only.
  //
  // The default is a GLOBAL sign-out, so tapping "Sign out" on a phone killed
  // the refresh token of every other device too. The laptop kept working until
  // its access token expired, then failed to refresh and was bounced to /login
  // with no reason shown — while its SignInSession row still read revokedAt =
  // null with a frozen lastSeenAt, so "Where you are signed in" called it
  // active for the next seven days.
  //
  // Signing out one device must end one device. Ending them all is a separate,
  // deliberate action ("Sign out everywhere else"), and it revokes the rows.
  await supabase.auth.signOut({ scope: "local" });
  redirect(wasAdmin ? "/admin/login" : "/login");
}
