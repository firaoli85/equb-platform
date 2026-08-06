// THE one vocabulary for a week's payment status. Every surface — the
// payments grid, the members view, the member profile, this-week, the member
// portal — reads its wording and its colours from here, so a week can never
// be called "excused" on one screen and "deferred" on another.
//
// The wording carries the organizer's Aug 2026 ruling:
//
//   DEFERRED — "Deferred — not chased, still owed". One person's week. The
//              money IS owed; deferral only means we do not chase them for
//              it, and the week never reads LATE.
//   SKIPPED  — "Skipped — nobody owed this week". Cycle-wide. Fully excused,
//              which is what deferral used to mean. Never conflate the two.
//
// Contrast is MEASURED, not assumed: the week number rendered on these chips
// is 11px bold, which WCAG does not treat as large text, so every pair here
// clears 4.5:1 in both themes.

import type { PaymentStatusValue } from "./derived";

export type StatusTone = "good" | "attention" | "problem" | "neutral";

export type StatusLabel = {
  /** Sentence-case name for pills and headings. */
  text: string;
  /** Lower-case name for legends and inline prose. */
  short: string;
  /** One line of plain English: what this status means for the money. */
  meaning: string;
  /** Single glyph for the dense grid. */
  glyph: string;
  /** Measured background/foreground pair, light and dark. */
  cls: string;
  tone: StatusTone;
};

export const STATUS_LABELS: Record<PaymentStatusValue, StatusLabel> = {
  PAID: {
    text: "Paid",
    short: "paid",
    meaning: "paid in full",
    glyph: "✓",
    cls: "bg-emerald-700 text-white",
    tone: "good",
  },
  PARTIAL: {
    text: "Partial",
    short: "partial",
    meaning: "some money in, window still open",
    glyph: "◐",
    cls: "bg-amber-400 text-amber-950",
    tone: "attention",
  },
  UNPAID: {
    text: "Unpaid",
    short: "unpaid",
    meaning: "nothing yet, window still open",
    glyph: "·",
    cls: "bg-gray-100 text-gray-700 dark:bg-[#2f2f2f] dark:text-gray-100",
    tone: "neutral",
  },
  LATE: {
    text: "Late",
    short: "late",
    meaning: "unpaid and the window has closed",
    glyph: "✗",
    cls: "bg-red-600 text-white",
    tone: "problem",
  },
  DEFERRED: {
    text: "Deferred",
    short: "deferred",
    meaning: "not chased, still owed",
    glyph: "~",
    cls: "bg-sky-200 text-sky-950 dark:bg-sky-800 dark:text-sky-50",
    tone: "attention",
  },
  SKIPPED: {
    text: "Skipped",
    short: "skipped",
    meaning: "nobody owed this week",
    glyph: "—",
    cls: "bg-gray-300 text-gray-800 dark:bg-gray-600 dark:text-gray-100",
    tone: "neutral",
  },
};

/** The full phrase the organizer asked for, used wherever there is room. */
export const DEFERRED_PHRASE = "Deferred — not chased, still owed";
export const SKIPPED_PHRASE = "Skipped — nobody owed this week";

/** Never throws on an unknown status string coming from older data. */
export function statusLabel(status: string): StatusLabel {
  return (
    STATUS_LABELS[status as PaymentStatusValue] ?? {
      text: status,
      short: status.toLowerCase(),
      meaning: status.toLowerCase(),
      glyph: "?",
      cls: "bg-gray-100 text-gray-700 dark:bg-[#2f2f2f] dark:text-gray-100",
      tone: "neutral" as const,
    }
  );
}

/** Legend order: best news first, then the two flags that are not money. */
export const STATUS_LEGEND: PaymentStatusValue[] = [
  "PAID",
  "PARTIAL",
  "UNPAID",
  "LATE",
  "DEFERRED",
  "SKIPPED",
];
