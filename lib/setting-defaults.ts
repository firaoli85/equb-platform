import { CLOSING_WAIT_DAYS_DEFAULT } from "./cycle-lock";
import { SESSION_LIMIT_DEFAULTS } from "./session-policy";

// The SHAPE of platform settings, with no database attached.
//
// Split out of lib/settings.ts because client components legitimately need
// some of this — the settings form shows WHATSAPP_DISABLED_REASON, the
// session form needs the defaults — and lib/settings.ts imports Prisma, which
// imports `pg`, which imports node:dns. Pulled into a browser bundle that is
// a hard build failure ("Can't resolve 'dns'"), and it takes the whole admin
// settings page down with it.
//
// Rule: anything a "use client" file needs goes HERE. lib/settings.ts keeps
// getSetting/setSetting and stays server-only.

export type SettingDefaults = {
  /** When false, members must use the OTP code; PIN attempts are rejected
   *  server-side (a per-person pinLoginAllowed override can differ). */
  pinLoginEnabled: boolean;
  /** Screen-share privacy (2.4/D-6): when true, member names, winner plans,
   *  money, phones, and the audit log are filtered OUT of what the server
   *  sends — across the whole admin. Default OFF. */
  presentationMode: boolean;
  /**
   * When true, a member with NO PIN set may sign in with the last 4 digits of
   * their registered phone (never stored — checked at sign-in only).
   *
   * ORGANIZER'S RULING (Aug 2026): this now signs them in DIRECTLY. It used
   * to require a code as well (audit C2), and that requirement locked out 26
   * of 27 members because the code channel could not deliver. The risk C2
   * named is real and unchanged — the digits are part of the identifier the
   * caller just typed — and is answered by the session layer instead: bounded
   * lifetimes, recorded devices, a visible session list, and a new-device
   * notice. Retired for good when PIN login ends at cycle 2.
   */
  defaultPinFromPhone: boolean;
  /** Wrong PIN attempts before the account locks (2.6 — read at check time). */
  pinMaxAttempts: number;
  /** How long a tripped lock lasts, in minutes (2.6 — read at check time). */
  pinLockMinutes: number;
  /** When true, a member who locks themselves out gets the LOCKOUT_NOTICE
   *  WhatsApp statement (2.28). Hardship "no messages" still wins. */
  notifyOnLockout: boolean;
  /**
   * The master switch for the WhatsApp channel — statements AND login codes.
   *
   * Default TRUE: the channel is meant to work. It exists because the channel
   * can be dead for reasons OUTSIDE this system — Meta disabling the WhatsApp
   * Business Account (Twilio error 63112) is the case that forced it. While
   * that is true, every send is refused BEFORE it reaches Twilio, so the
   * platform stops generating billed failures and stops offering a login door
   * that cannot deliver (2.28).
   */
  whatsappEnabled: boolean;
  /** Member session: days of INACTIVITY before sign-out. Sliding — using the
   *  account resets it. Read at check time (2.6), never hardcoded. */
  memberSessionIdleDays: number;
  /** Member session: total days from sign-in, never extended. The cap that
   *  makes the sliding window above safe. */
  memberSessionMaxDays: number;
  /** Organizer session: MINUTES of inactivity before sign-out. Short on
   *  purpose — the admin screens hold every member's money and the laptop
   *  gets left alone. */
  adminSessionIdleMinutes: number;
  /** Organizer session: total hours from sign-in, never extended. */
  adminSessionMaxHours: number;
  /**
   * Days after the FINAL week before closing a cycle is offered (2.6, 2.9).
   *
   * Closing writes every shortfall onto the carried ledger and freezes the
   * books. Money for the last week routinely arrives days late — the payment
   * window itself is 5 days — so closing the moment the last week passes turns
   * payments in transit into permanent debts. 0 switches the wait off.
   */
  closingWaitDays: number;
  /**
   * Where a member signs in — the address WHATSAPP_WELCOME tells them to open.
   *
   * DEFAULT EMPTY, AND DELIBERATELY NOT GUESSED. The obvious alternative is to
   * derive it from the request host or from APP_BASE_URL, and both are wrong
   * for the same reason: this string goes into a message that cannot be
   * recalled, and a host that happens to be serving the admin right now
   * (a preview deploy, localhost, a Vercel branch URL) is not the address the
   * organizer wants 27 members to keep. Empty means "not decided", the welcome
   * refuses to send while it is empty (lib/welcome-send.ts), and the organizer
   * decides once.
   */
  portalUrl: string;
};

