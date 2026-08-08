// THE WINNER ANNOUNCEMENT'S OWN FACTS, DERIVED ONCE.
//
// THE BUG THIS EXISTS FOR. A real member received:
//
//     "Hi Firaoli, your Equb payout for week 12 is —.
//      Your contributions continue to week 20."
//
// {payoutAmount} and {week} are the only two facts in that sentence that do
// not come from standing — they come from `MessageExtras`, and they have to be
// looked up from the DRAW. The batch path did that lookup. The per-member send
// on the member profile called `sendStatement` with no extras at all, so
// `payoutNet` was undefined (rendering the NO_VALUE dash) and `drawnWeek` was
// undefined (so {week} silently fell back to the CURRENT cycle week, which is
// a second wrong fact that happened to look right).
//
// The deeper fault was not the omission. It was that the lookup lived inside
// one caller, so a second caller had no way to get it right short of noticing
// and reimplementing it. One derivation, both callers.
//
// A NOTE ON THE PAYOUT FIGURE. The recorded Payout wins when one exists; the
// projection is the fallback for a member whose draw has not produced a payout
// row yet. The two agree in the ordinary case, and where they differ the
// recorded one is what the member is actually owed (2.14: stored facts win).

import type { Prisma } from "./generated/prisma/client";
import type { MessageExtras } from "./messages";
import { calculatePayout } from "./wheel";

/** The shape of the rows this needs — satisfied by a Prisma include. */
export type DrawnNumberRow = {
  id: string;
  amount: number;
  payouts: readonly { netAmount: number }[];
  participation: {
    id: string;
    weeksCommitted: number;
    cycle: { feePercent: number };
  };
};

/**
 * The extras a WINNER_ANNOUNCEMENT needs, per participation, from one draw.
 *
 * A member can hold several numbers in one slot. The announcement is about the
 * draw, not about each number, so the FIRST is kept rather than summed —
 * summing would state a figure no single payout matches.
 */
export function winnerExtrasFromDraw(input: {
  weekNumber: number;
  numbers: readonly DrawnNumberRow[];
}): Map<string, MessageExtras> {
  const byParticipation = new Map<string, MessageExtras>();
  for (const n of input.numbers) {
    if (byParticipation.has(n.participation.id)) continue;
    const projected = calculatePayout({
      luckyNumber: { id: n.id, amount: n.amount },
      participation: { weeksCommitted: n.participation.weeksCommitted },
      cycle: { feePercent: n.participation.cycle.feePercent },
    });
    byParticipation.set(n.participation.id, {
      drawnWeek: input.weekNumber,
      // The recorded payout is the truth when it exists.
      payoutNet: n.payouts[0]?.netAmount ?? projected.net,
    });
  }
  return byParticipation;
}

/**
 * The Prisma `include` both callers need to satisfy `DrawnNumberRow`.
 *
 * Exported so the two query sites cannot drift into fetching different
 * columns and then differing about what they can derive.
 */
export const DRAWN_NUMBER_INCLUDE = {
  payouts: { select: { netAmount: true } },
  participation: {
    select: { id: true, weeksCommitted: true, cycle: { select: { feePercent: true } } },
  },
} as const;

/**
 * The winner extras for ONE member, or null when they have not been drawn.
 *
 * This is the per-member half of the same rule the batch applies across a
 * cycle. It exists so the member profile's send does not have to reimplement
 * the lookup — reimplementing it is precisely what did not happen, and the
 * result was a delivered message with a dash where the payout belonged.
 *
 * Returns null rather than empty extras when there is no draw: a member with
 * nothing drawn has no winner announcement to send, and the caller's
 * applicability check already says so. Empty extras would look like a valid
 * answer and re-open the hole.
 */
export async function winnerExtrasForParticipation(
  db: Prisma.TransactionClient,
  participationId: string,
): Promise<MessageExtras | null> {
  const drawn = await db.luckyNumber.findFirst({
    where: {
      participationId,
      slotMembers: { some: { slot: { draws: { some: {} } } } },
    },
    select: {
      id: true,
      amount: true,
      ...DRAWN_NUMBER_INCLUDE,
      slotMembers: {
        select: {
          slot: {
            select: { draws: { select: { week: { select: { weekNumber: true } } } } },
          },
        },
      },
    },
  });
  if (!drawn) return null;

  const weekNumber = drawn.slotMembers
    .flatMap((m) => m.slot.draws)
    .map((d) => d.week.weekNumber)
    .find((w) => w !== undefined);
  if (weekNumber === undefined) return null;

  return (
    winnerExtrasFromDraw({ weekNumber, numbers: [drawn] }).get(participationId) ?? null
  );
}
