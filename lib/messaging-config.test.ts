import { describe, expect, it } from "vitest";
import { AUTOMATIC_MESSAGE_KEYS, MESSAGE_KEYS } from "./messages";
import {
  CONFIGURABLE_MESSAGE_KEYS,
  DEFAULT_TIMEZONE,
  isWeekday,
  messageTimingSummary,
  resolveMessagingConfig,
  RESERVED_MESSAGE_KEYS,
  scheduleProblem,
  TIME_TRIGGERED_MESSAGE_KEYS,
  type ConfigurableMessageKey,
} from "./messaging-config";
import { SETTING_DEFAULTS, SETTING_LABELS, type SettingKey } from "./setting-defaults";

// PHASE 1 OF THE ONE-TRUTH ENGINE — THE CONFIG LAYER (ONE_TRUTH_ENGINE.md §3.0
// rule 7). Nothing reads this config yet; the messages and deadline phases do.
//
// THE ONE TEST THIS FILE EXISTS FOR is "defaults are a no-op": every resolved
// default must equal what the platform hard-codes TODAY, so shipping the layer
// changes nothing for any member until Oli flips a switch. It is asserted
// against `AUTOMATIC_MESSAGE_KEYS` itself rather than against a copied list —
// a second copy of the answer would pass while disagreeing with the code
// (§5.7: a test can pass for the wrong reason).

/** The config as it ships, with no stored rows at all. */
const shipped = resolveMessagingConfig({
  autoSendPaymentConfirmed: SETTING_DEFAULTS.autoSendPaymentConfirmed,
  autoSendPartialConfirmed: SETTING_DEFAULTS.autoSendPartialConfirmed,
  autoSendLateNotice: SETTING_DEFAULTS.autoSendLateNotice,
  autoSendBehindNotice: SETTING_DEFAULTS.autoSendBehindNotice,
  autoSendWinnerAnnouncement: SETTING_DEFAULTS.autoSendWinnerAnnouncement,
  autoSendWeeklyReminder: SETTING_DEFAULTS.autoSendWeeklyReminder,
  autoSendGroupAnnouncement: SETTING_DEFAULTS.autoSendGroupAnnouncement,
  lateNoticeDay: SETTING_DEFAULTS.lateNoticeDay,
  lateNoticeTime: SETTING_DEFAULTS.lateNoticeTime,
  weeklyReminderDay: SETTING_DEFAULTS.weeklyReminderDay,
  weeklyReminderTime: SETTING_DEFAULTS.weeklyReminderTime,
  equbTimezone: SETTING_DEFAULTS.equbTimezone,
});

