// A NUMBER ALREADY IN USE IS A CHOICE, NOT A DEAD END.
//
// "Number 22 is already taken in this cycle" is true and useless: it does not
// say who has it, and it leaves the organizer with nothing to do but guess
// another number. Two intentions are possible and only he knows which:
//
//   REPLACE — #22 belongs to THIS member; the current holder is renumbered.
//   KEEP    — #22 stays where it is; this member takes the next free number.
//
// WHY THIS IS A SHARED MODULE. The choice was built on the member profile's
// lucky-number rows and nowhere else, so the SAME conflict in the add-member
// wizard still produced the bare sentence above. A number is assigned from
// three places; the rule has to live in one.
//
// The pure half — who holds it, whether it can be taken, what KEEP would
// assign instead — is in lib/lucky-numbers.ts and is unit-tested there. This
// module is the database half: the queries and the two-step renumber, shared
// by every path that assigns a number.

import { chooseAutoNumbers, type NumberHolder } from "./lucky-numbers";
import type { Prisma } from "./generated/prisma/client";

/** Who holds a number in this cycle right now, or null. */
export async function findNumberHolder(
  tx: Prisma.TransactionClient,
  args: { cycleId: string; number: number; excludeLuckyNumberId?: string },
): Promise<NumberHolder | null> {
  const existing = await tx.luckyNumber.findFirst({
    where: {
      cycleId: args.cycleId,
      number: args.number,
      ...(args.excludeLuckyNumberId ? { id: { not: args.excludeLuckyNumberId } } : {}),
    },
    include: {
      participation: { include: { person: true } },
      slotMembers: { include: { slot: { include: { draws: { select: { id: true } } } } } },
      _count: { select: { payouts: true } },
    },
  });
  if (!existing) return null;
  return {
    luckyNumberId: existing.id,
    number: existing.number,
    participationId: existing.participationId,
    memberName: existing.participation.person.nameEnglishFirst,
    // Drawn-ness is DERIVED from the slot's draw, never stored on the number
    // — the same rule lib/wheel.ts eligibleNumbers relies on.
    drawn: existing.slotMembers.some((m) => m.slot.draws.length > 0),
    payoutCount: existing._count.payouts,
  };
}

/** Every number in use in this cycle — what "free" is measured against. */
export async function takenNumbers(
  tx: Prisma.TransactionClient,
  cycleId: string,
): Promise<Set<number>> {
  const rows = await tx.luckyNumber.findMany({ where: { cycleId }, select: { number: true } });
  return new Set(rows.map((r) => r.number));
}

/**
 * Move the holder off the number so it can be given to someone else, and
 * return where they landed.
 *
 * The two-step park exists because @@unique([cycleId, number]) is checked per
 * statement, not deferred: the holder sits briefly on a number nothing can be
 * using (one above the cycle's highest) before the contested number changes
 * hands. Both updates are inside the caller's serializable transaction, so the
 * parked value is never observable.
 */
export async function renumberHolder(
  tx: Prisma.TransactionClient,
  args: { cycleId: string; holder: NumberHolder; to: number | null },
): Promise<number> {
  const taken = await takenNumbers(tx, args.cycleId);
  const park = Math.max(0, ...taken) + 1;
  await tx.luckyNumber.update({ where: { id: args.holder.luckyNumberId }, data: { number: park } });
  taken.delete(args.holder.number);
  const destination =
    args.to ?? chooseAutoNumbers({ count: 1, taken: new Set([...taken, park]) })[0];
  await tx.luckyNumber.update({
    where: { id: args.holder.luckyNumberId },
    data: { number: destination },
  });
  return destination;
}
