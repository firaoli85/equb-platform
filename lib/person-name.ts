// NAME ORDER — LATIN PRIMARY, AMHARIC SECONDARY (organizer ruling, 14 Aug
// 2026: "move on from Amharic-first", implemented as keep-but-demote).
//
// One module owns the order so a surface cannot half-flip: the Latin name is
// what every list, profile, message row and dashboard leads with; the
// Amharic name renders AFTER it, smaller, where present — and nothing at all
// where absent. No data is deleted: the Amharic column keeps its values, an
// absent one is stored as "" (the column is non-null), and this module is
// the single place that turns "" back into "nothing to render".
//
// SORTING keys on the Latin name, always — the directory, pickers and
// people lists all read alphabetical as A-Z of what the row LEADS with.

export type PersonNameFields = {
  nameEnglishFirst: string;
  nameEnglishLast?: string | null;
  nameAmharic?: string | null;
};

/** "Firaoli Seboka" — the primary display everywhere. */
export function personDisplayName(p: PersonNameFields): string {
  const last = p.nameEnglishLast?.trim();
  return last ? `${p.nameEnglishFirst.trim()} ${last}` : p.nameEnglishFirst.trim();
}

/**
 * The Amharic name when there IS one, null when there is not — callers
 * render nothing (no empty span, no stray separator) on null.
 */
export function personSecondaryName(p: PersonNameFields): string | null {
  const amharic = p.nameAmharic?.trim();
  return amharic ? amharic : null;
}

/**
 * The key alphabetical order sorts by: Latin, case-insensitive, first name
 * then last. localeCompare on THIS, never on nameAmharic.
 */
export function personSortKey(p: PersonNameFields): string {
  return personDisplayName(p).toLocaleLowerCase("en");
}

/** Comparator for Array.sort — Latin-alphabetical (the default list order). */
export function byPersonName(
  a: PersonNameFields,
  b: PersonNameFields,
): number {
  return personSortKey(a).localeCompare(personSortKey(b), "en");
}
