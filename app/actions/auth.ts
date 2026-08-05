"use server";

import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { getCurrentUser, requireAdmin } from "@/lib/auth";
import { allowLookup, LOOKUP_THROTTLE_MESSAGE } from "@/lib/lookup-throttle";
import { maybeSendLockoutNotice } from "@/lib/messaging-engine";
import { evaluatePinAttempt, hashPin, isValidPinFormat } from "@/lib/pin";
import { findPeopleByPhone } from "@/lib/people-lookup";
import { phoneDigits, toE164 } from "@/lib/phone";
import { prisma } from "@/lib/prisma";
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

  const setPw = await admin.auth.admin.updateUserById(authUserId, {
    password: bridgePassword(authUserId),
  });
  if (setPw.error) {
    console.error("mintBridgeSession bridge password failed:", setPw.error);
    return { ok: false as const, error: "Could not sign you in — contact the organizer." };
  }
  const supabase = await createClient();
  const signIn = await supabase.auth.signInWithPassword({
    email: signInEmail,
    password: bridgePassword(authUserId),
  });
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
      const result = await evaluatePinAttempt(person, pin, now, {
        allowDefaultFromPhone,
        maxAttempts,
        lockMinutes,
      });
      if (result.outcome === "ok") {
        matches.push(person);
        if (result.usedDefault) usedDefaultFor.add(person.id);
      } else if (result.outcome === "locked") {
        if (!lockedUntil || result.until > lockedUntil) lockedUntil = result.until;
      } else if (result.outcome === "wrong") {
        await prisma.person.update({
          where: { id: person.id },
          data: {
            pinFailedAttempts: result.failedAttempts,
            pinLockedUntil: result.lockedUntil,
          },
        });
        if (result.lockedUntil) {
          if (!lockedUntil || result.lockedUntil > lockedUntil) lockedUntil = result.lockedUntil;
          // This attempt TRIPPED the lock — tell them on WhatsApp (2.28),
          // best-effort and behind the notifyOnLockout setting. The outcome
          // lands in MessageLog either way.
          await maybeSendLockoutNotice(person.id, lockMinutes);
        }
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

    const session = await mintBridgeSession(person);
    if (!session.ok) return session;

    return {
      ok: true as const,
      data: {
        personId: person.id,
        name: person.nameEnglishFirst,
        // True when the phone-digit default got them in — the client shows
        // a skippable "set your own PIN" prompt (never a wall).
        usedDefaultPin: usedDefaultFor.has(person.id),
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
    const ip =
      header.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      header.get("x-real-ip") ||
      "unknown";
    if (!allowLookup(`wa-send-ip:${ip}`) || !allowLookup(`wa-send:${phoneDigits(phone)}`)) {
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
    const ip =
      header.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      header.get("x-real-ip") ||
      "unknown";
    if (!allowLookup(`wa-check-ip:${ip}`) || !allowLookup(`wa-check:${phoneDigits(phone)}`)) {
      return { ok: false as const, error: LOOKUP_THROTTLE_MESSAGE };
    }

    const candidates = await findPeopleByPhone(phone);
    if (candidates.length === 0) {
      return { ok: false as const, error: "Phone number not found." };
    }
    const person = candidates[0];

    const check = await checkWhatsAppVerification(toE164(phone), code);
    if (check === "expired") {
      return { ok: false as const, error: "That code has expired — request a new one." };
    }
    if (check !== "approved") {
      return { ok: false as const, error: "That code is not right." };
    }

    const session = await mintBridgeSession(person);
    if (!session.ok) return session;

    return {
      ok: true as const,
      data: { personId: person.id, name: person.nameEnglishFirst },
    };
  } catch (e) {
    console.error("signInWithWhatsAppCode failed:", e);
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

    const existing = await prisma.person.findUnique({ where: { authUserId: claims.sub } });
    if (existing) return { ok: true as const, data: existing };

    const phone = typeof claims.phone === "string" ? claims.phone : null;
    if (!phone) return { ok: false as const, error: "No member record is linked to this sign-in." };

    // Supabase stores phones without "+"; the directory may have either form.
    const unlinked = await prisma.person.findMany({
      where: {
        authUserId: null,
        OR: [{ phone }, { phone: `+${phone}` }],
      },
    });
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
    await prisma.person.update({
      where: { id: input.personId },
      data: {
        pinHash: await hashPin(input.pin),
        pinFailedAttempts: 0,
        pinLockedUntil: null,
      },
    });
    revalidatePath(`/admin/people/${input.personId}`);
    return { ok: true as const, data: { personId: input.personId } };
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
      await logAudit(tx, {
        entity: "Person",
        entityId: person.id,
        action: "update",
        summary: `Reset ${person.nameEnglishFirst}'s PIN — back to the phone-digit default`,
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
  await supabase.auth.signOut();
  redirect(wasAdmin ? "/admin/login" : "/login");
}
