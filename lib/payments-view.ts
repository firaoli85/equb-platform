// Pure helpers for the PAYMENTS interface (money coming IN — in this domain
// "collection" means a winner collecting their payout, never recording
// payments). The allocation engine itself lives in lib/allocation.ts and is
// not touched here (2.19: one engine) — these functions only describe what
// the engine says, prepare its inputs, and build the grid map (2.15: the
// grid is the map, payment entry is the action). Cents as integers.

import { type PaymentStatusValue } from "./derived";
import { formatMoney } from "./format";

export type AllocationLike = {
  weekNumber: number;
  applied: number;
  fillsWeek: boolean;
};

/**
 * Plain English for an allocation preview (2.15: show where the money lands
 * BEFORE committing) — e.g. "Clears weeks 8, 9, 10 · $150 partial on week
 * 10 · $200 unallocated".
 */
export function describeAllocation(input: {
  allocations: readonly AllocationLike[];
  unallocated: number;
}): string {
  const parts: string[] = [];
  const cleared = input.allocations.filter((a) => a.fillsWeek).map((a) => a.weekNumber);
  if (cleared.length === 1) parts.push(`Clears week ${cleared[0]}`);
  else if (cleared.length > 1) parts.push(`Clears weeks ${cleared.join(", ")}`);
  for (const a of input.allocations.filter((a) => !a.fillsWeek)) {
    parts.push(`${formatMoney(a.applied)} partial on week ${a.weekNumber}`);
  }
  if (input.unallocated > 0) parts.push(`${formatMoney(input.unallocated)} unallocated`);
  if (parts.length === 0) {
    return "Nothing would be applied — this member's weeks are already covered.";
  }
  return parts.join(" · ");
}

export type CatchUpWeek = {
  weekNumber: number;
  amountDue: number;
  amountAlreadyPaid: number;
  /** THIS member is not chased for it — the money is still owed. */
  isDeferred: boolean;
  /** Cycle-wide: the week did not happen, so nobody owes it. */
  isSkipped: boolean;
};

/**
 * What a bulk catch-up over the chosen weeks is worth: the shortfall on each
 * selected week. Only SKIPPED weeks are excused — a DEFERRED week is still
 * owed (organizer ruling, Aug 2026), so catching up includes it. The engine
 * still decides WHERE the money lands (oldest debt first); this only sizes
 * the receipt.
 */
export function bulkCatchUpAmount(weeks: readonly CatchUpWeek[]): number {
  let total = 0;
  for (const w of weeks) {
    if (w.isSkipped) continue;
    if (!Number.isSafeInteger(w.amountDue) || !Number.isSafeInteger(w.amountAlreadyPaid)) {
      throw new RangeError(`week ${w.weekNumber} amounts must be integer cents`);
    }
    total += Math.max(0, w.amountDue - w.amountAlreadyPaid);
  }
  return total;
}

/**
 * Oldest-debt-first (2.15) means money can land on weeks EARLIER than the
 * ones the organizer selected. This reports that honestly so the UI can warn
 * before committing rather than surprising him afterwards.
 */
export function allocationOutsideSelection(input: {
  allocations: readonly AllocationLike[];
  selectedWeeks: readonly number[];
}): number[] {
  const selected = new Set(input.selectedWeeks);
  return input.allocations
    .map((a) => a.weekNumber)
    .filter((n) => !selected.has(n))
    .sort((a, b) => a - b);
}

/**
 * Which week the payments board should show: the explicitly requested week
 * if it exists, else the derived current week, else — when the calendar has
 * run past the cycle's last week — the LAST week (never week 1: an ended
 * cycle's working screen is its final week, not its first).
 */
export function resolveTargetWeek(input: {
  requested?: number;
  cycleWeek: number;
  weekNumbers: readonly number[];
}): number {
  const { requested, cycleWeek, weekNumbers } = input;
  if (weekNumbers.length === 0) {
    throw new RangeError("resolveTargetWeek needs at least one week");
  }
  if (requested !== undefined && weekNumbers.includes(requested)) return requested;
  if (weekNumbers.includes(cycleWeek)) return cycleWeek;
  const max = Math.max(...weekNumbers);
  if (cycleWeek > max) return max;
  return Math.min(...weekNumbers);
}

export type RosterMember = {
  participationId: string;
  name: string;
  /** Cents due from this member for this week. */
  amountDue: number;
  amountPaidThisWeek: number;
  isDeferred: boolean;
  weeksBehind: number;
  amountOwed: number;
};