describe("THE NO-OP PROOF — resolved defaults equal today's hard-coded behaviour", () => {
  it("auto-sends exactly what AUTOMATIC_MESSAGE_KEYS auto-sends today", () => {
    // Read off the live constant, not a copy of it. If someone makes a second
    // type automatic in the code and forgets the setting, this fails.
    for (const key of CONFIGURABLE_MESSAGE_KEYS) {
      const automaticToday = (AUTOMATIC_MESSAGE_KEYS as readonly string[]).includes(key);
      expect(
        shipped.message[key].auto,
        `${key} must ship matching today's behaviour (automatic today: ${automaticToday})`,
      ).toBe(automaticToday);
    }
  });

  it("means PAYMENT_CONFIRMED automatic and every other configurable type manual", () => {
    // The mapping stated in prose, so a reader of this file sees the intent as
    // well as the derivation above.
    expect(shipped.message.PAYMENT_CONFIRMED.auto).toBe(true);
    const others = CONFIGURABLE_MESSAGE_KEYS.filter((k) => k !== "PAYMENT_CONFIRMED");
    expect(others.map((k) => shipped.message[k].auto)).toEqual(others.map(() => false));
  });

  it("schedules NOTHING — there is no scheduler today, so nothing may fire by clock", () => {
    for (const key of CONFIGURABLE_MESSAGE_KEYS) {
      expect(shipped.message[key].schedule, `${key} must ship unscheduled`).toBeNull();
    }
  });

  it("keeps UTC, the convention every date function already uses", () => {
    // lib/money.ts: "week arithmetic runs on UTC calendar days".
    expect(shipped.timezone).toBe("UTC");
    expect(DEFAULT_TIMEZONE).toBe("UTC");
  });

  it("is not vacuous — a flipped setting DOES change the resolved config", () => {
    const flipped = resolveMessagingConfig({
      ...blank(),
      autoSendPaymentConfirmed: false,
      autoSendPartialConfirmed: false,
      autoSendLateNotice: true,
      autoSendBehindNotice: false,
      autoSendWinnerAnnouncement: false,
      autoSendWeeklyReminder: false,
      autoSendGroupAnnouncement: false,
      lateNoticeDay: "THU",
      lateNoticeTime: "09:00",
      weeklyReminderDay: "",
      weeklyReminderTime: "",
      equbTimezone: "America/New_York",
    });
    expect(flipped.message.PAYMENT_CONFIRMED.auto).toBe(false);
    expect(flipped.message.LATE_NOTICE.auto).toBe(true);
    expect(flipped.message.LATE_NOTICE.schedule).toEqual({ day: "THU", time: "09:00" });
    expect(flipped.timezone).toBe("America/New_York");
  });
});

describe("the reserved keys — a setting may exist before its template does", () => {
  it("reserves PARTIAL_CONFIRMED and the weekly reminder, and says so", () => {
    expect(RESERVED_MESSAGE_KEYS).toContain<ConfigurableMessageKey>("PARTIAL_CONFIRMED");
    expect(RESERVED_MESSAGE_KEYS).toContain<ConfigurableMessageKey>("WEEKLY_REMINDER");
  });

  it("those two genuinely have no message type behind them yet", () => {
    // The reservation is only honest while it is TRUE. When the partial phase
    // adds the type, this fails and the key stops being reserved.
    for (const key of RESERVED_MESSAGE_KEYS) {
      expect(
        (MESSAGE_KEYS as readonly string[]).includes(key),
        `${key} now exists as a message type — remove it from RESERVED_MESSAGE_KEYS`,
      ).toBe(false);
    }
  });

  it("resolves them like any other key rather than throwing or returning a hole", () => {
    // TOLERATED, NOT BROKEN. A reserved key must read as an ordinary manual
    // setting; a caller must never have to special-case it.
    for (const key of RESERVED_MESSAGE_KEYS) {
      expect(shipped.message[key]).toEqual({ auto: false, schedule: null });
    }
  });

  it("every non-reserved configurable key IS a real message type", () => {
    for (const key of CONFIGURABLE_MESSAGE_KEYS) {
      if ((RESERVED_MESSAGE_KEYS as readonly string[]).includes(key)) continue;
      expect((MESSAGE_KEYS as readonly string[]).includes(key), `${key} is not a message type`).toBe(
        true,
      );
    }
  });
});

