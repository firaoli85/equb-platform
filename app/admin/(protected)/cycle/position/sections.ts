import type { Section } from "@/components/ui/section-nav";

// THE CYCLE POSITION IS FOUR QUESTIONS, NOT ONE SCROLL.
//
// The page answered all of them at once — should-vs-actual, who is short, what
// has been paid forward, what he ought to be holding and what he actually is —
// as six stacked cards. Every card was correct and the screen was a wall: the
// figure he opens it for ("am I using someone else's money") sat below three
// others, so reaching it meant scrolling past the ones he was not asking about.
//
// The same rule the member profile and Messages apply, one level down from
// docs/ADMIN_IA.md: WEIGHT MATCHES PLACEMENT. Each of these has its own reason
// to exist and its own figures, so each gets its own section.
//
// THE ORDER IS THE ORGANIZER'S OWN. Collection first, because that is the week
// he is living in. Then paid-ahead, because it is the piece he could not see
// and it changes how the next figure reads. Then what he should hold, then
// what he does — the comparison only means anything after the two halves.
//
// WEEK DATES COME LAST, and that is a placement argument rather than a
// ranking. ADMIN_IA §3 says this page carries "the stored dates that are
// authoritative (rule 7), and the position they produce" — the dates are what
// everything above stands on, but they are not what he opens the page for.
// They are read when a figure looks wrong, which is after he has read the
// figure. It is also the only section that WRITES, and a correction tool
// belongs after the facts it corrects.

export const POSITION_SECTIONS = ["collection", "ahead", "holding", "cash", "weeks"] as const;
export type PositionSection = (typeof POSITION_SECTIONS)[number];

export const DEFAULT_SECTION: PositionSection = "collection";

/** A `?section=` value, or the default. Never trusts the URL. */
export function parsePositionSection(raw: string | string[] | undefined): PositionSection {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return POSITION_SECTIONS.includes(value as PositionSection)
    ? (value as PositionSection)
    : DEFAULT_SECTION;
}

/**
 * The nav, with the counts and the attention dots that make it worth reading
 * before clicking.
 *
 * `attention` is set from real state, never decoration: money outstanding,
 * money paid toward weeks that have not happened, holding less than what
 * belongs to other people, or a cash reading that cannot cover what is owed. A dot that is always on teaches the reader to
 * ignore it.
 */
export function positionSections(input: {
  owedByCount: number;
  shortfall: number;
  aheadByCount: number;
  paidAhead: number;
  /** Cents behind payouts already handed over that will never arrive (2.18). */
  toCover: number;
  /** He is holding less than the money that belongs to other people. */
  holdingLessThanOwed: boolean;
  /** null when no reading has been recorded yet. */
  verdictKind: "covered" | "surplus" | "short" | "exact" | null;
  /**
   * Weeks whose stored date does not run after the week before them
   * (`outOfSequenceWeeks`). Audit finding 29 let the server accept one, so
   * live rows may already carry it — and a backwards ladder moves who counts
   * as overdue while looking like nothing at all.
   */
  outOfSequenceCount: number;
}): Section[] {
  return [
    {
      key: "collection",
      label: "Collection",
      count: input.owedByCount || undefined,
      // Money he has to cover himself earns the dot on its own: it sits in no
      // total on the page, because those weeks stopped being expected.
      attention: input.shortfall > 0 || input.toCover > 0,
    },
    {
      key: "ahead",
      label: "Paid ahead",
      count: input.aheadByCount || undefined,
      attention: input.paidAhead > 0,
    },
    {
      key: "holding",
      label: "What you should hold",
      // Holding less than the money that belongs to other people IS the
      // "using someone else's money" signal — the question the screen exists
      // to answer. Not a projection, and not a colour on a fact.
      attention: input.holdingLessThanOwed,
    },
    {
      key: "cash",
      label: "What you hold",
      // No reading yet is worth a nudge: the comparison cannot run without it.
      attention: input.verdictKind === null || input.verdictKind === "short",
    },
    {
      key: "weeks",
      label: "Week dates",
      // The COUNT is faults, not weeks. "20" beside a tab is a size; a number
      // that is normally absent and occasionally 1 is a finding.
      count: input.outOfSequenceCount || undefined,
      attention: input.outOfSequenceCount > 0,
    },
  ];
}