/**
 * The week view's two lists: who still owes money for this week (the action
 * list, worst first) and who is paid. Deferred members are settled — they
 * are excused, never chased.
 */
export function splitWeekRoster(members: readonly RosterMember[]): {
  owing: RosterMember[];
  paid: RosterMember[];
} {
  const owing: RosterMember[] = [];
  const paid: RosterMember[] = [];
  for (const m of members) {
    if (m.isDeferred || m.amountPaidThisWeek >= m.amountDue) paid.push(m);
    else owing.push(m);
  }
  owing.sort(
    (a, b) => b.amountOwed - a.amountOwed || b.weeksBehind - a.weeksBehind || a.name.localeCompare(b.name),
  );
  paid.sort((a, b) => a.name.localeCompare(b.name));
  return { owing, paid };
}

// ————————————————— The grid: the map (2.15) —————————————————

export type GridMemberInput = {
  participationId: string;
  name: string;
  /** e.g. "#2, #22" */
  numbersLabel: string;
  startWeek: number;
  finishWeek: number;
  weeksCredited: number;
  /** Cents owed now (derived). */
  outstanding: number;
  weeks: readonly {
    weekNumber: number;
    /** DERIVED status from computeStanding — never stored. */
    status: PaymentStatusValue;
    storedPaid: number;
    amountDue: number;
  }[];
};

/**
 * A cell outside a member's window is never blank-and-ambiguous: before
 * their start week it explicitly says "not yet joined" (a blank reads as
 * broken or as an accusation); after their finish week it is "finished".
 */
export type GridCell =
  | { kind: "week"; status: PaymentStatusValue; storedPaid: number; amountDue: number }
  | { kind: "before-start" }
  | { kind: "after-finish" };

export type PaymentGrid = {
  columns: {
    participationId: string;
    name: string;
    numbersLabel: string;
    /** Their own window — "joined week 9" is stated, never implied. */
    startWeek: number;
    finishWeek: number;
    weeksCredited: number;
    outstanding: number;
  }[];
  rows: {
    weekNumber: number;
    date: Date;
    isSkipped: boolean;
    cells: GridCell[];
    /** Money recorded on this week's rows (stored receipts placement). */
    received: number;
    /** Window-aware expectation: in-window, non-deferred members only. */
    expected: number;
  }[];
};

/**
 * Assemble the payments grid: rows = weeks, columns = members. Statuses
 * arrive pre-derived from computeStanding, so the grid and the member
 * profile can never disagree.
 */
export function buildPaymentGrid(input: {
  weeks: readonly { weekNumber: number; date: Date; isSkipped: boolean }[];
  members: readonly GridMemberInput[];
}): PaymentGrid {
  const memberWeekMaps = input.members.map(
    (m) => new Map(m.weeks.map((w) => [w.weekNumber, w])),
  );

  const rows = [...input.weeks]
    .sort((a, b) => a.weekNumber - b.weekNumber)
    .map((week) => {
      let received = 0;
      let expected = 0;
      const cells: GridCell[] = input.members.map((member, i) => {
        if (week.weekNumber < member.startWeek) return { kind: "before-start" as const };
        if (week.weekNumber > member.finishWeek) return { kind: "after-finish" as const };
        const mw = memberWeekMaps[i].get(week.weekNumber);
        // No row data (pre-D-31 gap): the calendar has outrun their rows.
        if (!mw) return { kind: "after-finish" as const };
        received += mw.storedPaid;
        // Only a SKIPPED week is off the books. A DEFERRED week is still
        // owed, so it belongs in what the week EXPECTED to collect.
        if (!week.isSkipped && mw.status !== "SKIPPED") expected += mw.amountDue;
        return {
          kind: "week" as const,
          status: mw.status,
          storedPaid: mw.storedPaid,
          amountDue: mw.amountDue,
        };
      });
      return {
        weekNumber: week.weekNumber,
        date: week.date,
        isSkipped: week.isSkipped,
        cells,
        received,
        expected,
      };
    });

  return {
    columns: input.members.map((m) => ({
      participationId: m.participationId,
      name: m.name,
      numbersLabel: m.numbersLabel,
      startWeek: m.startWeek,
      finishWeek: m.finishWeek,
      weeksCredited: m.weeksCredited,
      outstanding: m.outstanding,
    })),
    rows,
  };
}
