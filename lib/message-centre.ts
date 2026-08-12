import { MESSAGE_KEYS, type MessageKey } from "./messages";

// THE MESSAGE CENTRE — filters and sentences, with no database attached.
//
// Messages was a page you SCROLLED: a composer, then four template editors,
// then a flat log of every send to everybody in one reverse-chronological
// column. Answering "what have I actually said to Tsion?" meant reading past
// twenty-six other people's messages, and answering "and what should I send
// her now?" meant leaving for her profile.
//
// A messaging tool answers both in one place: a list of people on one side, a
// conversation on the other. Every message ever sent lives in that
// conversation, in the order it was said, with what happened to it.
//
// This module is the part that can be tested without rows: what the filters
// mean, and what the screen says about the filter it is showing.

export type ConversationFilter = {
  /** A message type, or "all". */
  templateKey: MessageKey | "all";
  /** Inclusive ISO dates, or null for open-ended. */
  from: string | null;
  to: string | null;
};

/** A filter that shows everything — the state the screen opens in. */
export const NO_FILTER: ConversationFilter = { templateKey: "all", from: null, to: null };

function firstOf(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

/** An ISO calendar date, and nothing else — `2026-08-12`. */
function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

/**
 * The filter a URL is asking for.
 *
 * EVERY UNREADABLE VALUE FALLS BACK TO "SHOW EVERYTHING", never to an empty
 * result. A conversation that renders as blank because a date was mistyped is
 * indistinguishable from a member who has never been messaged, and the second
 * is a fact the organizer would act on.
 */
export function parseConversationFilter(query: {
  type?: string | string[];
  from?: string | string[];
  to?: string | string[];
}): ConversationFilter {
  const type = firstOf(query.type);
  const from = firstOf(query.from);
  const to = firstOf(query.to);

  const templateKey: MessageKey | "all" =
    type !== undefined && (MESSAGE_KEYS as readonly string[]).includes(type)
      ? (type as MessageKey)
      : "all";

  let start = from !== undefined && isIsoDate(from) ? from : null;
  let end = to !== undefined && isIsoDate(to) ? to : null;
  // A range typed backwards is a slip, not a request for nothing. Swapping it
  // shows what he meant; honouring it shows an empty conversation.
  if (start !== null && end !== null && start > end) [start, end] = [end, start];

  return { templateKey, from: start, to: end };
}

export function filterIsActive(filter: ConversationFilter): boolean {
  return filter.templateKey !== "all" || filter.from !== null || filter.to !== null;
}

/**
 * The half-open UTC range a date filter means, for the query.
 *
 * `to` is INCLUSIVE to the reader — "to 12 August" means everything said on
 * the 12th — so it becomes midnight on the 13th. Treating it as midnight on
 * the 12th silently drops a whole day, and the day it drops is usually today.
 */
export function conversationDateRange(filter: ConversationFilter): {
  gte?: Date;
  lt?: Date;
} {
  const range: { gte?: Date; lt?: Date } = {};
  if (filter.from) range.gte = new Date(`${filter.from}T00:00:00.000Z`);
  if (filter.to) range.lt = new Date(new Date(`${filter.to}T00:00:00.000Z`).getTime() + 86_400_000);
  return range;
}

/**
 * What the screen is showing, in a sentence.
 *
 * A filtered conversation must never be mistaken for the whole one — the same
 * rule `truncationNotice` exists for. So this states the filter AND the counts
 * whenever anything is narrowed, and says nothing at all when nothing is.
 */
export function conversationSummary(input: {
  name: string;
  filter: ConversationFilter;
  shown: number;
  total: number;
  label: (key: MessageKey) => string;
}): string | null {
  if (!filterIsActive(input.filter)) return null;
  const parts: string[] = [];
  if (input.filter.templateKey !== "all") {
    parts.push(`${input.label(input.filter.templateKey).toLowerCase()} only`);
  }
  if (input.filter.from && input.filter.to) parts.push(`${input.filter.from} to ${input.filter.to}`);
  else if (input.filter.from) parts.push(`from ${input.filter.from}`);
  else if (input.filter.to) parts.push(`up to ${input.filter.to}`);

  return (
    `Showing ${input.shown} of ${input.total} message${input.total === 1 ? "" : "s"} ` +
    `to ${input.name} — ${parts.join(", ")}.`
  );
}

/** What a person's row in the list says under their name. */
export function threadSubtitle(input: {
  total: number;
  lastAt: Date | null;
  lastFailed: boolean;
  now: Date;
}): string {
  if (input.total === 0 || input.lastAt === null) return "Nothing sent yet";
  const days = Math.floor(
    (Date.UTC(input.now.getUTCFullYear(), input.now.getUTCMonth(), input.now.getUTCDate()) -
      Date.UTC(
        input.lastAt.getUTCFullYear(),
        input.lastAt.getUTCMonth(),
        input.lastAt.getUTCDate(),
      )) /
      86_400_000,
  );
  const when =
    days <= 0 ? "today" : days === 1 ? "yesterday" : days < 7 ? `${days} days ago` : `${Math.floor(days / 7)} week${days < 14 ? "" : "s"} ago`;
  // A FAILURE IS THE HEADLINE. "Sent 2 days ago" over a message that never
  // arrived is the single most expensive thing this list could say.
  return input.lastFailed
    ? `Last message FAILED — ${when}`
    : `${input.total} message${input.total === 1 ? "" : "s"} · last ${when}`;
}

/**
 * Does this person match what was typed in the search box?
 *
 * Both names and the phone, because the organizer searches by whichever he has
 * in front of him — a name in Amharic, a name in English, or a number from his
 * call log.
 */
export function matchesSearch(
  person: { nameAmharic: string; nameEnglish: string; phone: string | null },
  search: string,
): boolean {
  const needle = search.trim().toLowerCase();
  if (needle === "") return true;
  const digits = needle.replace(/\D/g, "");
  return (
    person.nameAmharic.toLowerCase().includes(needle) ||
    person.nameEnglish.toLowerCase().includes(needle) ||
    (digits.length > 0 && (person.phone ?? "").replace(/\D/g, "").includes(digits))
  );
}
