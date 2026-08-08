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
};

/**
 * Why the channel is off, in the organizer's words. Shown wherever WhatsApp
 * appears so the state is never a mystery switch (2.10).
 *
 * This no longer says "Meta has disabled the Business Account". That WAS true
 * — 15 consecutive sends failed with Twilio 63112 between 2026-08-06 03:03 and
 * 2026-08-07 01:53 UTC — but it has since cleared: the sender +15559620327
 * ("Equb") reports ONLINE, quality HIGH, 100K customers/24hr, and login codes
 * delivered again on 2026-08-08. The switch is now just a switch.
 */
export const WHATSAPP_DISABLED_REASON =
  "WhatsApp is switched off — no codes or statements will send until it is turned back on.";

/**
 * Why STATEMENTS cannot send — shown ONLY when there is no approved template
 * to carry them, which is not something the organizer can turn on.
 *
 * NO LONGER THE NORMAL STATE. Meta approved five templates on 7 August 2026,
 * so `STATEMENTS_DELIVERABLE` is true and this string is not reached. It stays
 * because the condition it describes can return: if the registry is emptied or
 * the templates are revoked, sending would fall back to Twilio's approval
 * SAMPLES and deliver invented figures to real members, so the code must still
 * be able to say why it stopped.
 *
 * It is therefore worded for that state and not for "today" — a reason string
 * that outlives its cause is a lie, and this one has already outlived one.
 *
 * See docs/WHATSAPP_TEMPLATE_ONLY.md for what registering templates involves.
 */
export const WHATSAPP_STATEMENTS_BLOCKED_REASON =
  "Statements need Meta-approved templates, and none are registered. Login codes are unaffected.";

export type SettingKey = keyof SettingDefaults;
export type SettingValue<K extends SettingKey> = SettingDefaults[K];
