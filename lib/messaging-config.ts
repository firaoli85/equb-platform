// WHEN AND HOW EACH MESSAGE IS SENT — the config layer, phase 1 of the
// one-truth engine (docs/ONE_TRUTH_ENGINE.md §3.0 rule 7).
//
// Rule 7: where a decision is the organizer's PREFERENCE rather than a matter
// of correctness, it is a SETTING he controls, not a value hard-coded once.
// The engine computes the truth; these settings decide when and how it is
// communicated. Nothing in this file decides what is true.
//
// NOTHING READS THIS YET, AND THAT IS THE POINT. The messages and deadline
// phases read it; this phase only stores it and resolves it, and every default
// reproduces today's behaviour exactly so shipping it changes nothing for any
// member until Oli flips a switch (proven in messaging-config.test.ts).
//
import type { SettingKey } from "./setting-defaults";

// PURE AND CLIENT-SAFE, deliberately. The settings form is a "use client" file
// and needs these types and labels; lib/settings.ts imports Prisma, which
// imports `pg`, which imports node:dns, and pulling that into a browser bundle
// is a hard build failure (lib/client-bundle-safety.test.ts). Same split as
// lib/setting-defaults.ts, for the same reason. The async reader that puts a
// database behind this lives in lib/settings.ts as `getMessagingConfig`.

/**
 * The message types whose timing the organizer controls.
 *
 * NOT the same list as `MESSAGE_KEYS` in lib/messages.ts, and the differences
 * are deliberate:
 *
 *   - **Two are RESERVED** — see `RESERVED_MESSAGE_KEYS` below.
 *   - **LOCKOUT_NOTICE is absent.** It auto-fires today and stays hard-coded:
 *     it is triggered by a member locking themselves out, which is a security
 *     event rather than a scheduling decision, and nothing in the phase brief
 *     asked for it. Its behaviour is unchanged by this layer.
 *   - **CYCLE_CLOSING_STATEMENT and WHATSAPP_WELCOME are absent.** Both fire
 *     from a one-off action the organizer takes deliberately (closing a cycle,
 *     welcoming a member); there is no timing choice to make.
 */
// ONE TOGGLE PER MESSAGE A MEMBER CAN RECEIVE — settled 15 Aug 2026.
//
// The four payment types shared two switches: PAYMENT_CONFIRMED covered the
// clean confirmation, and PARTIAL_CONFIRMED silently covered the other three.
// The sharing was deliberate and documented, and it was still wrong, because
// nothing on the screen said so. The organizer went looking for the
// part-payment-completed switch, could not find it, and had no way to learn
// that it was riding on a different one. A setting the organizer cannot SEE is
// not a setting he has (2.10, and §3.0 rule 7: a setting answers a question
// somebody actually has).
//
// So each of the four now appears by name. PAYMENT_CONFIRMED_V4 is the one
// exception and is not a sharing: it IS the payment confirmation, and the key
// it reads is being retired out from under it.
export const CONFIGURABLE_MESSAGE_KEYS = [
  "PAYMENT_CONFIRMED",
  "PAYMENT_CONFIRMED_WITH_PARTIAL",
  "PARTIAL_CONFIRMED",
  "PARTIAL_COMPLETED",
  "LATE_NOTICE",
  "BEHIND_NOTICE",
  "WINNER_ANNOUNCEMENT",
  "WEEKLY_REMINDER",
  "GROUP_ANNOUNCEMENT",
] as const;

export type ConfigurableMessageKey = (typeof CONFIGURABLE_MESSAGE_KEYS)[number];

/**
 * Keys that have a SETTING but no message type behind them yet.
 *
 * RESERVED ON PURPOSE, NOT AN OVERSIGHT. `PARTIAL_CONFIRMED` is the
 * partial-aware confirmation §3.7 specifies and the partial phase builds;
 * `WEEKLY_REMINDER` is the recurring nudge — neither exists in
 * `MESSAGE_KEYS` today, and neither has a Meta-approved template.
 *
 * The setting exists first because that is this phase's whole job: the layer
 * downstream phases read has to be in place before they can read it. A caller
 * must never special-case these — they resolve as ordinary manual settings —
 * and `messaging-config.test.ts` asserts both that they are still absent from
 * `MESSAGE_KEYS` (so the reservation stays honest) and that resolving them
 * produces a real value rather than a hole.
 */
// PARTIAL_CONFIRMED LEFT THIS LIST ON 15 AUG 2026, exactly as the phase-1
// test demanded it would: the template now exists, so the reservation stopped
// being honest. WEEKLY_REMINDER is still reserved — no type, no template, and
// the setting waits for both.
export const RESERVED_MESSAGE_KEYS = ["WEEKLY_REMINDER"] as const;

