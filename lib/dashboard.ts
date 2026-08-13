// Financial Command Center calculators (ground truth 2.1): the complete
// state of the organizer's financial world, every figure DERIVED at read
// time from stored money facts (2.14) — no cached totals, nothing stored.
// Pure functions, cents as integers, window-aware everywhere (2.7).

import {
  amountOutstanding,
  paymentStatus,
  weeksBehind,
  weeksCredited,
  type PaymentStatusValue,
} from "./derived";
import { calculateFinishWeek } from "./money";
import { inWindow as inMemberWindow, type WindowBreak } from "./participation-close";
// The WELCOME half of the gate, asked rather than re-implemented: the
// dashboard row and the portal door must never disagree about who is waiting
// (5.10). `lib/agreement.ts` reaches nothing but node:crypto, so this stays
// clear of lib/client-bundle-safety.test.ts.
import { agreementOutstanding } from "./agreement";

const MS_PER_DAY = 86_400_000;
const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

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

// ————————————————— Cash position OVER TIME (ADMIN_IA §5.2) —————————————————

export type CashPoint = {
  weekNumber: number;
  /** Money received FOR this week (cents). */
  received: number;
  /** Money actually handed over on this week's draw (cents). */
  paidOut: number;
  /** Drawn on this week but not yet collected — owed, still in hand. */
  pendingOut: number;
  /** Running received − paidOut through this week: what is held. */
  held: number;
  /**
   * Whether this week's payment window has CLOSED.
   *
   * Everything right of the last elapsed week is drawn outlined rather than
   * filled — the Xero *Actuals | Projected* divider (ADMIN_IA §5.1). Without
   * it the current week always reads as a collapse in the position, which is
   * the false alarm the elapsed-week rule exists to prevent.
   */
  elapsed: boolean;
};

/**
 * The cash position week by week — one running value, and the two movements
 * that produce it.
 *
 * ATTRIBUTED BY WEEK, NOT BY CLOCK TIME. A receipt belongs to the week it
 * pays for and a payout to the week it was drawn on, because that is the only
 * reading the organizer can check against a week row. Attributing by
 * `createdAt` would put a member's catch-up for week 3 into week 9 and make
 * every historic figure disagree with the payments grid.
 *
 * PENDING PAYOUTS DO NOT REDUCE `held`. The cash has not left. It is carried
 * separately so the chart can show it as committed-but-present, matching
 * `cashPosition().committedPending` above — the two must never disagree.
 */
export function cashSeries(input: {
  weeks: readonly { weekNumber: number }[];
  payments: readonly { weekNumber: number; amountPaid: number }[];
  payouts: readonly {
    weekNumber: number | null;
    netAmount: number;
    status: "PENDING" | "COLLECTED";
  }[];
  /** From `elapsedThroughWeek` — the last week whose window has closed. */
  elapsedThroughWeek: number;
}): CashPoint[] {
  const receivedBy = new Map<number, number>();
  for (const [i, p] of input.payments.entries()) {
    assertCents(`payments[${i}].amountPaid`, p.amountPaid);
    receivedBy.set(p.weekNumber, (receivedBy.get(p.weekNumber) ?? 0) + p.amountPaid);
  }

  const paidBy = new Map<number, number>();
  const pendingBy = new Map<number, number>();
  for (const [i, p] of input.payouts.entries()) {
    assertCents(`payouts[${i}].netAmount`, p.netAmount);
    // A payout with no draw is not on the timeline yet — it is still real
    // money and `cashPosition` counts it, so it is deliberately NOT dropped:
    // it is folded into the first week so the two never disagree on a total.
    const week = p.weekNumber ?? input.weeks[0]?.weekNumber ?? 1;
    const target = p.status === "COLLECTED" ? paidBy : pendingBy;
    target.set(week, (target.get(week) ?? 0) + p.netAmount);
  }

  let running = 0;
  return [...input.weeks]
    .sort((a, b) => a.weekNumber - b.weekNumber)
    .map((w) => {
      const received = receivedBy.get(w.weekNumber) ?? 0;
      const paidOut = paidBy.get(w.weekNumber) ?? 0;
      running += received - paidOut;
      return {
        weekNumber: w.weekNumber,
        received,
        paidOut,
        pendingOut: pendingBy.get(w.weekNumber) ?? 0,
        held: running,
        elapsed: w.weekNumber <= input.elapsedThroughWeek,
      };
    });
}

