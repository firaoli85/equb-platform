import { calculateFee } from "./money";

// REMOVING SOMEONE FROM A CYCLE (2.23) — what is attached, and what each
// choice actually does.
//
// The old `removeParticipation` was a bare cascade delete with no preview and
// no guards. A dependency map of the schema found that deleting one row
// reaches, transitively: every LuckyNumber, every Payout, every SlotMember,
// every WinnerPlanNumber, every Payment, every PaymentEvent and every
// PaymentAllocation — while leaving four things ORPHANED:
//
//   1. THE DRAW survives with an empty slot. Draw has no FK to Participation,
//      so nothing deletes it, but its slot members are cascaded away. The week
//      stays permanently marked drawn (@@unique([weekId])) and can never be
//      redrawn.
//   2. THE SLOT survives with zero members, permanently occupying its
//      @@unique([cycleId, position]) seat — saveSlots deliberately refuses to
//      delete a slot that has a Draw, so the wheel UI can never clean it up.
//   3. THE WINNER PLAN survives with ZERO numbers. This is the worst one:
//      selectWinningSlot matches a plan with `.every()`, and `[].every(...)`
//      is VACUOUSLY TRUE — so an emptied plan matches the FIRST eligible slot
//      and silently rigs the next draw, audited as an intentional "planned"
//      win rather than a spin.
//   4. THE PAYOUT is deleted with no settlement reversal and no audit entry of
//      its own, so money that actually left the group vanishes from the books.
//
// And a fifth, quieter consequence: removing a member who COLLECTED a payout
// lowers totalReceived AND totalPaidOut, so `currentlyHeld` goes UP. The books
// then claim the group holds more cash than it does.
//
// Everything here exists so the organizer sees those effects as figures before
// choosing, and so the destructive path cleans up after itself.

export type ParticipationAttachments = {
  personName: string;
  cycleName: string;
  weeklyAmount: number;
  weeksCommitted: number;
  /** Receipts: real money they handed over. */
  receiptCount: number;
  receiptTotal: number;
  /** Week rows carrying money. */
  weeksWithMoney: number;
  /** Their lucky numbers, and whether each has been drawn. */
  numbers: { number: number; drawn: boolean }[];
  /** Their payouts, if drawn. */
  payouts: {
    number: number;
    net: number;
    status: "PENDING" | "COLLECTED";
    /** Their own-week contribution settled from this payout. */
    settlement: number;
  }[];
  /** Draws that would be left with NO winners at all if this member goes. */
  drawsLeftEmpty: { weekNumber: number }[];
  /** Winner plans that would be left with NO numbers — the vacuous-every trap. */
  plansLeftEmpty: { weekNumber: number | null }[];
  /** The cycle's fee percent, for the attributable-fee figure. */
  feePercent: number;
};

export type RemovalChoice = "remove-completely" | "keep-money-records";

export type RemovalConsequences = {
  choice: RemovalChoice;
  /** What disappears, in plain sentences with real figures. */
  lines: string[];
  /** Cash actually received by the group that this choice erases. */
  receivedErased: number;
  /** Money recorded as paid out that this choice erases. */
  paidOutErased: number;
  /**
   * The change to `currentlyHeld` (received − paid out). POSITIVE means the
   * books will claim the group holds MORE than before — which is the
   * counter-intuitive result of removing someone who already collected.
   */
  cashPositionDelta: number;
  /** Numbers going back on the wheel. */
  numbersReturning: number[];
  /** Numbers that cease to exist entirely (their row is deleted). */
  numbersDestroyed: number[];
  /** Cleanup this choice MUST perform, or it leaves the orphans above. */
  cleanup: string[];
};

/** The fee attributable to this member — 2% of what their payouts grossed. */
export function feeAttributable(a: ParticipationAttachments): number {
  const gross = a.numbers.length * a.weeklyAmount * a.weeksCommitted;
  return calculateFee(Math.max(0, gross), a.feePercent);
}

/**
 * REMOVE COMPLETELY — as if they were never in this cycle.
 *
 * Everything of theirs goes, their numbers return to the wheel, and the
 * cleanup list names every orphan that must be swept with it.
 */
