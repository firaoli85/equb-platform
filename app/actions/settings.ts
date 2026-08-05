"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/action-result";
import { requireAdmin } from "@/lib/auth";
import { getSetting, setSetting } from "@/lib/settings";

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
      },
    };
  } catch (e) {
    console.error("getPlatformSettings failed:", e);
    return { ok: false as const, error: `Could not load settings. ${errorMessage(e)}` };
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
