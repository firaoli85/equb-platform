import { prisma } from "./prisma";

// Typed registry of platform settings (ground truth 2.6: everything
// configurable from the UI, nothing hardcoded). Adding a setting is one line
// here — no schema change. Values are JSON-encoded in the settings table;
// an absent row means the default applies.
export const SETTING_DEFAULTS: {
  /** When false, members must use the OTP code; PIN attempts are rejected
   *  server-side (a per-person pinLoginAllowed override can differ). */
  pinLoginEnabled: boolean;
  /** Screen-share privacy (2.4/D-6): when true, member names, winner plans,
   *  money, phones, and the audit log are filtered OUT of what the server
   *  sends — across the whole admin. Default OFF. */
  presentationMode: boolean;
  /** When true, a member with NO PIN set may sign in with the last 4 digits
   *  of their registered phone (never stored — checked at sign-in only).
   *  Turned off when PIN login is retired at cycle 2. */
  defaultPinFromPhone: boolean;
  /** Wrong PIN attempts before the account locks (2.6 — read at check time). */
  pinMaxAttempts: number;
  /** How long a tripped lock lasts, in minutes (2.6 — read at check time). */
  pinLockMinutes: number;
  /** When true, a member who locks themselves out gets the LOCKOUT_NOTICE
   *  WhatsApp statement (2.28). Hardship "no messages" still wins. */
  notifyOnLockout: boolean;
} = {
  pinLoginEnabled: true,
  presentationMode: false,
  defaultPinFromPhone: true,
  pinMaxAttempts: 5,
  pinLockMinutes: 30,
  notifyOnLockout: true,
};

export type SettingKey = keyof typeof SETTING_DEFAULTS;
export type SettingValue<K extends SettingKey> = (typeof SETTING_DEFAULTS)[K];

export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  const row = await prisma.setting.findUnique({ where: { key } });
  if (!row) return SETTING_DEFAULTS[key];
  try {
    return JSON.parse(row.value) as SettingValue<K>;
  } catch {
    return SETTING_DEFAULTS[key];
  }
}

export async function setSetting<K extends SettingKey>(
  key: K,
  value: SettingValue<K>,
): Promise<void> {
  const encoded = JSON.stringify(value);
  await prisma.setting.upsert({
    where: { key },
    create: { key, value: encoded },
    update: { value: encoded },
  });
}
