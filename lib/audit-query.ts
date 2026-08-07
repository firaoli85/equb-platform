// READING THE AUDIT LOG (D-32, 2.14).
//
// The log was one undifferentiated list of the 200 most recent entries. That
// is fine on day three and useless in month six: "what did I change about
// Hana's payout in March?" has no answer, and entry 201 is unreachable
// entirely — the record exists but cannot be read, which is the same as not
// having it.
//
// This module owns the READING rules — paging, filtering, the date range and
// the sentence that says what is currently being shown. It is pure so the
// awkward parts (an inclusive end date is not the same as a "less than", a
// page past the end, a reversed range) are decided once and tested, rather
// than re-derived in a query builder.
//
// APPEND-ONLY is not enforced here. It cannot be: a rule in a TypeScript file
// is a promise, and the log is the thing that has to be trustworthy when the
// rest of the system is not. It is enforced by a Postgres trigger
// (prisma/migrations/…_audit_log_append_only) and pinned by a guard test.

export const AUDIT_PAGE_SIZE = 50;

/** The action words logAudit writes. "all" is the unfiltered view. */
export const AUDIT_ACTIONS = ["create", "update", "delete", "move"] as const;
export type AuditActionFilter = (typeof AUDIT_ACTIONS)[number] | "all";

export function isAuditAction(value: string): value is AuditActionFilter {
  return value === "all" || (AUDIT_ACTIONS as readonly string[]).includes(value);
}

export type AuditFilterInput = {
  action?: string | null;
  entity?: string | null;
  /** The person whose story is being read, or null for everyone. */
  personId?: string | null;
  /** Inclusive, YYYY-MM-DD. */
  from?: string | null;
  /** Inclusive — the whole of that day, which is why it becomes a "< next day". */
  to?: string | null;
  page?: number | string | null;
};

export type AuditFilter = {
  action: AuditActionFilter;
  entity: string | "all";
  personId: string | null;
  from: string | null;
  to: string | null;
  page: number;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A filter from whatever the URL happens to hold, with nothing trusted. */
export function parseAuditFilter(input: AuditFilterInput): AuditFilter {
  const action = input.action && isAuditAction(input.action) ? input.action : "all";
  const entity = input.entity?.trim() ? input.entity.trim() : "all";
  const from = input.from && DATE.test(input.from) ? input.from : null;
  const to = input.to && DATE.test(input.to) ? input.to : null;
  const pageNumber = Number(input.page ?? 1);
  const page = Number.isSafeInteger(pageNumber) && pageNumber >= 1 ? pageNumber : 1;
  return {
    action,
    entity,
    personId: input.personId?.trim() || null,
    // A reversed range returns NOTHING, silently, which reads as "nothing
    // happened" rather than "you typed the dates the wrong way round". Swap.
    from: from && to && from > to ? to : from,
    to: from && to && from > to ? from : to,
    page,
  };
}

export type DateWindow = { gte?: Date; lt?: Date };

/**
 * The half-open window a date range means.
 *
 * `to` is INCLUSIVE — an organizer asking for "3 March to 5 March" means the
 * whole of the 5th. Entries carry a timestamp, so the query has to run to the
 * start of the 6th; a `lte` on the 5th would silently drop everything after
 * midnight and lose almost the entire day.
 */
export function auditDateWindow(filter: {
  from: string | null;
  to: string | null;
}): DateWindow | null {
  if (!filter.from && !filter.to) return null;
  const window: DateWindow = {};
  if (filter.from) window.gte = new Date(`${filter.from}T00:00:00.000Z`);
  if (filter.to) {
    const day = new Date(`${filter.to}T00:00:00.000Z`);
    window.lt = new Date(day.getTime() + 86_400_000);
  }
  return window;
}

export type PageInfo = {
  page: number;
  pages: number;
  total: number;
  skip: number;
  take: number;
  /** 1-based position of the first row shown, or 0 when there are none. */
  firstShown: number;
  lastShown: number;
  hasPrevious: boolean;
  hasNext: boolean;
};

/**
 * Where a page sits in the whole.
 *
 * A page past the end is CLAMPED rather than shown empty: filters narrow while
 * a page number stays put — pick "delete" while reading page 7 and there may
 * be one page — and an empty screen reads as "there is nothing here".
 */
export function auditPageInfo(
  total: number,
  page: number,
  pageSize = AUDIT_PAGE_SIZE,
): PageInfo {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pages);
  const skip = (current - 1) * pageSize;
  return {
    page: current,
    pages,
    total,
    skip,
    take: pageSize,
    firstShown: total === 0 ? 0 : skip + 1,
    lastShown: Math.min(skip + pageSize, total),
    hasPrevious: current > 1,
    hasNext: current < pages,
  };
}

/**
 * What is on screen right now, as a sentence.
 *
 * A filtered list that looks unfiltered is how someone concludes a change was
 * never recorded. The page says what it is showing, always — including that it
 * is showing everything.
 */
export function auditFilterSummary(
  filter: AuditFilter,
  info: PageInfo,
  personName: string | null,
): string {
  const parts: string[] = [];
  if (filter.action !== "all") parts.push(`${filter.action}s only`);
  if (filter.entity !== "all") parts.push(`${filter.entity} entries`);
  if (personName) parts.push(`everything touching ${personName}`);
  if (filter.from && filter.to) parts.push(`${filter.from} to ${filter.to}`);
  else if (filter.from) parts.push(`from ${filter.from}`);
  else if (filter.to) parts.push(`up to ${filter.to}`);

  const scope = parts.length === 0 ? "Every recorded change" : parts.join(", ");
  if (info.total === 0) return `${scope} — nothing matches.`;
  const range =
    info.total <= info.take
      ? `${info.total} entr${info.total === 1 ? "y" : "ies"}`
      : `${info.firstShown}–${info.lastShown} of ${info.total}`;
  return `${scope} — showing ${range}.`;
}

/** True when anything at all is narrowing the list. */
export function auditFilterActive(filter: AuditFilter): boolean {
  return (
    filter.action !== "all" ||
    filter.entity !== "all" ||
    filter.personId !== null ||
    filter.from !== null ||
    filter.to !== null
  );
}

/**
 * A regular expression that matches a person's name in an entry summary.
 *
 * WHY A NAME MATCH AT ALL. Most entries name a member only in their prose:
 * an entry about a deleted payout points at the payout's id, and once the
 * payout is gone that id resolves to nothing. Owned-id matching finds every
 * live row; this finds the entries about rows that no longer exist, which are
 * exactly the deletions — the ones most worth reading.
 *
 * Bounded on both sides so "Hana" does not match "Hanan", and escaped so a
 * name containing regex punctuation cannot change the pattern's meaning.
 */
export function personNamePattern(names: readonly (string | null)[]): RegExp | null {
  const cleaned = names
    .map((n) => n?.trim())
    .filter((n): n is string => !!n && n.length >= 2)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (cleaned.length === 0) return null;
  // \b is ASCII-only and would never fire on Amharic, so the boundary is
  // written as "not a letter or digit in ANY script" instead.
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${cleaned.join("|")})(?![\\p{L}\\p{N}])`, "u");
}
