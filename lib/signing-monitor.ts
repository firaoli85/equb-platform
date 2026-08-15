import type { SigningState } from "./agreement-view";

// WHO HAS SIGNED, AT A GLANCE (organizer ask, 14 Aug 2026).
//
// The directory already derives a `SigningState` per person; nothing here
// queries anything. What was missing was the AGGREGATE — the organizer could
// see 27 chips but never "how many are outstanding", and could not narrow the
// page to the ones that are.
//
// THE TONE DISTINCTION IS THE WHOLE POINT, and it is why this is not a
// two-way split. "Not asked" is the ORDINARY state: every member already
// mid-cycle is in it because no welcome was ever sent to them, and nothing is
// owed by anyone. Counting it beside "waiting" would report ~5 problems on a
// group with none, and would train the reader to ignore the number on the day
// it means something. Neutral and attention stay separate, here and in the UI.

/** The three buckets the organizer actually reads. */
export type SigningBucket = "signed" | "waiting" | "not-asked";

/**
 * Which bucket a state belongs to.
 *
 * The three WAITING states collapse — waiting, waiting again on new terms,
 * and gated-without-being-asked are one job ("chase this") even though the
 * chip names which, and the chip keeps naming which.
 */
export function signingBucket(state: SigningState): SigningBucket {
  if (state === "signed") return "signed";
  if (state === "not-asked") return "not-asked";
  return "waiting";
}

export type SigningCounts = { signed: number; waiting: number; notAsked: number; total: number };

export function countSigning(rows: readonly { signing: SigningState }[]): SigningCounts {
  const counts = { signed: 0, waiting: 0, notAsked: 0, total: rows.length };
  for (const row of rows) {
    const bucket = signingBucket(row.signing);
    if (bucket === "signed") counts.signed += 1;
    else if (bucket === "waiting") counts.waiting += 1;
    else counts.notAsked += 1;
  }
  return counts;
}

/** The filter the chip row applies. `all` is not a bucket — it is no filter. */
export type SigningFilter = "all" | SigningBucket;

export const SIGNING_FILTERS: readonly { key: SigningFilter; label: string }[] = [
  { key: "all", label: "Everyone" },
  { key: "signed", label: "Signed" },
  { key: "waiting", label: "Waiting" },
  { key: "not-asked", label: "Not asked" },
];

export function filterBySigning<T extends { signing: SigningState }>(
  rows: readonly T[],
  filter: SigningFilter,
): T[] {
  if (filter === "all") return [...rows];
  return rows.filter((r) => signingBucket(r.signing) === filter);
}

/**
 * Outstanding first, for the sort key.
 *
 * WAITING before NOT-ASKED before SIGNED — the order of what he has to do
 * something about. "Not asked" sits in the middle rather than last because
 * sending the welcome IS an action he may want to take, while a signature
 * already given needs nothing.
 */
const BUCKET_ORDER: Record<SigningBucket, number> = { waiting: 0, "not-asked": 1, signed: 2 };

export function bySigningOutstanding(
  a: { signing: SigningState },
  b: { signing: SigningState },
): number {
  return BUCKET_ORDER[signingBucket(a.signing)] - BUCKET_ORDER[signingBucket(b.signing)];
}
