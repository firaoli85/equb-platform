// Closing a cycle — pure, unit-tested law (2.24). No database, no I/O.
//
//   2.9  — clean delete AFTER a readable archive; the archive keeps the story.
//   2.18 — anyone short at close gets a LEDGER entry on the PERSON, with the
//          origin written out ("Cycle 1, 2026 — 8 weeks unpaid, $2,000").
//   2.21 — a factual closing statement for every member, no pressure.
//   2.27 — closing is BLOCKED while someone paid in and was never drawn,
//          unless the organizer explicitly acknowledges it with a reason.

import { formatMoney } from "./format";

export type MemberFinal = {
  participationId: string;
  personId: string;
  name: string;
  nameAmharic: string;
  weeklyAmount: number;
  weeksCommitted: number;
  /** Weeks fully covered by their money (derived, capped at committed). */
  weeksPaid: number;
  /** Cents still owed at close (derived standing). */
  outstanding: number;
  lastPaymentWeek: number | null;
  /** Their draw, if any of their numbers ever won. */
  drawnWeek: number | null;
  /**
   * Net ACTUALLY HANDED OVER — COLLECTED payouts only.
   *
   * This summed every payout regardless of status, and the archive built its
   * paidOutNet from it. A payout recorded but not yet handed over therefore
   * inflated "paid out" and understated "still held" by the same figure, in a
   * record that is rendered verbatim and never recomputed — while the same
   * archive page printed that payout's own row as "pending". The document
   * contradicted itself on one screen.
   */
  receivedNet: number;
  /**
   * Net AWARDED across every payout, collected or not. Kept separate so the
   * archive can state what was still outstanding at the moment of closing
   * rather than silently folding it into money that had gone out.
   */
  awardedNet: number;
  /** Awarded but not yet handed over at close. Always awardedNet - receivedNet. */
  pendingNet: number;
  /** Win-week contributions settled from their payouts. */
  settledFromPayout: number;
  totalPaid: number;
};

// ————————————————— Frozen cycles (audit H5) —————————————————

/**
 * A CLOSED cycle's weeks are FINAL: closing already wrote every member's
 * shortfall onto their carried ledger (2.18), so new money landing on a week
 * afterwards would silently change their standing while the ledger debt
 * stayed as it was — two numbers for the same debt.
 *
 * 2.19 defines the correct path instead: "after the cycle closes, money
 * recorded on the profile reduces the LEDGER BALANCE." Returns the refusal
 * to show, or null when the cycle still accepts week-level money.
 */
export function frozenCycleRefusal(cycle: {
  name: string;
  status: "DRAFT" | "ACTIVE" | "CLOSED";
}): string | null {
  if (cycle.status !== "CLOSED") return null;
  return (
    `${cycle.name} is closed — its weeks are final and every remaining balance is already ` +
    `on the members' carried ledgers (2.18). Record this money against their ledger balance ` +
    `on the member's page instead (2.19); it cannot be added to a closed week.`
  );
}

// ————————————————— Blockers (2.27) —————————————————

export type UndrawnMember = { name: string; numbers: number[] };

export type CloseBlockCheck = {
  blocked: boolean;
  reasons: string[];
};

/**
 * Closing is blocked while anyone is undrawn — they paid in and received
 * nothing. An explicit organizer acknowledgement (with a real reason)
 * overrides it; pending payouts and open weeks are shown but never block.
 */