/**
 * The types that fire on a CLOCK rather than on an event, so they are the only
 * two that carry a day and a time.
 *
 * A late notice is "chase whoever is late", which needs a moment chosen; a
 * payment confirmation happens because a payment happened, and asking what day
 * it should go out would be nonsense.
 */
export const TIME_TRIGGERED_MESSAGE_KEYS = ["LATE_NOTICE", "WEEKLY_REMINDER"] as const;

export const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const WEEKDAY_NAMES: Record<Weekday, string> = {
  SUN: "Sunday",
  MON: "Monday",
  TUE: "Tuesday",
  WED: "Wednesday",
  THU: "Thursday",
  FRI: "Friday",
  SAT: "Saturday",
};

/**
 * The clock the equb runs on — R8's answer (§3.0 rule 7).
 *
 * UTC, because that is what every date function in the platform already uses:
 * lib/money.ts states "week arithmetic runs on UTC calendar days… UTC has no
 * DST, so 7 days apart is always exactly 7 * 24 hours". Shipping any other
 * default would move a deadline on the day of deploy, which is exactly what
 * this phase must not do.
 *
 * STORED HERE, READ BY NOBODY YET. Repointing deadline computation at this
 * value is a later phase and rides on the §5.5 SQL-view decision — the view's
 * `current_date` cannot see a setting at all.
 */
export const DEFAULT_TIMEZONE = "UTC";

export type MessageSchedule = { day: Weekday; time: string };

export type MessageTiming = {
  /** True: it sends itself on its trigger. False: prepared for the organizer. */
  auto: boolean;
  /** null means NOT SCHEDULED. Only ever set for a time-triggered type. */
  schedule: MessageSchedule | null;
};

export type MessagingConfig = {
  /** IANA name, or "UTC". The clock deadlines will later be measured against. */
  timezone: string;
  message: Record<ConfigurableMessageKey, MessageTiming>;
};

/** The raw setting values this config is resolved from. */
export type MessagingSettingValues = {
  autoSendPaymentConfirmed: boolean;
  autoSendPaymentConfirmedWithPartial: boolean;
  autoSendPartialConfirmed: boolean;
  autoSendPartialCompleted: boolean;
  autoSendLateNotice: boolean;
  autoSendBehindNotice: boolean;
  autoSendWinnerAnnouncement: boolean;
  autoSendWeeklyReminder: boolean;
  autoSendGroupAnnouncement: boolean;
  lateNoticeDay: string;
  lateNoticeTime: string;
  weeklyReminderDay: string;
  weeklyReminderTime: string;
  equbTimezone: string;
};

export function isWeekday(value: unknown): value is Weekday {
  return typeof value === "string" && (WEEKDAYS as readonly string[]).includes(value);
}

/** 24-hour "HH:MM". Not a locale format — this is stored, not displayed. */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isTimeOfDay(value: unknown): value is string {
  return typeof value === "string" && TIME_PATTERN.test(value);
}

/**
 * Why this day and time cannot be saved, or null if they can.
 *
 * BOTH EMPTY IS LEGITIMATE and means "not scheduled" — the state everything
 * ships in. The refusal exists for the half-set and the malformed, which are
 * the two ways a schedule silently becomes a guess.
 */
export function scheduleProblem(day: string, time: string): string | null {
  const noDay = day.trim() === "";
  const noTime = time.trim() === "";
  if (noDay && noTime) return null;
  if (noDay || noTime) {
    return "Give both a day and a time, or leave both empty to leave it unscheduled.";
  }
  if (!isWeekday(day)) return "Pick a day of the week.";
  if (!isTimeOfDay(time)) return "Give the time as HH:MM on a 24-hour clock, like 09:00.";
  return null;
}

/**
 * A stored day/time pair as a schedule, or null.
 *
 * A HALF-SET OR MALFORMED PAIR READS AS UNSCHEDULED, never as a guess. The
 * form refuses these (`scheduleProblem`), so reaching here means a row was
 * written some other way — an import, a hand-edited database, an older
 * version of this code. Guessing the missing half would invent a send time
 * for a message that goes to every member who is behind.
 */
function scheduleFrom(day: string, time: string): MessageSchedule | null {
  if (!isWeekday(day) || !isTimeOfDay(time)) return null;
  return { day, time };
}

/**
 * The resolved config — every default applied, every value validated.
 *
 * PURE, so the no-op proof runs without a database. `getMessagingConfig` in
 * lib/settings.ts is the one place that puts stored rows behind it, which is
 * the config analogue of the engine's own rule: derive once, read everywhere.
 */
