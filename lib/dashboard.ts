// Financial Command Center calculators (ground truth 2.1): the complete
// state of the organizer's financial world, every figure DERIVED at read
// time from stored money facts (2.14) — no cached totals, nothing stored.
// Pure functions, cents as integers, window-aware everywhere (2.7).

import { amountOutstanding, weeksBehind, weeksCredited } from "./derived";
import { calculateFinishWeek } from "./money";

function assertCents(name: string, cents: number): void {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new RangeError(`${name} must be a non-negative integer number of cents, got ${cents}`);
  }
}

// ————————————————— Cash position —————————————————

export type CashPosition = {
  /** All money received to date. */
  totalReceived: number;
  /** Money actually handed over (payouts with status COLLECTED). */
  totalPaidOut: number;
  /** received − paid out: what the group is holding. */
  currentlyHeld: number;
  /** Payouts drawn but still PENDING — money already owed out. */
  committedPending: number;
  /** currentlyHeld − committedPending: truly free money. */
  uncommitted: number;
  pendingPayoutCount: number;
};

export function cashPosition(input: {
  payments: readonly { amountPaid: number }[];
  payouts: readonly { netAmount: number; status: "PENDING" | "COLLECTED" }[];
}): CashPosition {
  let totalReceived = 0;
  for (const [i, p] of input.payments.entries()) {
    assertCents(`payments[${i}].amountPaid`, p.amountPaid);
    totalReceived += p.amountPaid;
  }
  let totalPaidOut = 0;
  let committedPending = 0;
  let pendingPayoutCount = 0;
  for (const [i, p] of input.payouts.entries()) {
    assertCents(`payouts[${i}].netAmount`, p.netAmount);
    if (p.status === "COLLECTED") totalPaidOut += p.netAmount;
    else {
      committedPending += p.netAmount;
      pendingPayoutCount++;
    }
  }
  const currentlyHeld = totalReceived - totalPaidOut;
  return {
    totalReceived,
    totalPaidOut,
    currentlyHeld,
    committedPending,
    uncommitted: currentlyHeld - committedPending,
    pendingPayoutCount,
  };
}

// ————————————————— Per-week receipts —————————————————

export type DashboardParticipation = {
  id: string;
  /** Cents. */
  weeklyAmount: number;
  startWeek: number;
  weeksCommitted: number;
};

export type DashboardPayment = {
  participationId: string;
  weekNumber: number;
  amountPaid: number;
  /** THIS member is not chased for it — the money is still owed. */
  isDeferred: boolean;
  /** Cycle-wide: the week did not happen, so nobody owes it. */
  isSkipped: boolean;
};

export type WeekReceipts = {
  weekNumber: number;
  /** What this week should bring in — window-aware (2.7): only members whose
   *  window covers the week, minus deferred/excused members. */
  expected: number;
  received: number;
  shortfall: number;
  membersPaid: number;
  membersExpected: number;
};

export function weekReceipts(input: {
  weekNumber: number;
  /** Set for cycle-wide skipped weeks: nothing is expected. */
  isSkipped?: boolean;
  participations: readonly DashboardParticipation[];
  payments: readonly DashboardPayment[];
}): WeekReceipts {
  const { weekNumber } = input;
  const paymentFor = new Map(
    input.payments
      .filter((p) => p.weekNumber === weekNumber)
      .map((p) => [p.participationId, p]),
  );

  let expected = 0;
  let received = 0;
  let membersPaid = 0;
  let membersExpected = 0;

  for (const participation of input.participations) {
    const inWindow =
      participation.startWeek <= weekNumber &&
      weekNumber <= calculateFinishWeek(participation.startWeek, participation.weeksCommitted);
    const payment = paymentFor.get(participation.id);
    // Received money always counts, even outside a window (edited data).
    if (payment) {
      assertCents(`week ${weekNumber} amountPaid`, payment.amountPaid);
      received += payment.amountPaid;
    }
    if (!inWindow || input.isSkipped) continue;
    if (payment?.isDeferred) continue;
    assertCents("weeklyAmount", participation.weeklyAmount);
    expected += participation.weeklyAmount;
    membersExpected++;
    if ((payment?.amountPaid ?? 0) >= participation.weeklyAmount) membersPaid++;
  }

  return {
    weekNumber,
    expected,
    received,
    shortfall: Math.max(0, expected - received),
    membersPaid,
    membersExpected,
  };
}

export function receiptsByWeek(input: {
  weeks: readonly { weekNumber: number; isSkipped: boolean }[];
  participations: readonly DashboardParticipation[];
  payments: readonly DashboardPayment[];
}): WeekReceipts[] {
  return [...input.weeks]
    .sort((a, b) => a.weekNumber - b.weekNumber)
    .map((w) =>
      weekReceipts({
        weekNumber: w.weekNumber,
        isSkipped: w.isSkipped,
        participations: input.participations,
        payments: input.payments,
      }),
    );
}

// ————————————————— Drill-downs: no dead figures —————————————————

