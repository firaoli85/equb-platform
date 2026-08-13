"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/action-result";
import { requireAdmin } from "@/lib/auth";
import { getSetting, setSetting } from "@/lib/settings";
import { portalUrlProblem } from "@/lib/welcome-send";

/** ADMIN: the current platform settings for /admin/settings. */
export async function getPlatformSettings() {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    return {
      ok: true as const,
      data: {
        pinLoginEnabled: await getSetting("pinLoginEnabled"),
        presentationMode: await getSetting("presentationMode"),
        defaultPinFromPhone: await getSetting("defaultPinFromPhone"),
        pinMaxAttempts: await getSetting("pinMaxAttempts"),
        pinLockMinutes: await getSetting("pinLockMinutes"),
        notifyOnLockout: await getSetting("notifyOnLockout"),
        whatsappEnabled: await getSetting("whatsappEnabled"),
        memberSessionIdleDays: await getSetting("memberSessionIdleDays"),
        memberSessionMaxDays: await getSetting("memberSessionMaxDays"),
        adminSessionIdleMinutes: await getSetting("adminSessionIdleMinutes"),
        adminSessionMaxHours: await getSetting("adminSessionMaxHours"),
        closingWaitDays: await getSetting("closingWaitDays"),
        portalUrl: await getSetting("portalUrl"),
      },
    };
  } catch (e) {
    console.error("getPlatformSettings failed:", e);
    return { ok: false as const, error: `Could not load settings. ${errorMessage(e)}` };
  }
}

/**
 * ADMIN: how long a session lives, for each role (2.6 — read at check time by
 * lib/session-gate.ts, so a change applies to the very next request).
 *
 * Validated here rather than trusted from the form: a zero or a negative
 * would mean "expire instantly", and the organizer typing one into his own
 * idle box would lock himself out of the screen he typed it on.
 * lib/session-policy.ts also refuses such values, so the guard holds even for
 * a row written some other way.
 */
export async function updateSessionPolicy(input: {
  memberIdleDays: number;
  memberMaxDays: number;
  adminIdleMinutes: number;
  adminMaxHours: number;
}) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const fields = [
      { key: "memberSessionIdleDays" as const, value: input.memberIdleDays, name: "Member idle days", max: 365 },
      { key: "memberSessionMaxDays" as const, value: input.memberMaxDays, name: "Member maximum days", max: 365 },
      { key: "adminSessionIdleMinutes" as const, value: input.adminIdleMinutes, name: "Organizer idle minutes", max: 24 * 60 },
      { key: "adminSessionMaxHours" as const, value: input.adminMaxHours, name: "Organizer maximum hours", max: 24 * 30 },
    ];

    for (const field of fields) {
      if (!Number.isInteger(field.value) || field.value < 1 || field.value > field.max) {
        return {
          ok: false as const,
          error: `${field.name} must be a whole number between 1 and ${field.max}.`,
        };
      }
    }

    // An absolute cap below the idle window would make the idle setting
    // meaningless — say so instead of silently clamping it.
    if (input.memberMaxDays < input.memberIdleDays) {
      return {
        ok: false as const,
        error: "A member's maximum days cannot be less than their idle days.",
      };
    }
    if (input.adminMaxHours * 60 < input.adminIdleMinutes) {
      return {
        ok: false as const,
        error: "The organizer's maximum hours cannot be less than the idle minutes.",
      };
    }

    for (const field of fields) await setSetting(field.key, field.value);

    revalidatePath("/admin/settings");
    return {
      ok: true as const,
      data: {
        memberIdleDays: input.memberIdleDays,
        memberMaxDays: input.memberMaxDays,
        adminIdleMinutes: input.adminIdleMinutes,
        adminMaxHours: input.adminMaxHours,
      },
    };
  } catch (e) {
    console.error("updateSessionPolicy failed:", e);
    return { ok: false as const, error: `Could not save the setting. ${errorMessage(e)}` };
  }
}

/**
 * ADMIN: the screen-share privacy switch (2.4/D-6). Flipping it re-renders
 * every admin page — the redaction happens server-side in the actions, so a
 * stale page cannot keep sensitive data alive.
 */
export async function setPresentationMode(input: { on: boolean }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    if (typeof input.on !== "boolean") {
      return { ok: false as const, error: "Invalid value." };
    }
    await setSetting("presentationMode", input.on);
    revalidatePath("/", "layout");
    return { ok: true as const, data: { presentationMode: input.on } };
  } catch (e) {
    console.error("setPresentationMode failed:", e);
    return { ok: false as const, error: `Could not save the setting. ${errorMessage(e)}` };
  }
}

/** ADMIN: toggle the phone-digit default PIN platform-wide (2.6). Off means
 *  members with no PIN set can only use OTP or an organizer-set PIN. */
export async function updateDefaultPinFromPhone(input: { enabled: boolean }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    if (typeof input.enabled !== "boolean") {
      return { ok: false as const, error: "Invalid value." };
    }
    await setSetting("defaultPinFromPhone", input.enabled);
    revalidatePath("/admin/settings");
    revalidatePath("/admin/people");
    revalidatePath("/login");
    return { ok: true as const, data: { defaultPinFromPhone: input.enabled } };
  } catch (e) {
    console.error("updateDefaultPinFromPhone failed:", e);
    return { ok: false as const, error: `Could not save the setting. ${errorMessage(e)}` };
  }
}

/**
 * ADMIN: the PIN lockout policy (2.6) — attempts before locking and how
 * long a lock lasts. Read at every sign-in check, so a change applies to
 * the very next attempt.
 */