// ————————————————— Per-week receipts —————————————————

export type DashboardParticipation = {
  id: string;
  /** Cents. */
  weeklyAmount: number;
  startWeek: number;
  weeksCommitted: number;
  /**
   * Stretches of weeks they were NOT part of the cycle (2.18) — they stopped,
   * and possibly came back. Every figure derived below (expected,
   * membersExpected, behind, outstanding) skips these weeks without any screen
   * knowing that closing exists.
   *
   * Optional so existing callers compile unchanged, and absent reads the same
   * as "never stopped". A stopped member whose rows are passed WITHOUT this
   * field goes on being counted, which is exactly the bug this exists to fix —
   * `lib/participation-close.test.ts` pins it.
   */
  breaks?: readonly WindowBreak[];
};

export type DashboardPayment = {
  participationId: string;
  weekNumber: number;
  amountPaid: number;
  /** THIS member is not chased for it — the money is still owed. */
  isDeferred: boolean;
  /** Cycle-wide: the week did not happen, so nobody owes it. */
  isSkipped: boolean;
  /**
   * The ORGANIZER marked this week late himself, before its window closed
   * (2.2). It makes the week count as due NOW, exactly as a closed window
   * does — the command centre must not tell him a member is fine on a week he
   * personally marked late an hour ago.
   */
  markedLate: boolean;
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
  /**
   * This week's payment window has CLOSED.
   *
   * Stamped here rather than re-derived per chart. Both the §5.1 bars and the
   * §5.2 area draw an elapsed/still-open divider, and two copies of that rule
   * is two chances for one screen to call a week closed while the other calls
   * it open — the exact class of drift this audit spent a week closing.
   */
  elapsed: boolean;
};

export function weekReceipts(input: {
  weekNumber: number;
  /** Set for cycle-wide skipped weeks: nothing is expected. */
  isSkipped?: boolean;
  participations: readonly DashboardParticipation[];
  payments: readonly DashboardPayment[];
  // No `elapsed` here on purpose: whether a week has closed is a fact about
  // the CALENDAR, not about this week's money, and it needs the cycle's stored
  // week dates that this function is never given. `receiptsByWeek` stamps it.
}): Omit<WeekReceipts, "elapsed"> {
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
    // Weeks they were AWAY are not theirs (2.18). A member who stopped at
    // week 12 owes nothing for week 13, so week 13 must not expect it.
    const inWindow = inMemberWindow(participation, weekNumber);
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
  /** From `elapsedThroughWeek` — the last week whose window has closed. */
  elapsedThroughWeek: number;
}): WeekReceipts[] {
  return [...input.weeks]
    .sort((a, b) => a.weekNumber - b.weekNumber)
    .map((w) => ({
      ...weekReceipts({
        weekNumber: w.weekNumber,
        isSkipped: w.isSkipped,
        participations: input.participations,
        payments: input.payments,
      }),
      elapsed: w.weekNumber <= input.elapsedThroughWeek,
    }));
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
  status: PaymentStatusValue;
  /** True when the organizer marked it himself (2.2) — a NOTE, not a status. */
  markedLate: boolean;
};

/**
 * Who has paid this week and who has not — in-window members only (2.7).
 *
 * IT ASKS `paymentStatus`. It used to re-implement the ladder, and the copy
 * drifted from the original in the way a second copy always eventually does.
 *
 * THE DEFECT, from live use. Week 12's window closed on 7 August. On 13 August
 * /admin/this-week showed "Marked late 0 — Nobody" and put all seven unpaid
 * members under "Have not paid" — the label for a week still OPEN. They were
 * LATE, and `paymentStatus` had been returning LATE for those rows the whole
 * time; this function was not asking it. The hand-written ladder here had no
 * date and no clock at all, so the ONLY route to LATE it could see was the
 * organizer's manual mark.
 *
 * The comment that stood here made the assumption explicit and wrong — "this
 * list is about the CURRENT week, whose window has not closed". It is not:
 * /admin/this-week has a week SELECTOR offering every week the cycle has, so
 * this renders past weeks routinely. A screen that groups by status must
 * therefore be told the week's own DATE and the day it is being read on.
 *
 * The mark is ONE ROUTE TO LATE, never a category beside it. It rides along as
 * `markedLate` so a screen can note how a week became late, and the status
 * says only that it IS.
 */
