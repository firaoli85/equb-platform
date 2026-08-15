import { logAudit } from "./audit";
import {
  resolveMessagingConfig,
  type MessagingConfig,
} from "./messaging-config";
import { prisma } from "./prisma";
import {
  SETTING_DEFAULTS,
  settingChangeSummary,
  type SettingKey,
  type SettingValue,
} from "./setting-defaults";

// Reading and writing platform settings (ground truth 2.6: everything
// configurable from the UI, nothing hardcoded). Values are JSON-encoded in
// the settings table; an absent row means the default applies.
//
// SERVER ONLY — this file imports Prisma. The registry itself, and any
// constant a "use client" file needs, live in ./setting-defaults, which has
// no database import. Adding a setting is one line there.
//
// Re-exported below so existing server-side imports of SETTING_DEFAULTS and
// WHATSAPP_DISABLED_REASON keep working; new CLIENT code must import from
// ./setting-defaults directly.
export {
  SETTING_DEFAULTS,
  SETTING_LABELS,
  settingChangeSummary,
  settingValueLabel,
  WHATSAPP_DISABLED_REASON,
  type SettingKey,
  type SettingValue,
} from "./setting-defaults";

/**
 * THE ONE READER FOR MESSAGE TIMING — phase 1 of the one-truth engine.
 *
 * Every downstream phase asks THIS function when and how a message may send;
 * none of them reads `getSetting("autoSend…")` for itself. That is the config
 * analogue of the engine's own rule (§2): derive once, read everywhere. Twelve
 * scattered `getSetting` calls in the send path would be the same defect as
 * the twelve scattered derivations the engine exists to remove.
 *
 * Returns the RESOLVED config — defaults applied, stored junk rejected — so a
 * caller can never see a half-set schedule or an unknown weekday.
 *
 * NOTHING CALLS THIS YET, deliberately: phase 1 stores and exposes the config
 * and wires no message and no deadline to it.
 */
export async function getMessagingConfig(): Promise<MessagingConfig> {
  return resolveMessagingConfig({
    autoSendPaymentConfirmed: await getSetting("autoSendPaymentConfirmed"),
    autoSendPartialConfirmed: await getSetting("autoSendPartialConfirmed"),
    autoSendLateNotice: await getSetting("autoSendLateNotice"),
    autoSendBehindNotice: await getSetting("autoSendBehindNotice"),
    autoSendWinnerAnnouncement: await getSetting("autoSendWinnerAnnouncement"),
    autoSendWeeklyReminder: await getSetting("autoSendWeeklyReminder"),
    autoSendGroupAnnouncement: await getSetting("autoSendGroupAnnouncement"),
    lateNoticeDay: await getSetting("lateNoticeDay"),
    lateNoticeTime: await getSetting("lateNoticeTime"),
    weeklyReminderDay: await getSetting("weeklyReminderDay"),
    weeklyReminderTime: await getSetting("weeklyReminderTime"),
    equbTimezone: await getSetting("equbTimezone"),
  });
}

export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  const row = await prisma.setting.findUnique({ where: { key } });
  if (!row) return SETTING_DEFAULTS[key];
  try {
    return JSON.parse(row.value) as SettingValue<K>;
  } catch {
    return SETTING_DEFAULTS[key];
  }
}

/**
 * Write a setting, and record the change.
 *
 * THE AUDIT LIVES HERE, NOT IN THE NINE ACTIONS ABOVE IT.
 *
 * 2.23 requires an audit trail for every corrective action "applied to every
 * entity: … message templates, and settings", and settings were the one entity
 * with none: all nine mutators in app/actions/settings.ts called `setSetting`
 * and returned. So the log could not answer "who turned PIN sign-in off, and
 * when?" — the question the audit screen exists for, about the settings that
 * decide who can get into the platform at all.
 *
 * Putting it in the ACTIONS would have fixed those nine and left the tenth to
 * whoever adds it next. Putting it HERE means a setting cannot be written
 * without being recorded, because there is no other way to write one.
 *
 * ONE TRANSACTION, like every other audited change (lib/audit.ts): the value
 * and the record of it can never exist without each other.
 */
export async function setSetting<K extends SettingKey>(
  key: K,
  value: SettingValue<K>,
): Promise<void> {
  const encoded = JSON.stringify(value);
  await prisma.$transaction(async (tx) => {
    const existing = await tx.setting.findUnique({ where: { key } });
    // An absent row means the default is in force — that IS the before-value,
    // and recording `undefined → 5` would hide that the number had a meaning.
    const before = existing ? (JSON.parse(existing.value) as unknown) : SETTING_DEFAULTS[key];

    await tx.setting.upsert({
      where: { key },
      create: { key, value: encoded },
      update: { value: encoded },
    });

    // NOTHING CHANGED IS NOT A CHANGE. Two switches share one Save button, so
    // pressing it writes both; logging the untouched one would fill the trail
    // with entries that record nothing and make the real ones harder to find.
    if (JSON.stringify(before) === encoded) return;

    await logAudit(tx, {
      entity: "Setting",
      entityId: key,
      action: "update",
      summary: settingChangeSummary(key, before, value),
      before,
      after: value,
    });
  });
}
