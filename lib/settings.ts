import { prisma } from "./prisma";
import {
  SETTING_DEFAULTS,
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
  WHATSAPP_DISABLED_REASON,
  type SettingKey,
  type SettingValue,
} from "./setting-defaults";

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