function removeCompletely(a: ParticipationAttachments): RemovalConsequences {
  const paidOut = a.payouts.reduce((s, p) => s + p.net, 0);
  const lines: string[] = [];

  lines.push(
    a.receiptCount > 0
      ? `${a.receiptCount} receipt${a.receiptCount === 1 ? "" : "s"} totalling ${money(a.receiptTotal)} are deleted, across ${a.weeksWithMoney} week${a.weeksWithMoney === 1 ? "" : "s"}.`
      : "They have no receipts — no money of theirs is deleted.",
  );

  if (a.payouts.length > 0) {
    const collected = a.payouts.filter((p) => p.status === "COLLECTED");
    lines.push(
      `${a.payouts.length} payout${a.payouts.length === 1 ? "" : "s"} totalling ${money(paidOut)} ${a.payouts.length === 1 ? "is" : "are"} removed` +
        (collected.length > 0
          ? ` — including ${money(collected.reduce((s, p) => s + p.net, 0))} already handed over.`
          : "."),
    );
    const settled = a.payouts.reduce((s, p) => s + p.settlement, 0);
    if (settled > 0) {
      lines.push(
        `Their ${money(settled)} of own-week contribution settled from those payouts is reversed first.`,
      );
    }
  }

  const drawn = a.numbers.filter((n) => n.drawn).map((n) => n.number);
  if (drawn.length > 0) {
    lines.push(
      `${drawn.map((n) => `#${n}`).join(", ")} ${drawn.length === 1 ? "returns" : "return"} to the wheel pool.`,
    );
  }
  lines.push(`Fee attributable to them, ${money(feeAttributable(a))}, comes out of the cycle total.`);

  const cleanup: string[] = [];
  for (const d of a.drawsLeftEmpty) {
    cleanup.push(
      `Week ${d.weekNumber}'s draw is undone — it would otherwise survive as a win belonging to nobody, permanently blocking that week.`,
    );
  }
  for (const p of a.plansLeftEmpty) {
    cleanup.push(
      `The winner plan for ${p.weekNumber === null ? "an unassigned week" : `week ${p.weekNumber}`} is deleted — an empty plan silently matches the first eligible slot and would rig the next draw.`,
    );
  }

  return {
    choice: "remove-completely",
    lines,
    receivedErased: a.receiptTotal,
    paidOutErased: paidOut,
    // received falls AND paid-out falls; the net is what `currentlyHeld` moves by.
    cashPositionDelta: paidOut - a.receiptTotal,
    numbersReturning: drawn,
    numbersDestroyed: a.numbers.map((n) => n.number),
    cleanup,
  };
}

/**
 * KEEP THE MONEY RECORDS — they participated, and the history stands.
 *
 * This CANNOT be a delete: the participation row is the parent of every
 * receipt, week row and lucky number, so deleting it takes the money with it
 * whatever the intent. It is a status change to CLOSED, which every ACTIVE
 * filter in the platform already respects.
 */
function keepMoneyRecords(a: ParticipationAttachments): RemovalConsequences {
  const lines: string[] = [
    `They stop being an active member of ${a.cycleName} — they drop out of the roster, the grid, the wheel pool and the chasing messages.`,
    a.receiptCount > 0
      ? `Their ${a.receiptCount} receipt${a.receiptCount === 1 ? "" : "s"} totalling ${money(a.receiptTotal)} STAY in the books.`
      : "They have no receipts to keep.",
  ];
  if (a.payouts.length > 0) {
    lines.push(
      `Their ${a.payouts.length} payout${a.payouts.length === 1 ? "" : "s"} totalling ${money(a.payouts.reduce((s, p) => s + p.net, 0))} STAY in the books, and the week${a.payouts.length === 1 ? "" : "s"} they won ${a.payouts.length === 1 ? "stays" : "stay"} drawn.`,
    );
  }
  const drawn = a.numbers.filter((n) => n.drawn);
  const undrawn = a.numbers.filter((n) => !n.drawn);
  if (undrawn.length > 0) {
    lines.push(
      `${undrawn.map((n) => `#${n.number}`).join(", ")} leave${undrawn.length === 1 ? "s" : ""} the wheel pool — their window is closed, so ${undrawn.length === 1 ? "it" : "they"} can no longer be drawn (2.27).`,
    );
  }
  if (drawn.length > 0) {
    lines.push(`${drawn.map((n) => `#${n.number}`).join(", ")} stay drawn — those weeks are unchanged.`);
  }
  lines.push("The cash position does not move: nothing is deleted.");

  return {
    choice: "keep-money-records",
    lines,
    receivedErased: 0,
    paidOutErased: 0,
    cashPositionDelta: 0,
    numbersReturning: [],
    numbersDestroyed: [],
    cleanup: [],
  };
}

export function removalConsequences(
  a: ParticipationAttachments,
  choice: RemovalChoice,
): RemovalConsequences {
  return choice === "remove-completely" ? removeCompletely(a) : keepMoneyRecords(a);
}

/**
 * Why a removal cannot proceed, or null.
 *
 * Deliberately short: 2.23 says the organizer can correct anything, so this
 * refuses only what would corrupt the books rather than what merely looks
 * drastic. A closed cycle's figures are frozen (audit H5).
 */
export function removalRefusal(input: {
  cycleStatus: string;
  choice: RemovalChoice;
  alreadyClosed: boolean;
}): string | null {
  if (input.cycleStatus === "CLOSED") {
    return "This cycle is closed — its books are frozen and nobody can be removed from it.";
  }
  if (input.alreadyClosed && input.choice === "keep-money-records") {
    return "They are already closed in this cycle — there is nothing to remove.";
  }
  return null;
}

/** Cents to a plain "$1,234" — kept local so the module stays pure. */
function money(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}
