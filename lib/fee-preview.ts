// THE LIVE FEE ANSWER — what the organizer reads off the screen while someone
// is on the phone asking "if I put in $750 a week, what's your fee?".
//
// He should never calculate this by hand, and people propose irregular figures
// — $800, $325, $1,250, $1,875 — so this works for ANY amount. There is no
// tier list and there never was one; a tier list would answer three of those
// four questions and guess at the fourth.
//
// ONE DERIVATION, NOT TWO. The member portal already shows each member their
// own gross and net, and it computes them PER LUCKY NUMBER through
// `calculatePayout` (app/actions/member.ts). DOMAIN_RULES rule 2 is the reason:
// "Fee is 2% of gross. Payout is gross minus fee. EACH LUCKY NUMBER PAYS ITS
// OWN FEE" — a $2,000/week member at a $1,000 unit holds two numbers and takes
// two payouts of $20,000 gross / $400 fee / $19,600 net, not one $40,000 payout
// with a single $800 fee.
//
// So this sums per number too, through the same `calculatePayout`. It is not a
// convenience: at 2% the two roads happen to meet, but a fee percent that does
// not divide evenly rounds PER PAYOUT, and a total-first calculation drifts
// from the portal by a cent or two. The organizer quoting one figure on the
// phone and the member reading another on their portal is the whole failure
// this guards against.
//
// PREVIEW ONLY. Nothing here writes. It returns null for anything that cannot
// describe a contribution, so a half-typed form shows nothing rather than a
// wrong number — the same rule `cycleFeeProjection` follows.

import { MAX_LUCKY_NUMBERS_PER_MEMBER, MAX_MONEY_CENTS, splitIntoLuckyNumbers } from "./money";
import { calculatePayout } from "./wheel";

/** One lucky number the contribution produces, and what it is worth. */
export type FeePreviewNumber = {
  /** Cents this number carries each week. */
  amount: number;
  gross: number;
  fee: number;
  net: number;
};

export type FeePreview = {
  weeklyAmount: number;
  weeksCommitted: number;
  /** The numbers this amount splits into — each its own payout, its own fee. */
  numbers: FeePreviewNumber[];
  /** Sums across the numbers. Never computed from the totals directly. */
  gross: number;
  fee: number;
  net: number;
  /** True when the contribution produces more than one number. */
  splits: boolean;
};

/**
 * What this contribution is worth, live. Null when the input cannot describe a
 * contribution — a half-typed amount, a zero, a figure so large it would
 * produce more numbers than a member can hold.
 */
export function feePreview(input: {
  /** Cents per week. */
  weeklyAmount: number;
  weeksCommitted: number;
  /** The cycle's real unit — never hardcoded (2.6). */
  unitAmount: number;
  /** The cycle's real fee percent — never hardcoded (2.6). */
  feePercent: number;
}): FeePreview | null {
  const { weeklyAmount, weeksCommitted, unitAmount, feePercent } = input;
  if (!Number.isSafeInteger(weeklyAmount) || weeklyAmount < 1) return null;
  if (weeklyAmount > MAX_MONEY_CENTS) return null;
  if (!Number.isSafeInteger(weeksCommitted) || weeksCommitted < 1) return null;
  if (!Number.isSafeInteger(unitAmount) || unitAmount < 1) return null;
  if (!Number.isFinite(feePercent) || feePercent < 0 || feePercent > 100) return null;

  // A misconfigured unit (or a typo of $9,999,999) would otherwise throw in the
  // middle of live typing. Showing nothing is the correct answer to a figure
  // that cannot be a contribution.
  let amounts: number[];
  try {
    amounts = splitIntoLuckyNumbers(weeklyAmount, unitAmount);
  } catch {
    return null;
  }
  if (amounts.length > MAX_LUCKY_NUMBERS_PER_MEMBER) return null;

  const numbers = amounts.map((amount, i) => {
    // The SAME arithmetic the draw, the portal and the archive all use. An
    // id is required by the shared signature and is meaningless in a preview.
    const p = calculatePayout({
      luckyNumber: { id: `preview-${i}`, amount },
      participation: { weeksCommitted },
      cycle: { feePercent },
    });
    return { amount, gross: p.gross, fee: p.fee, net: p.net };
  });

  return {
    weeklyAmount,
    weeksCommitted,
    numbers,
    // Summed from the per-number lines, never recomputed from the total —
    // that difference IS the agreement with the portal.
    gross: numbers.reduce((s, n) => s + n.gross, 0),
    fee: numbers.reduce((s, n) => s + n.fee, 0),
    net: numbers.reduce((s, n) => s + n.net, 0),
    splits: numbers.length > 1,
  };
}

/**
 * The sentence the organizer reads aloud, in his own words:
 *
 *   "$750 a week for 20 weeks: they receive $15,000, my fee is $300,
 *    they get $14,700."
 *
 * A sentence rather than a table of labels, because he is on the phone and
 * needs to say it, not decode it. `formatMoney` is injected so the module
 * stays pure and the figures are formatted exactly as everywhere else.
 */
export function feeSentence(
  preview: FeePreview,
  formatMoney: (cents: number) => string,
): string {
  return (
    `${formatMoney(preview.weeklyAmount)} a week for ${preview.weeksCommitted} ` +
    `week${preview.weeksCommitted === 1 ? "" : "s"}: they receive ${formatMoney(preview.gross)}, ` +
    `my fee is ${formatMoney(preview.fee)}, they get ${formatMoney(preview.net)}.`
  );
}

/**
 * The second sentence, only when the amount splits. The organizer needs to know
 * the numbers it produces because that is what appears on the wheel — and each
 * one is a separate payout with its own fee (rule 2).
 */
export function splitSentence(
  preview: FeePreview,
  formatMoney: (cents: number) => string,
): string {
  if (!preview.splits) return "";
  const list = preview.numbers.map((n) => formatMoney(n.amount));
  const last = list[list.length - 1];
  const head = list.slice(0, -1).join(", ");
  return (
    `That splits into ${preview.numbers.length} lucky numbers — ${head} and ${last} — ` +
    `each drawn separately and each paying its own fee.`
  );
}