describe("the schedule — only the time-triggered types carry one", () => {
  it("names LATE_NOTICE and the weekly reminder as the time-triggered pair", () => {
    expect([...TIME_TRIGGERED_MESSAGE_KEYS].sort()).toEqual(["LATE_NOTICE", "WEEKLY_REMINDER"]);
  });

  it("ignores a day and time stored against a type that is not time-triggered", () => {
    // There is no setting that could do this today; the resolver is written so
    // that adding one by accident cannot invent a schedule on an event-driven
    // message.
    for (const key of CONFIGURABLE_MESSAGE_KEYS) {
      if ((TIME_TRIGGERED_MESSAGE_KEYS as readonly string[]).includes(key)) continue;
      expect(shipped.message[key].schedule).toBeNull();
    }
  });

  it("treats a half-set schedule as NOT scheduled — never guesses the missing half", () => {
    const dayOnly = resolveMessagingConfig({
      ...blank(),
      lateNoticeDay: "THU",
      lateNoticeTime: "",
    });
    expect(dayOnly.message.LATE_NOTICE.schedule).toBeNull();
    const timeOnly = resolveMessagingConfig({ ...blank(), lateNoticeTime: "09:00" });
    expect(timeOnly.message.LATE_NOTICE.schedule).toBeNull();
  });

  it("refuses a nonsense day or time rather than storing it", () => {
    expect(scheduleProblem("THU", "09:00")).toBeNull();
    expect(scheduleProblem("", "")).toBeNull(); // not scheduled is legitimate
    expect(scheduleProblem("FUNDAY", "09:00")).toMatch(/day/i);
    expect(scheduleProblem("THU", "25:00")).toMatch(/time/i);
    expect(scheduleProblem("THU", "9am")).toMatch(/time/i);
  });

  it("drops a stored value that is not a real weekday instead of trusting it", () => {
    const junk = resolveMessagingConfig({
      ...blank(),
      lateNoticeDay: "FUNDAY",
      lateNoticeTime: "09:00",
    });
    expect(junk.message.LATE_NOTICE.schedule).toBeNull();
  });

  it("knows a weekday when it sees one", () => {
    expect(isWeekday("MON")).toBe(true);
    expect(isWeekday("mon")).toBe(false);
    expect(isWeekday("")).toBe(false);
  });
});

describe("the registry stays complete — the pattern's own guard", () => {
  it("gives every new setting a label, so the audit trail reads in English", () => {
    const keys: SettingKey[] = [
      "autoSendPaymentConfirmed",
      "autoSendPartialConfirmed",
      "autoSendLateNotice",
      "autoSendBehindNotice",
      "autoSendWinnerAnnouncement",
      "autoSendWeeklyReminder",
      "autoSendGroupAnnouncement",
      "lateNoticeDay",
      "lateNoticeTime",
      "weeklyReminderDay",
      "weeklyReminderTime",
      "equbTimezone",
    ];
    for (const k of keys) {
      expect(SETTING_LABELS[k], `${k} has no label`).toBeTruthy();
      expect(SETTING_LABELS[k]).not.toBe(k);
    }
  });

  it("states each control's effect in plain language, for the screen and the log", () => {
    expect(messageTimingSummary("PAYMENT_CONFIRMED", { auto: true, schedule: null })).toMatch(
      /sends itself/i,
    );
    expect(messageTimingSummary("BEHIND_NOTICE", { auto: false, schedule: null })).toMatch(
      /you send it/i,
    );
    expect(
      messageTimingSummary("LATE_NOTICE", { auto: true, schedule: { day: "THU", time: "09:00" } }),
    ).toMatch(/Thursday/);
  });
});

/** Every setting at its shipped default — the starting point for a variation. */
function blank() {
  return {
    autoSendPaymentConfirmed: SETTING_DEFAULTS.autoSendPaymentConfirmed,
    autoSendPartialConfirmed: SETTING_DEFAULTS.autoSendPartialConfirmed,
    autoSendLateNotice: SETTING_DEFAULTS.autoSendLateNotice,
    autoSendBehindNotice: SETTING_DEFAULTS.autoSendBehindNotice,
    autoSendWinnerAnnouncement: SETTING_DEFAULTS.autoSendWinnerAnnouncement,
    autoSendWeeklyReminder: SETTING_DEFAULTS.autoSendWeeklyReminder,
    autoSendGroupAnnouncement: SETTING_DEFAULTS.autoSendGroupAnnouncement,
    lateNoticeDay: SETTING_DEFAULTS.lateNoticeDay,
    lateNoticeTime: SETTING_DEFAULTS.lateNoticeTime,
    weeklyReminderDay: SETTING_DEFAULTS.weeklyReminderDay,
    weeklyReminderTime: SETTING_DEFAULTS.weeklyReminderTime,
    equbTimezone: SETTING_DEFAULTS.equbTimezone,
  };
}
