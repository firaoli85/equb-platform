// DIRECTORY SORT (14 Aug 2026 order): alphabetical is the default; the money
// and commitment keys order DESCENDING — "sort by weekly amount" asks who
// pays the most, not the least. Ties fall back to the name so the order is
// stable and scannable.
//
// The pattern copied from lib/waiting.ts WAITING_SORTS: an exported
// {key,label} array beside pure comparators, so the <Select> and the sort
// cannot drift apart and the comparators test without a DOM.

import type { SigningState } from "./agreement-view";
import { bySigningOutstanding } from "./signing-monitor";

export type DirectorySortKey =
  | "name"
  | "signing"
  | "weekly"
  | "contributed"
  | "committed"
  | "weeksPaid";

export const DIRECTORY_SORTS: readonly { key: DirectorySortKey; label: string }[] = [
  { key: "name", label: "Alphabetical" },
  { key: "signing", label: "Agreement outstanding" },
  { key: "weekly", label: "Weekly amount" },
  { key: "contributed", label: "Total contributed" },
  { key: "committed", label: "Weeks committed" },
  { key: "weeksPaid", label: "Weeks paid" },
];

export type DirectorySortFacts = {
  nameEnglish: string;
  /** The derived chip state — the outstanding sort orders by it. */
  signing: SigningState;
  weeklyAmount: number;
  contributedThisCycle: number;
  weeksCommitted: number;
  weeksPaid: number;
};

const byName = (a: DirectorySortFacts, b: DirectorySortFacts) =>
  a.nameEnglish.toLocaleLowerCase("en").localeCompare(b.nameEnglish.toLocaleLowerCase("en"), "en");

/** A stable, sorted COPY — never mutates the caller's rows. */
export function sortDirectory<T extends DirectorySortFacts>(
  rows: readonly T[],
  sort: DirectorySortKey,
): T[] {
  const out = [...rows];
  switch (sort) {
    // Outstanding first, then alphabetical WITHIN each bucket — otherwise the
    // list becomes three unordered piles rather than a scannable order.
    case "signing":
      return out.sort((a, b) => bySigningOutstanding(a, b) || byName(a, b));
    case "weekly":
      return out.sort((a, b) => b.weeklyAmount - a.weeklyAmount || byName(a, b));
    case "contributed":
      return out.sort((a, b) => b.contributedThisCycle - a.contributedThisCycle || byName(a, b));
    case "committed":
      return out.sort((a, b) => b.weeksCommitted - a.weeksCommitted || byName(a, b));
    case "weeksPaid":
      return out.sort((a, b) => b.weeksPaid - a.weeksPaid || byName(a, b));
    default:
      return out.sort(byName);
  }
}