/** Total received per member, largest first — what "received" is made of. */
export function receivedByMember(input: {
  participations: readonly { id: string; name: string }[];
  payments: readonly { participationId: string; amountPaid: number }[];
}): { participationId: string; name: string; total: number }[] {
  const totals = new Map<string, number>();
  for (const p of input.payments) {
    assertCents("amountPaid", p.amountPaid);
    totals.set(p.participationId, (totals.get(p.participationId) ?? 0) + p.amountPaid);
  }
  return input.participations
    .map((p) => ({ participationId: p.id, name: p.name, total: totals.get(p.id) ?? 0 }))
    .sort((a, b) => b.total - a.total);
}

export type WeekMemberStatus = {
  participationId: string;
  name: string;
  weeklyAmount: number;
  amountPaid: number;
  status: "PAID" | "PARTIAL" | "UNPAID" | "DEFERRED" | "SKIPPED";
};

/**
 * Who has paid this week and who has not — in-window members only (2.7).
 *
 * The order matches paymentStatus (2.14): SKIPPED (nobody owed it), then PAID
 * (the money is there — PAID BEATS DEFERRED), then DEFERRED (still owed, just
 * not chased), then PARTIAL/UNPAID.
 */
export function weekMemberStatus(input: {
  weekNumber: number;
  participations: readonly (DashboardParticipation & { name: string })[];
  payments: readonly DashboardPayment[];
  /** Cycle-wide: this week did not happen, so nobody owes it. */
  isSkipped?: boolean;
}): WeekMemberStatus[] {
  const paymentFor = new Map(
    input.payments
      .filter((p) => p.weekNumber === input.weekNumber)
      .map((p) => [p.participationId, p]),
  );
  const rows: WeekMemberStatus[] = [];
  for (const participation of input.participations) {
    const inWindow =
      participation.startWeek <= input.weekNumber &&
      input.weekNumber <=
        calculateFinishWeek(participation.startWeek, participation.weeksCommitted);
    if (!inWindow) continue;
    const payment = paymentFor.get(participation.id);
    const amountPaid = payment?.amountPaid ?? 0;
    rows.push({
      participationId: participation.id,
      name: participation.name,
      weeklyAmount: participation.weeklyAmount,
      amountPaid,
      status: input.isSkipped
        ? "SKIPPED"
        : amountPaid >= participation.weeklyAmount
          ? "PAID"
          : payment?.isDeferred
            ? "DEFERRED"
            : amountPaid > 0
              ? "PARTIAL"
              : "UNPAID",
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

// ————————————————— The attention list —————————————————

export type AttentionMember = {
  participationId: string;
  name: string;
  weeksBehind: number;
  /** Cents owed across their elapsed window, deferred weeks excluded. */
  amountOwed: number;
};

/**
 * Members behind, worst first (by amount owed, then weeks).
 *
 * Only SKIPPED weeks are excused — a DEFERRED week is still owed (Aug 2026
 * ruling), it simply is not chased. `elapsedThroughWeek` is the last week
 * whose OWN STORED DATE has passed its payment window (2.14), so this list
 * cannot disagree with computeStanding or with the LATE markers beside it.
 */
export function memberAttention(input: {
  participations: readonly (DashboardParticipation & { name: string })[];
  payments: readonly DashboardPayment[];
  /** The last week whose stored date + payment window has passed. */
  elapsedThroughWeek: number;
}): AttentionMember[] {
  const byParticipation = new Map<string, DashboardPayment[]>();
  for (const p of input.payments) {
    const list = byParticipation.get(p.participationId) ?? [];
    list.push(p);
    byParticipation.set(p.participationId, list);
  }

  const result: AttentionMember[] = [];
  for (const participation of input.participations) {
    const rows = byParticipation.get(participation.id) ?? [];
    const finishWeek = calculateFinishWeek(participation.startWeek, participation.weeksCommitted);
    const elapsedCount = Math.min(
      Math.max(0, input.elapsedThroughWeek - participation.startWeek + 1),
      participation.weeksCommitted,
    );
    const totalPaid = rows.reduce((sum, r) => sum + r.amountPaid, 0);
    const credited = weeksCredited(totalPaid, participation.weeklyAmount);
    const elapsedRows = rows.filter(
      (r) =>
        r.weekNumber >= participation.startWeek &&
        r.weekNumber <= Math.min(input.elapsedThroughWeek, finishWeek),
    );
    const skippedCount = elapsedRows.filter((r) => r.isSkipped).length;
    const behind = weeksBehind(elapsedCount, credited, skippedCount);
    if (behind === 0) continue;

    // Owed now: netted over elapsed weeks (2.14 — money is fungible). Weeks
    // without a stored row still owe their weekly amount.
    const rowsByWeek = new Map(elapsedRows.map((r) => [r.weekNumber, r]));
    const elapsedWindow = [];
    for (
      let n = participation.startWeek;
      n <= Math.min(input.elapsedThroughWeek, finishWeek);
      n++
    ) {
      const row = rowsByWeek.get(n);
      elapsedWindow.push({
        amountDue: participation.weeklyAmount,
        amountAlreadyPaid: row?.amountPaid ?? 0,
        isDeferred: row?.isDeferred ?? false,
      });
    }
    const owed = amountOutstanding(elapsedWindow);
    if (owed === 0) continue;

    result.push({
      participationId: participation.id,
      name: participation.name,
      weeksBehind: behind,
      amountOwed: owed,
    });
  }

  return result.sort((a, b) => b.amountOwed - a.amountOwed || b.weeksBehind - a.weeksBehind);
}