export const SETTING_DEFAULTS: SettingDefaults = {
  pinLoginEnabled: true,
  presentationMode: false,
  defaultPinFromPhone: false,
  pinMaxAttempts: 5,
  pinLockMinutes: 30,
  notifyOnLockout: true,
  whatsappEnabled: true,
  memberSessionIdleDays: SESSION_LIMIT_DEFAULTS.memberIdleDays,
  memberSessionMaxDays: SESSION_LIMIT_DEFAULTS.memberMaxDays,
  adminSessionIdleMinutes: SESSION_LIMIT_DEFAULTS.adminIdleMinutes,
  adminSessionMaxHours: SESSION_LIMIT_DEFAULTS.adminMaxHours,
  closingWaitDays: CLOSING_WAIT_DAYS_DEFAULT,
  portalUrl: "",
};

/**
 * Why the channel is off, in the organizer's words. Shown wherever WhatsApp
 * appears so the state is never a mystery switch (2.10).
 *
 * This no longer says "Meta has disabled the Business Account". That WAS true
 * — 15 consecutive sends failed with Twilio 63112 between 2026-08-06 03:03 and
 * 2026-08-07 01:53 UTC — but it has since cleared, and the platform has since
 * moved to the business-verified sender +13016835755 (WABA 1018506704190290),
 * with the five approved templates carried over. The switch is now just a
 * switch.
 *
 * `WHATSAPP_STATEMENTS_BLOCKED_REASON` used to sit beside this one. It is
 * deleted, not parked (§5.15): the state it described ended on 7 August 2026
 * when Meta approved the templates, and the string then spent days telling
 * the organizer statements could not send while eleven of them delivered. A
 * type without an approved template now refuses ITSELF at send time
 * (lib/whatsapp-templates.ts, isApprovedTemplateKey) with a reason derived
 * from the registry — never a stored sentence that can outlive its cause.
 */
export const WHATSAPP_DISABLED_REASON =
  "WhatsApp is switched off — no codes or statements will send until it is turned back on.";

export type SettingKey = keyof SettingDefaults;
export type SettingValue<K extends SettingKey> = SettingDefaults[K];

/**
 * What each setting is CALLED — the words on the screen that changes it.
 *
 * An audit entry reading `adminSessionIdleMinutes: 30 → 5` is a variable name,
 * not a record. The organizer reads this log months later to answer "when did
 * sign-in start behaving like that?", and a key he has never seen written down
 * cannot answer it. These strings match the labels in the settings forms.
 *
 * A `Record` rather than an optional lookup on purpose: adding a setting
 * without naming it is a type error, so the audit trail cannot fall behind the
 * registry the way the whole thing did before.
 */
export const SETTING_LABELS: Record<SettingKey, string> = {
  pinLoginEnabled: "PIN sign-in",
  presentationMode: "Presentation mode",
  defaultPinFromPhone: "Default PIN from phone",
  pinMaxAttempts: "Attempts before locking",
  pinLockMinutes: "How long a lock lasts (minutes)",
  notifyOnLockout: "Notice when a member locks themselves out",
  whatsappEnabled: "WhatsApp",
  memberSessionIdleDays: "Member session — idle days",
  memberSessionMaxDays: "Member session — maximum days",
  adminSessionIdleMinutes: "Organizer session — idle minutes",
  adminSessionMaxHours: "Organizer session — maximum hours",
  closingWaitDays: "Wait before a cycle can be closed (days)",
  portalUrl: "Member sign-in address",
};

/** A setting's value as a person reads it — never `true`/`false`. */
export function settingValueLabel(value: unknown): string {
  if (typeof value === "boolean") return value ? "on" : "off";
  // AN EMPTY TEXT SETTING IS A STATE, NOT A BLANK. `portalUrl` ships empty, so
  // the first change to it would have been recorded as "Member sign-in address:
  //  → https://…" — a summary with a hole in it, which reads as a rendering
  // fault rather than as the fact that there was no address before.
  if (typeof value === "string" && value.trim() === "") return "(not set)";
  return String(value);
}

/**
 * "PIN sign-in: on → off" — what changed, from what to what (2.23).
 *
 * Pure and here rather than in lib/settings.ts so it can be tested without a
 * database, and so the audit screen could render it if it ever needs to.
 */
export function settingChangeSummary(key: SettingKey, before: unknown, after: unknown): string {
  return `${SETTING_LABELS[key]}: ${settingValueLabel(before)} → ${settingValueLabel(after)}`;
}
