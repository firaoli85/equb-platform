// WHERE A STOPPED MEMBER STANDS — the one sentence neither side can work out
// on their own.
//
// Tsion stopped mid-cycle and her portal showed "You're not in the current
// cycle. When the organizer adds you to a cycle, it will appear here." — a
// blank wall on the day she would most want her record. 2.18 is explicit that
// closed members KEEP access and can see where they stopped, and that "the
// record of where they stopped is preserved": last payment week, amount, and
// the resulting balance. This is the second place that rule was broken.
//
// THE ARITHMETIC RUNS IN TWO DIRECTIONS, and the system must state whichever
// applies rather than leaving it implicit:
//
//   PAID IN, NEVER DRAWN  — the group owes THEM. They put money in for weeks
//                           and took nothing out.
//   DRAWN, THEN STOPPED   — they owe the group. They took the whole pot on the
//                           promise of paying every week, and did not.
//
// A member who has stopped is exactly the person who cannot compute this, and
// the organizer should not be doing it on paper either.

// ————————————————— THE FEE FOLLOWS THE COMMITMENT (§2.30) —————————————————
//
// THE ORGANIZER'S RULING, and a correction to what was built first.
//
// The fee is fixed by what a member COMMITTED TO, not by how much of it they
// actually attended:
//
//   Join for 20 weeks at $500  → payout $10,000, fee $200. Always $200.
//   Stop at week 12            → the fee is STILL $200. Stopping does not
//                                reduce it.
//   Change the RATE to $250    → 20 × $250 = $5,000, so the fee becomes $100.
//
// Only the contribution RATE moves the fee. Attendance never does.
//
// WHAT WAS BUILT FIRST, AND WHY IT WAS WRONG. DOMAIN_RULES rule 2 says the fee
// is "charged per member payout ... because they receive three payouts", and I
// read that as "no payout, no fee" — so an undrawn member was returned their
// money in full. That reading takes a sentence about HOW MANY fees a
// multi-number member pays (one per number) and turns it into a claim about
// WHETHER a fee is owed at all. The fee is the organizer's charge for running
// the member's place in the cycle; the place existed and was held for them
// whether or not the wheel reached them. Rule 2 now says so outright.
//
// ONE DERIVATION. This computes through `feePreview`, which sums PER LUCKY
// NUMBER through the same `calculatePayout` the draw, the portal and the
// archive use. At 2% the per-number and total-first roads happen to meet; at a
// percent that does not divide evenly they drift by a cent or two, and the
// organizer quoting one figure while the member reads another is exactly the
// failure that module exists to prevent.

import { feePreview } from "./fee-preview";

/**
 * The fee withheld when returning an undrawn member's money: the fee on their
 * whole COMMITMENT, unreduced by stopping early.
 *
 * Returns 0 only when the inputs cannot describe a commitment at all — never
 * as a judgement that no fee is due.
 */
export function feeOnReturn(input: {
  weeklyAmount: number;
  weeksCommitted: number;
  /** The cycle's real unit — never hardcoded (2.6). */
  unitAmount: number;
  /** The cycle's real fee percent — never hardcoded (2.6). */
  feePercent: number;
}): number {
  return feePreview(input)?.fee ?? 0;
}

export type FinalPosition =
  | {
      direction: "owed-to-them";
      /** Everything they paid in. */
      paidIn: number;
      /** The fee on their whole COMMITMENT — stopping does not reduce it. */
      fee: number;
      /** What the group owes them. */
      amount: number;
      drawn: false;
    }
  | {
      direction: "they-owe";
      paidIn: number;
      /** Net cents actually handed to them. */
      received: number;
      /** Their whole commitment: weekly × weeks committed. */
      committed: number;
      /** committed − paidIn: contributions that were never paid. */
      amount: number;
      drawn: true;
    }
  | {
      direction: "settled";
      paidIn: number;
      received: number;
      drawn: boolean;
    };

/**
 * Where they stand, in whichever direction applies.
 *
 * DRAWN IS THE DECIDING FACT, not the size of the numbers. Someone who took
 * the pot owes their whole commitment whatever they had paid so far, because
 * the pot they received was funded by everyone paying every week. Someone
 * never drawn is simply owed their money back.
 */