export async function updatePinLockoutPolicy(input: {
  maxAttempts: number;
  lockMinutes: number;
}) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    if (
      !Number.isSafeInteger(input.maxAttempts) ||
      input.maxAttempts < 1 ||
      input.maxAttempts > 20
    ) {
      return { ok: false as const, error: "Attempts before locking must be 1–20." };
    }
    if (
      !Number.isSafeInteger(input.lockMinutes) ||
      input.lockMinutes < 1 ||
      input.lockMinutes > 1440
    ) {
      return { ok: false as const, error: "Lock duration must be 1–1440 minutes." };
    }
    await setSetting("pinMaxAttempts", input.maxAttempts);
    await setSetting("pinLockMinutes", input.lockMinutes);
    revalidatePath("/admin/settings");
    return {
      ok: true as const,
      data: { pinMaxAttempts: input.maxAttempts, pinLockMinutes: input.lockMinutes },
    };
  } catch (e) {
    console.error("updatePinLockoutPolicy failed:", e);
    return { ok: false as const, error: `Could not save the setting. ${errorMessage(e)}` };
  }
}

/**
 * ADMIN: how many days after the final week closing is offered (2.6 / 2.9).
 *
 * Zero is a legitimate value — the organizer may decide the money is all in
 * and close the same day — so this is one of the few numeric settings where
 * the floor is 0 rather than 1. The ceiling exists only to catch a typo: a
 * cycle that cannot be closed for a year is a bug report, not a policy.
 */
export async function updateClosingWaitDays(input: { days: number }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    if (!Number.isSafeInteger(input.days) || input.days < 0 || input.days > 90) {
      return { ok: false as const, error: "The wait must be a whole number of days, 0–90." };
    }
    await setSetting("closingWaitDays", input.days);
    revalidatePath("/admin/settings");
    revalidatePath("/admin/cycle/close");
    return { ok: true as const, data: { closingWaitDays: input.days } };
  } catch (e) {
    console.error("updateClosingWaitDays failed:", e);
    return { ok: false as const, error: `Could not save the setting. ${errorMessage(e)}` };
  }
}

/**
 * ADMIN: the WhatsApp channel master switch. Off means NO WhatsApp send is
 * attempted anywhere — statements or login codes — so a dead channel costs
 * nothing and offers no door that cannot deliver (2.28).
 */
export async function updateWhatsappEnabled(input: { enabled: boolean }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    if (typeof input.enabled !== "boolean") {
      return { ok: false as const, error: "Invalid value." };
    }
    await setSetting("whatsappEnabled", input.enabled);
    revalidatePath("/admin/settings");
    revalidatePath("/admin/messages");
    // The member login screen offers the WhatsApp door only while it works.
    revalidatePath("/login");
    return { ok: true as const, data: { whatsappEnabled: input.enabled } };
  } catch (e) {
    console.error("updateWhatsappEnabled failed:", e);
    return { ok: false as const, error: `Could not save the setting. ${errorMessage(e)}` };
  }
}

/**
 * ADMIN: where a member signs in — the address the welcome message tells them
 * to open.
 *
 * TRIMMED HERE, ONCE. Everything downstream treats an empty string as "not
 * decided" — `welcomeSendCheck` refuses the send, `placeholderValues` renders
 * the sentinel — and a value of "   " would satisfy neither of those tests
 * while being just as unopenable. Trimming at the only write means there is no
 * whitespace-only address to defend against anywhere else.
 *
 * CLEARING IT IS ALLOWED. An organizer who moves the portal has to be able to
 * empty the box while he finds the new address, and the welcome refusing in the
 * meantime is the correct behaviour rather than a state to prevent.
 *
 * The audit is automatic: every write goes through setSetting, which records
 * it in the same transaction (2.23).
 */
export async function updatePortalUrl(input: { url: string }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    if (typeof input.url !== "string") {
      return { ok: false as const, error: "Invalid value." };
    }
    const url = input.url.trim();
    // Validated with the SAME pure rule the form uses while typing, so the box
    // and the server can never disagree about what a usable address is.
    const problem = portalUrlProblem(url);
    if (problem) return { ok: false as const, error: problem };

    await setSetting("portalUrl", url);
    revalidatePath("/admin/settings");
    // The welcome's preview quotes this address on both screens that render one.
    revalidatePath("/admin/messages");
    return { ok: true as const, data: { portalUrl: url } };
  } catch (e) {
    console.error("updatePortalUrl failed:", e);
    return { ok: false as const, error: `Could not save the setting. ${errorMessage(e)}` };
  }
}

/** ADMIN: toggle the automatic WhatsApp lockout notice (2.28). */
export async function updateNotifyOnLockout(input: { enabled: boolean }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    if (typeof input.enabled !== "boolean") {
      return { ok: false as const, error: "Invalid value." };
    }
    await setSetting("notifyOnLockout", input.enabled);
    revalidatePath("/admin/settings");
    return { ok: true as const, data: { notifyOnLockout: input.enabled } };
  } catch (e) {
    console.error("updateNotifyOnLockout failed:", e);
    return { ok: false as const, error: `Could not save the setting. ${errorMessage(e)}` };
  }
}

/** ADMIN: toggle PIN login platform-wide, effective immediately (2.6). */
export async function updatePinLoginEnabled(input: { enabled: boolean }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    if (typeof input.enabled !== "boolean") {
      return { ok: false as const, error: "Invalid value." };
    }
    await setSetting("pinLoginEnabled", input.enabled);
    revalidatePath("/admin/settings");
    revalidatePath("/login");
    return { ok: true as const, data: { pinLoginEnabled: input.enabled } };
  } catch (e) {
    console.error("updatePinLoginEnabled failed:", e);
    return { ok: false as const, error: `Could not save the setting. ${errorMessage(e)}` };
  }
}