export function resolveMessagingConfig(values: MessagingSettingValues): MessagingConfig {
  return {
    timezone: values.equbTimezone.trim() === "" ? DEFAULT_TIMEZONE : values.equbTimezone.trim(),
    message: {
      PAYMENT_CONFIRMED: { auto: values.autoSendPaymentConfirmed, schedule: null },
      PAYMENT_CONFIRMED_WITH_PARTIAL: {
        auto: values.autoSendPaymentConfirmedWithPartial,
        schedule: null,
      },
      PARTIAL_CONFIRMED: { auto: values.autoSendPartialConfirmed, schedule: null },
      PARTIAL_COMPLETED: { auto: values.autoSendPartialCompleted, schedule: null },
      LATE_NOTICE: {
        auto: values.autoSendLateNotice,
        schedule: scheduleFrom(values.lateNoticeDay, values.lateNoticeTime),
      },
      BEHIND_NOTICE: { auto: values.autoSendBehindNotice, schedule: null },
      WINNER_ANNOUNCEMENT: { auto: values.autoSendWinnerAnnouncement, schedule: null },
      WEEKLY_REMINDER: {
        auto: values.autoSendWeeklyReminder,
        schedule: scheduleFrom(values.weeklyReminderDay, values.weeklyReminderTime),
      },
      GROUP_ANNOUNCEMENT: { auto: values.autoSendGroupAnnouncement, schedule: null },
    },
  };
}

/**
 * What this setting MEANS, in the organizer's words — for the screen and for
 * the audit log.
 *
 * A switch labelled "Automatic" states a mechanism, not a consequence. 2.10
 * and the trust law both want the effect said out loud: the difference between
 * these two positions is whether a member hears from the platform without Oli
 * doing anything, and that is what the sentence has to carry.
 */
export function messageTimingSummary(
  key: ConfigurableMessageKey,
  timing: MessageTiming,
): string {
  if (!timing.auto) return "You send it by hand — nothing goes out on its own.";
  if (timing.schedule) {
    return `Sends itself on ${WEEKDAY_NAMES[timing.schedule.day]} at ${timing.schedule.time}.`;
  }
  if ((TIME_TRIGGERED_MESSAGE_KEYS as readonly string[]).includes(key)) {
    // Automatic with no day and time cannot fire — say so rather than implying
    // it is armed. This is the state a half-set schedule leaves behind.
    return "Sends itself — but no day and time are set, so nothing will go out yet.";
  }
  return "Sends itself as soon as the thing it describes happens.";
}

/** Is this key one whose template does not exist yet? */
export function isReservedMessageKey(key: ConfigurableMessageKey): boolean {
  return (RESERVED_MESSAGE_KEYS as readonly string[]).includes(key);
}

/**
 * Which stored setting carries each type's auto/manual switch.
 *
 * A `Record` over the key union, so adding a configurable message type without
 * giving it a setting is a COMPILE ERROR rather than a switch that silently
 * saves nothing — the same guard `SETTING_LABELS` uses on the registry itself.
 *
 * The `SettingKey` import is TYPE-ONLY and erased at build: lib/setting-defaults
 * imports `DEFAULT_TIMEZONE` from this file as a value, and a runtime cycle
 * between them would be real. Same shape as lib/placeholder-kinds ↔ lib/messages.
 */
export const AUTO_SEND_SETTING = {
  PAYMENT_CONFIRMED: "autoSendPaymentConfirmed",
  PAYMENT_CONFIRMED_WITH_PARTIAL: "autoSendPaymentConfirmedWithPartial",
  PARTIAL_CONFIRMED: "autoSendPartialConfirmed",
  PARTIAL_COMPLETED: "autoSendPartialCompleted",
  LATE_NOTICE: "autoSendLateNotice",
  BEHIND_NOTICE: "autoSendBehindNotice",
  WINNER_ANNOUNCEMENT: "autoSendWinnerAnnouncement",
  WEEKLY_REMINDER: "autoSendWeeklyReminder",
  GROUP_ANNOUNCEMENT: "autoSendGroupAnnouncement",
} as const satisfies Record<ConfigurableMessageKey, SettingKey>;

/** The [day, time] setting pair for each clock-driven type. */
export const SCHEDULE_SETTINGS = {
  LATE_NOTICE: ["lateNoticeDay", "lateNoticeTime"],
  WEEKLY_REMINDER: ["weeklyReminderDay", "weeklyReminderTime"],
} as const satisfies Record<
  (typeof TIME_TRIGGERED_MESSAGE_KEYS)[number],
  readonly [SettingKey, SettingKey]
>;