export function weekMemberStatus(input: {
  weekNumber: number;
  /**
   * The week's own stored date (rule 7). Without it a closed window is
   * invisible here, which is precisely how seven late members were filed as
   * "have not paid".
   */
  weekDate: Date;
  today: Date;
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
    const inWindow = inMemberWindow(participation, input.weekNumber);
    if (!inWindow) continue;
    const payment = paymentFor.get(participation.id);
    const amountPaid = payment?.amountPaid ?? 0;
    rows.push({
      participationId: participation.id,
      name: participation.name,
      weeklyAmount: participation.weeklyAmount,
      amountPaid,
      // THE ONE ENGINE (2.19). Not a ladder that looks like it.
      status: paymentStatus({
        amountPaid,
        amountDue: participation.weeklyAmount,
        isDeferred: payment?.isDeferred ?? false,
        isSkipped: input.isSkipped ?? false,
        markedLate: payment?.markedLate ?? false,
        weekDate: input.weekDate,
        today: input.today,
      }),
      markedLate: payment?.markedLate ?? false,
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
 * SOMEONE WHO NEEDS AN ACTION THAT IS NOT ABOUT MONEY BEING LATE.
 *
 * Kept apart from {@link AttentionMember} for the same reason `stopped` is:
 * the list is read to decide what to DO, and "chase them for $1,500" and "they
 * have never started" are not the same job. Folding them together would put a
 * member who owes nothing yet in a row that says how much they owe.
 */
export type StandingIssue = {
  personId: string;
  participationId: string;
  name: string;
  kind:
    /** Welcomed, and the portal is shut until they sign. Waiting on THEM. */
    | "unsigned"
    /**
     * No money has ever been received against this participation. Waiting on
     * the organizer, and it is genuinely ambiguous which way: either they have
     * not paid, or they paid and it was never recorded. The row says the fact
     * and leaves the judgement (2.2).
     */
    | "never-paid";
  /** Committed weeks × weekly amount — what "not started" is worth, in cents. */
  commitment: number;
  /** How long they have been in this state, in whole days. Null when unknown. */
  daysWaiting: number | null;
};

/**
 * Members who need an action that the money columns cannot show.
 *
 * WHY THIS IS NOT PART OF `memberAttention`. That function answers one
 * question — who is behind, and by how much — from payments alone, and it
 * drops anyone whose behind-count is zero. Both states here are invisible to
 * it by construction:
 *
 *   a welcomed member who has not signed may be perfectly up to date;
 *   a member who has paid NOTHING is not "behind" until a week of theirs has
 *   closed its window, so a new joiner sits at zero-behind, zero-owed, and
 *   falls off every list on the dashboard while doing nothing at all.
 *
 * The second one is the reason this exists. A member committed to ten weeks at
 * $1,000 who has never paid appeared on no screen the organizer opens.
 */
export function standingIssues(input: {
  participations: readonly {
    id: string;
    personId: string;
    name: string;
    weeklyAmount: number;
    weeksCommitted: number;
    status: "ACTIVE" | "CLOSED";
    /** Set by the welcome send; null means never welcomed. */
    agreementRequiredAt: Date | null;
    lastSignedAt: Date | null;
    /** Cents received against this participation, ever. */
    totalPaid: number;
    /** When they joined the cycle — what `daysWaiting` counts from. */
    joinedAt: Date | null;
  }[];
  today: Date;
}): StandingIssue[] {
  const issues: StandingIssue[] = [];
  for (const p of input.participations) {
    // A STOPPED PARTICIPATION IS NOT AN OUTSTANDING ACTION. They are reported
    // in `stopped`, which says what stopping cost — and neither "sign this"
    // nor "chase the first payment" is a thing to do about someone who has
    // left. The gate makes the same exclusion for the same reason.
    if (p.status !== "ACTIVE") continue;

    const days = (from: Date) =>
      Math.max(0, Math.floor((utcDay(input.today) - utcDay(from)) / MS_PER_DAY));

    // ORDER MATTERS, AND IT IS THE GATE'S ORDER. A member who was welcomed and
    // has not signed is reported as unsigned even when they have also never
    // paid: he asked them personally, and that is the request he is waiting on.
    if (
      agreementOutstanding({ requiredAt: p.agreementRequiredAt, lastSignedAt: p.lastSignedAt })
    ) {
      issues.push({
        personId: p.personId,
        participationId: p.id,
        name: p.name,
        kind: "unsigned",
        commitment: p.weeklyAmount * p.weeksCommitted,
        daysWaiting: p.agreementRequiredAt ? days(p.agreementRequiredAt) : null,
      });
      continue;
    }
    if (p.totalPaid === 0) {
      issues.push({
        personId: p.personId,
        participationId: p.id,
        name: p.name,
        kind: "never-paid",
        commitment: p.weeklyAmount * p.weeksCommitted,
        daysWaiting: p.joinedAt ? days(p.joinedAt) : null,
      });
    }
  }
  // Biggest commitment first: what is at stake is the reason to act, and it is
  // the only figure both kinds share.
  return issues.sort((a, b) => b.commitment - a.commitment || a.name.localeCompare(b.name));
}

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
    // A member who has STOPPED is not "behind": the money is not late, it is
    // not coming. They leave this list entirely and are reported separately —
    // conflating the two is the whole problem this feature exists to fix.
    // An OPEN break is what "stopped" means; a closed one is a member who
    // came back, and they can be behind like anybody else.
    if ((participation.breaks ?? []).some((b) => b.toWeek === null)) continue;
    const finishWeek = calculateFinishWeek(participation.startWeek, participation.weeksCommitted);

    // WHICH WEEKS COUNT AS DUE NOW — the calendar's, plus the organizer's own.
    //
    // This used to be a plain range `startWeek … elapsedThroughWeek`, which is
    // right while the calendar is the only route to LATE. It stopped being the
    // whole answer when the organizer gained a mark of his own (2.2): a week
    // he marked late this morning is due, whatever the cycle clock says, and
    // this list's own promise is that it "cannot disagree with computeStanding
    // or with the LATE markers beside it". A set, because a marked week may
    // fall inside the range as well as beyond it and must not be counted twice.
    const dueWeeks = new Set<number>();
    for (
      let n = participation.startWeek;
      n <= Math.min(input.elapsedThroughWeek, finishWeek);
      n++
    ) {
      dueWeeks.add(n);
    }
    for (const r of rows) {
      // DEFERRAL BEATS THE MARK (ruling, Aug 2026) — the same test
      // `weekCountsAsDue` makes, kept identical here so the attention list and
      // computeStanding cannot disagree about who is behind.
      if (r.markedLate && r.isDeferred) continue;
      if (r.markedLate && r.weekNumber >= participation.startWeek && r.weekNumber <= finishWeek) {
        dueWeeks.add(r.weekNumber);
      }
    }

    const elapsedCount = dueWeeks.size;
    const totalPaid = rows.reduce((sum, r) => sum + r.amountPaid, 0);
    const credited = weeksCredited(totalPaid, participation.weeklyAmount);
    const elapsedRows = rows.filter((r) => dueWeeks.has(r.weekNumber));
    const skippedCount = elapsedRows.filter((r) => r.isSkipped).length;
    const behind = weeksBehind(elapsedCount, credited, skippedCount);
    if (behind === 0) continue;

    // Owed now: netted over the due weeks (2.14 — money is fungible). Weeks
    // without a stored row still owe their weekly amount.
    const rowsByWeek = new Map(elapsedRows.map((r) => [r.weekNumber, r]));
    const elapsedWindow = [];
    for (const n of [...dueWeeks].sort((a, b) => a - b)) {
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