export function closeBlockers(input: {
  undrawn: readonly UndrawnMember[];
  acknowledgeReason?: string | null;
}): CloseBlockCheck {
  const reasons: string[] = [];
  const reason = input.acknowledgeReason?.trim() ?? "";
  if (input.undrawn.length > 0 && reason.length === 0) {
    reasons.push(
      `${input.undrawn.length} member${input.undrawn.length === 1 ? " has" : "s have"} paid in and never been drawn: ` +
        input.undrawn
          .map((m) => `${m.name} (${m.numbers.map((n) => `#${n}`).join(", ")})`)
          .join("; ") +
        ". Resolve this on the wheel, or acknowledge it with a reason to close anyway.",
    );
  }
  return { blocked: reasons.length > 0, reasons };
}

// ————————————————— Final balances (2.18) —————————————————

export type CloseLedgerEntry = {
  personId: string;
  amount: number;
  description: string;
};

/**
 * The DEBT entries closing writes: one per member still short, on the
 * PERSON, with the origin story written out. Fully-paid members get nothing.
 */
export function finalBalanceEntries(
  members: readonly MemberFinal[],
  cycleName: string,
): CloseLedgerEntry[] {
  return members
    .filter((m) => m.outstanding > 0)
    .map((m) => ({
      personId: m.personId,
      amount: m.outstanding,
      description:
        `${cycleName} closed — paid ${m.weeksPaid} of ${m.weeksCommitted} weeks` +
        `${m.lastPaymentWeek !== null ? ` (last payment week ${m.lastPaymentWeek})` : ""}, ` +
        `${formatMoney(m.outstanding)} unpaid`,
    }));
}

// ————————————————— Closing statements (2.21) —————————————————

/** Factual and calm — the exact register of the law's examples. */
export function closingStatementText(m: {
  weeksPaid: number;
  weeksCommitted: number;
  outstanding: number;
  lastPaymentWeek: number | null;
}): string {
  if (m.outstanding === 0 && m.weeksPaid >= m.weeksCommitted) {
    return `You completed all ${m.weeksCommitted} weeks. Balance $0.`;
  }
  if (m.outstanding === 0) {
    return `You paid ${m.weeksPaid} of ${m.weeksCommitted}. Balance $0.`;
  }
  return (
    `You paid ${m.weeksPaid} of ${m.weeksCommitted}.` +
    (m.lastPaymentWeek !== null ? ` Last payment week ${m.lastPaymentWeek}.` : "") +
    ` Outstanding ${formatMoney(m.outstanding)}.`
  );
}

// ————————————————— The archive (2.9) —————————————————

export type ArchiveWeek = {
  weekNumber: number;
  date: string;
  isSkipped: boolean;
  received: number;
  /** The draw, if this week had one. */
  draw: {
    numbers: number[];
    winners: string[];
    payouts: { number: number; who: string; net: number; status: string; paidAt: string | null }[];
  } | null;
};

export type ArchiveData = {
  version: 1;
  cycleName: string;
  startDate: string;
  closedAt: string;
  plannedWeeks: number;
  feePercent: number;
  members: (MemberFinal & { statement: string })[];
  weeks: ArchiveWeek[];
  totals: {
    received: number;
    /** COLLECTED payout nets only — money that actually left. */
    paidOutNet: number;
    /** Drawn and awarded, but not handed over when the cycle closed. */
    pendingNet: number;
    stillHeld: number;
    outstanding: number;
    membersShort: number;
  };
};

/** Assemble the archive snapshot — every figure precomputed, none re-derived later. */
export function buildArchiveData(input: {
  cycleName: string;
  startDate: string;
  closedAt: string;
  plannedWeeks: number;
  feePercent: number;
  members: readonly MemberFinal[];
  weeks: readonly ArchiveWeek[];
}): ArchiveData {
  const received = input.weeks.reduce((sum, w) => sum + w.received, 0);
  // COLLECTED only. A pending payout is money the group is STILL HOLDING, not
  // money it has paid out — counting it as paid out is what made the archive
  // disagree with its own payout rows.
  const paidOutNet = input.members.reduce((sum, m) => sum + m.receivedNet, 0);
  const pendingNet = input.members.reduce((sum, m) => sum + m.pendingNet, 0);
  const outstanding = input.members.reduce((sum, m) => sum + m.outstanding, 0);
  return {
    version: 1,
    cycleName: input.cycleName,
    startDate: input.startDate,
    closedAt: input.closedAt,
    plannedWeeks: input.plannedWeeks,
    feePercent: input.feePercent,
    members: input.members.map((m) => ({ ...m, statement: closingStatementText(m) })),
    weeks: [...input.weeks],
    totals: {
      received,
      paidOutNet,
      pendingNet,
      stillHeld: received - paidOutNet,
      outstanding,
      membersShort: input.members.filter((m) => m.outstanding > 0).length,
    },
  };
}

// ————————————————— Clean delete (2.9) —————————————————

export type DeletePlan = {
  removed: string[];
  kept: string[];
};

/** The plain statement of what deleting a closed cycle removes vs keeps. */
export function cycleDeletePlan(counts: {
  participations: number;
  weeks: number;
  receipts: number;
  draws: number;
  payouts: number;
  luckyNumbers: number;
  slots: number;
  plans: number;
}): DeletePlan {
  return {
    removed: [
      `${counts.participations} participation${counts.participations === 1 ? "" : "s"} (this cycle's memberships)`,
      `${counts.weeks} week row${counts.weeks === 1 ? "" : "s"} and every payment marked on them`,
      `${counts.receipts} receipt${counts.receipts === 1 ? "" : "s"} (payment events and their allocations)`,
      `${counts.draws} draw${counts.draws === 1 ? "" : "s"} and ${counts.payouts} payout record${counts.payouts === 1 ? "" : "s"}`,
      `${counts.luckyNumbers} lucky number${counts.luckyNumbers === 1 ? "" : "s"}, ${counts.slots} wheel slot${counts.slots === 1 ? "" : "s"}, ${counts.plans} winner plan${counts.plans === 1 ? "" : "s"}`,
    ],
    kept: [
      "Every PERSON — the directory is permanent (2.5)",
      "Every carried-balance ledger entry, including the ones this close wrote (2.18)",
      "The readable archive of this cycle (2.9)",
      "The audit log and the message log",
    ],
  };
}
