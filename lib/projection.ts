// Cycle money projections (2.1: numbers are easier to judge than
// percentages). Pure, derived, nothing stored (2.14). Cents as integers.
//
// TWO different questions live here, and conflating them is what produced a
// wrong screen:
//
//   cycleFeeProjection  — what a cycle of length N is WORTH. Structural:
//                         N slots × the unit, before anyone joins. Used when
//                         planning a new cycle.
//   cycleProjection     — what THESE members are actually committed to, and
//                         what each one will be paid. Roster-based, because
//                         the question is about real people's real payouts.
//
// A planning screen must never use the second: a roster is an assumption, and
// presenting an assumption as a projection told the organizer that a longer
// cycle was worth the same as a short one.

import { calculateFee, calculateGross, calculateNet } from "./money";

export type ProjectionMember = {
  id: string;
  name: string;
  /** Cents. */
  weeklyAmount: number;
  weeksCommitted: number;
};

export type MemberProjection = {
  id: string;
  name: string;
  gross: number;
  fee: number;
  net: number;
};

export type CycleProjection = {
  /** Sum of every member's weekly contribution. */
  weeklyPot: number;
  /** The fee on ONE week's pot — the per-week figure the organizer holds in his head. */
  weeklyFee: number;
  /** Sum of every member's gross over their own commitment. */
  totalGross: number;
  /** Sum of per-member fees (fees are charged per member payout). */
  totalFees: number;
  totalNet: number;
  perMember: MemberProjection[];
};

/**
 * THE STRUCTURAL PROJECTION — what a cycle of a given LENGTH is worth, before
 * anybody joins.
 *
 * ORGANIZER'S CORRECTION (Aug 2026). The new-cycle screen used to project
 * from the previous cycle's roster — "if the same 28 members join" — and that
 * misread the domain. An equb's weekly pot is not a sum over whoever turns
 * up: exactly ONE slot pays out per week, so a cycle of N weeks has N slots
 * and collects N × unitAmount every week. Members fill those slots, however
 * many people that takes — two friends can share one, one person can hold
 * three — and the pot does not move either way.
 *
 * The consequence the old code got backwards: choosing MORE weeks does not
 * spread the same money further, it makes the cycle bigger. 20 weeks at
 * $1,000 a unit is $20,000 a week; 30 weeks is $30,000 a week. That is the
 * whole reason the length comparison exists, and the roster version could
 * never show it.
 *
 *   weeklyPot  = plannedWeeks × unitAmount
 *   weeklyFee  = weeklyPot × feePercent
 *   cycleTotal = weeklyPot × plannedWeeks
 *   totalFees  = cycleTotal × feePercent
 *
 * Returns null for inputs that cannot describe a cycle, so a half-typed form
 * shows nothing rather than a wrong number.
 */
export type CycleFeeProjection = {
  /** N slots × the unit — collected every week. */
  weeklyPot: number;
  weeklyFee: number;
  /** The whole cycle: the weekly pot, every week. */
  cycleTotal: number;
  totalFees: number;
  /** True when weeklyPot came from the organizer, not from weeks × unit. */
  overridden: boolean;
};

export function cycleFeeProjection(input: {
  plannedWeeks: number;
  unitAmount: number;
  feePercent: number;
  /**
   * A different weekly pot, when reality differs from the structure — a slot
   * left deliberately empty, or a member paying a non-standard unit. The
   * cycle total still follows from it: pot × weeks.
   */
  weeklyPotOverride?: number | null;
}): CycleFeeProjection | null {
  const { plannedWeeks, unitAmount, feePercent } = input;
  if (!Number.isSafeInteger(plannedWeeks) || plannedWeeks < 1) return null;
  if (!Number.isSafeInteger(unitAmount) || unitAmount < 1) return null;
  if (!Number.isFinite(feePercent) || feePercent < 0) return null;

  const override = input.weeklyPotOverride ?? null;
  if (override !== null && (!Number.isSafeInteger(override) || override < 1)) return null;

  const weeklyPot = override ?? calculateGross(unitAmount, plannedWeeks);
  const cycleTotal = calculateGross(weeklyPot, plannedWeeks);

  return {
    weeklyPot,
    weeklyFee: calculateFee(weeklyPot, feePercent),
    cycleTotal,
    // Charged on the whole cycle. Deliberately NOT weeklyFee × weeks: each is
    // rounded to the cent, so multiplying the rounded weekly figure drifts
    // from the true total on any fee that does not divide evenly.
    totalFees: calculateFee(cycleTotal, feePercent),
    overridden: override !== null,
  };
}

export function cycleProjection(input: {
  members: readonly ProjectionMember[];
  feePercent: number;
}): CycleProjection {
  const perMember = input.members.map((m) => {
    const gross = calculateGross(m.weeklyAmount, m.weeksCommitted);
    const fee = calculateFee(gross, input.feePercent);
    return { id: m.id, name: m.name, gross, fee, net: calculateNet(gross, fee) };
  });
  const weeklyPot = input.members.reduce((sum, m) => sum + m.weeklyAmount, 0);
  return {
    weeklyPot,
    weeklyFee: calculateFee(weeklyPot, input.feePercent),
    totalGross: perMember.reduce((sum, m) => sum + m.gross, 0),
    totalFees: perMember.reduce((sum, m) => sum + m.fee, 0),
    totalNet: perMember.reduce((sum, m) => sum + m.net, 0),
    perMember,
  };
}
