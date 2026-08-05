// Live cycle projections (2.1: numbers are easier to judge than percentages).
// Pure functions over the current participants — every figure derived,
// nothing stored (2.14). Cents as integers.

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
