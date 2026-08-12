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

// ————————————————— DOES THE FEE APPLY TO SOMEONE NEVER DRAWN? —————————————————
//
// NO — and this is a deliberate reading of the rules, not an assumption.
//
// The fee is defined against the PAYOUT, everywhere it is defined:
//
//   2.14  "Fee | 2% of gross"; "Payout | (weekly amount × their weeks) − fee"
//   DOMAIN_RULES rule 2  "Fee is 2% of gross. Payout is gross minus fee. Each
//                        lucky number pays its own fee." — and, decisively:
//                        "The fee is charged PER MEMBER PAYOUT, not once on the
//                        pot — a member holding three numbers pays three fees,
//                        BECAUSE THEY RECEIVE THREE PAYOUTS."
//
// The fee is never charged on a contribution. It is deducted from a payout at
// the moment one is made. A member who was never drawn has never had a payout,
// so no fee has ever been taken from them and none is owed now — deducting one
// would charge them for a service they did not receive, and would be the only
// place in the platform where a fee existed without a payout behind it.
//
// The whole-cycle arithmetic agrees: the organizer's fee income is the sum of
// the fees on the payouts actually made. A slot that never paid out never
// earned him a fee, so returning that member's money in full costs him nothing
// he had earned — he was only ever holding it.
//
// THE ORGANIZER MAY RULE OTHERWISE (2.2 — his discretion, his group). If he
// does, `feeOnReturn` below is the single place it changes, and the sentence
// will state the deduction rather than hiding it.

/** Cents of fee to withhold when returning an undrawn member's money. */
export function feeOnReturn(): number {
  // Zero, per the reading above. A function rather than a literal so the
  // organizer's ruling has one place to land, and so this stays greppable.
  return 0;
}

export type FinalPosition =
  | {
      direction: "owed-to-them";
      /** Everything they paid in. */
      paidIn: number;
      /** Withheld on return. Zero — see feeOnReturn. */
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
}): FinalPosition {
  const drawn = input.received > 0;

  if (!drawn) {
    const fee = feeOnReturn();
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
): string {
  switch (position.direction) {
    case "owed-to-them":
      return (
        `You paid in ${money(position.paidIn)}. You were not drawn. ` +
        `${money(position.amount)} is owed to you — ${organizerName} will arrange it.`
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
        `and were never drawn. No fee applies: a fee is only ever taken from a payout, and ` +
        `they never had one.`
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

/** Signed cents: positive when HE owes, negative when THEY owe. */
export function owedToStoppedMember(position: FinalPosition): number {
  if (position.direction === "owed-to-them") return position.amount;
  if (position.direction === "they-owe") return -position.amount;
  return 0;
}
