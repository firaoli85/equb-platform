import { SETTING_LABELS, type SettingKey } from "./setting-defaults";

// AN AUDIT ENTRY LEADS TO THE RECORD IT CHANGED (ADMIN_IA §8, last row).
//
//   "An audit entry's entity → the record it changed."
//
// The log rendered `{entry.entity}` as inert text — no `href` anywhere in the
// page — so the organizer reading "Participation | update | weeks 10 → 12" had
// to go and find that participation himself, from a screen whose entire job is
// tracing a change back to its subject.
//
// TWO RULES SHAPE WHAT IS LINKED.
//
// 1. A DELETION IS NEVER A LINK. The most valuable entries in this log are the
//    ones about records that no longer exist, and a link to a deleted person is
//    a 404 dressed up as an answer. `summary` already carries the name, which
//    is exactly why the person filter matches on it.
//
// 2. NO LINK IS BETTER THAN A GUESS. Several entities have no page keyed by
//    their id — a PaymentEvent, a LedgerEntry row, a CashReading. Sending the
//    organizer to a list and letting him hunt is the behaviour §8 exists to
//    remove, so those stay as text. The list below is the whole truth about
//    what resolves, and anything absent from it is absent on purpose.

/** Which settings page holds each key — an audit entry lands on the control. */
const SETTING_PAGES: Record<SettingKey, string> = {
  pinLoginEnabled: "/admin/settings/access",
  defaultPinFromPhone: "/admin/settings/access",
  pinMaxAttempts: "/admin/settings/access",
  pinLockMinutes: "/admin/settings/access",
  memberSessionIdleDays: "/admin/settings/access",
  memberSessionMaxDays: "/admin/settings/access",
  adminSessionIdleMinutes: "/admin/settings/access",
  adminSessionMaxHours: "/admin/settings/access",
  whatsappEnabled: "/admin/settings/messaging",
  notifyOnLockout: "/admin/settings/messaging",
  portalUrl: "/admin/settings/messaging",
  closingWaitDays: "/admin/settings/cycle",
  // Presentation mode has no settings row of its own — it is the pill in the
  // header, on every page. The index is the honest destination.
  presentationMode: "/admin/settings",
  // WHEN AND HOW MESSAGES SEND — all twelve live on one page, under
  // "When each message sends" (one-truth engine phase 1).
  autoSendPaymentConfirmed: "/admin/settings/messaging",
  autoSendPaymentConfirmedWithPartial: "/admin/settings/messaging",
  autoSendPartialCompleted: "/admin/settings/messaging",
  autoSendPartialConfirmed: "/admin/settings/messaging",
  autoSendLateNotice: "/admin/settings/messaging",
  autoSendBehindNotice: "/admin/settings/messaging",
  autoSendWinnerAnnouncement: "/admin/settings/messaging",
  autoSendWeeklyReminder: "/admin/settings/messaging",
  autoSendGroupAnnouncement: "/admin/settings/messaging",
  lateNoticeDay: "/admin/settings/messaging",
  lateNoticeTime: "/admin/settings/messaging",
  weeklyReminderDay: "/admin/settings/messaging",
  weeklyReminderTime: "/admin/settings/messaging",
  equbTimezone: "/admin/settings/messaging",
};

/**
 * Where an audit entry's subject lives, or null when it has nowhere to go.
 *
 * `action` is taken so a deletion is never linked — see rule 1 above.
 */
export function auditEntityHref(input: {
  entity: string;
  entityId: string;
  action: string;
}): string | null {
  if (input.action === "delete") return null;
  if (!input.entityId) return null;

  switch (input.entity) {
    // The id IS the route parameter.
    case "Person":
      return `/admin/people/${input.entityId}`;
    case "Participation":
      return `/admin/participations/${input.entityId}`;

    // The wheel holds every draw object — the slots, the numbers, the plans.
    // One screen, and it is the screen the change was made on.
    case "Wheel":
    case "Slot":
    case "LuckyNumber":
    case "WinnerPlan":
      return "/admin/wheel/setup";
    case "Draw":
      return "/admin/cycle/draws";

    // A payout is collected on Collections; one waiting to be collected is on
    // Waiting, but Collections shows both and is where the money is confirmed.
    case "Payout":
      return "/admin/collections";
    case "MessageTemplate":
      return "/admin/messages";
    case "CashReading":
      return "/admin/cycle/position";
    case "Cycle":
      return "/admin/cycle";

    // The key IS the entityId, and it names the page that holds the control.
    case "Setting":
      return isSettingKey(input.entityId) ? SETTING_PAGES[input.entityId] : "/admin/settings";

    // Week, Payment, PaymentEvent, LedgerEntry: no page is keyed by these ids.
    // A Week row's id is not its NUMBER, so `/admin/payments?week=<uuid>` would
    // resolve to nothing; the others are rows inside a member's history rather
    // than records with a screen. They stay as text (rule 2).
    default:
      return null;
  }
}

function isSettingKey(value: string): value is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTING_LABELS, value);
}

/** What the link promises, for the title attribute — never a bare route. */
export function auditEntityHint(entity: string): string {
  switch (entity) {
    case "Person":
      return "Open their directory entry";
    case "Participation":
      return "Open their record in this cycle";
    case "Wheel":
    case "Slot":
    case "LuckyNumber":
    case "WinnerPlan":
      return "Open the wheel setup";
    case "Draw":
      return "Open the draws";
    case "Payout":
      return "Open collections";
    case "MessageTemplate":
      return "Open the message templates";
    case "CashReading":
      return "Open where this cycle stands";
    case "Cycle":
      return "Open this cycle";
    case "Setting":
      return "Open the setting this changed";
    default:
      return "";
  }
}