export function finalPosition(input: {
  /** Every cent they paid in, from the receipts (2.14). */
  paidIn: number;
  /** Net cents handed to them across their payouts. 0 if never drawn. */
  received: number;
  weeklyAmount: number;
  weeksCommitted: number;
  /** The cycle's real unit — never hardcoded (2.6). */
  unitAmount: number;
  /** The cycle's real fee percent — never hardcoded (2.6). */
  feePercent: number;
}): FinalPosition {
  const drawn = input.received > 0;

  if (!drawn) {
    // The fee on their WHOLE COMMITMENT — stopping early does not reduce it.
    const fee = feeOnReturn(input);
    const amount = Math.max(0, input.paidIn - fee);
    if (amount === 0) {
      // They were never drawn and paid nothing in. Nothing moves either way,
      // and saying "you are owed $0" would be worse than saying so plainly.
      return { direction: "settled", paidIn: input.paidIn, received: 0, drawn: false };
    }
    return { direction: "owed-to-them", paidIn: input.paidIn, fee, amount, drawn: false };
  }

  const committed = input.weeklyAmount * input.weeksCommitted;
  const unpaid = committed - input.paidIn;
  if (unpaid <= 0) {
    // They took the pot AND paid every week. Nothing is outstanding in either
    // direction — the ordinary, finished shape.
    return { direction: "settled", paidIn: input.paidIn, received: input.received, drawn: true };
  }
  return {
    direction: "they-owe",
    paidIn: input.paidIn,
    received: input.received,
    committed,
    amount: unpaid,
    drawn: true,
  };
}

/**
 * THE SENTENCE THE MEMBER READS.
 *
 * Their own frame — no cycle week numbers (UI_STANDARDS 8c) — and the figure
 * stated outright, never left for them to work out. It names the organizer,
 * because "the group" does not arrange anything; a person does.
 */
export function finalPositionSentence(
  position: FinalPosition,
  organizerName: string,
  money: (cents: number) => string,
  /**
   * When the cycle finishes, already formatted. MONEY IS RETURNED AT THE END
   * OF THE CYCLE, NOT ON STOPPING — paying someone out early takes it from the
   * members still contributing. Saying only "will arrange it" left them
   * expecting it now, so the date is part of the sentence, not a footnote.
   */
  cycleFinishes: string | null,
): string {
  const when =
    cycleFinishes === null
      ? `${organizerName} will settle this when the cycle finishes`
      : `${organizerName} will settle this when the cycle finishes on ${cycleFinishes}`;

  switch (position.direction) {
    case "owed-to-them":
      return (
        `You paid in ${money(position.paidIn)}. You were not drawn. ` +
        `${money(position.amount)} is owed to you after the ${money(position.fee)} fee — ` +
        `${when}.`
      );
    case "they-owe":
      return (
        `You paid in ${money(position.paidIn)} and received ${money(position.received)}. ` +
        `${money(position.amount)} of your contributions was not paid. ` +
        `${organizerName} will be in touch.`
      );
    case "settled":
      return position.drawn
        ? `You paid in ${money(position.paidIn)} and received ${money(position.received)}. ` +
            `Nothing is outstanding either way.`
        : `You paid in ${money(position.paidIn)} and were not drawn. ` +
            `Nothing is outstanding either way.`;
  }
}

/**
 * THE SAME FIGURE, FOR THE ORGANIZER.
 *
 * Deliberately the same derivation and the same direction words, so his screen
 * and her portal can never disagree about who owes whom.
 */
export function finalPositionAdminLine(
  position: FinalPosition,
  memberName: string,
  money: (cents: number) => string,
): string {
  switch (position.direction) {
    case "owed-to-them":
      return (
        `You owe ${memberName} ${money(position.amount)} — they paid in ${money(position.paidIn)} ` +
        `and were never drawn, less the ${money(position.fee)} fee on their commitment. ` +
        `Settle it when the cycle finishes, not before: paying it out now takes it from the ` +
        `members still contributing.`
      );
    case "they-owe":
      return (
        `${memberName} owes ${money(position.amount)} — they received ${money(position.received)} ` +
        `and paid in ${money(position.paidIn)} of a ${money(position.committed)} commitment.`
      );
    case "settled":
      return `${memberName} is square — nothing is outstanding either way.`;
  }
}

/**
 * THE HEADLINE — the organizer's ruling, 14 Aug 2026 (audit item #8).
 *
 * `finalStanding` was computed on every closed member's profile and rendered
 * nowhere: the promised 2.18 answer — what he owes them, or they owe him —
 * was dead work on every page load. This is the line that shows it.
 *
 * DELIBERATELY BLUNT, and the wording is the ruling's: two directions and a
 * settled state, each one sentence, each naming the figure outright. The
 * fuller explanation (why, and when to settle) is `finalPositionAdminLine`,
 * which renders under it — this is the sentence that must survive being read
 * in a hurry.
 *
 * NO DASHES. Admin-side today, but this is the sentence most likely to be
 * lifted into a member surface later, and the 14 Aug standing rule bans them
 * from member-facing text.
 */
export function finalPositionHeadline(
  position: FinalPosition,
  money: (cents: number) => string,
): string {
  switch (position.direction) {
    // Owed TO them: he is holding money that is not his.
    case "owed-to-them":
      return `Final position: you owe them ${money(position.amount)}.`;
    case "they-owe":
      return `Final position: they owe you ${money(position.amount)}.`;
    case "settled":
      return "Final position: settled, nothing owed either way.";
  }
}

/** Signed cents: positive when HE owes, negative when THEY owe. */
export function owedToStoppedMember(position: FinalPosition): number {
  if (position.direction === "owed-to-them") return position.amount;
  if (position.direction === "they-owe") return -position.amount;
  return 0;
}
