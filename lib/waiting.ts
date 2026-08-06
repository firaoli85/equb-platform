// WHO IS WAITING — the money the group owes its members (2.1: this is a
// financial platform, so an obligation is a first-class thing, not a figure
// buried in a table). Pure grouping and sorting; the action layer supplies
// rows and gets ordered lists back, so every rule here is tested law.
//
// TWO groups, and they mean different things:
//
//   AWAITING PAYMENT   — drawn, payout PENDING. The organizer owes this money
//                        NOW. It is committed and, in effect, already spent.
//   AWAITING THEIR TURN — never drawn. Still waiting to be selected. Nothing
//                        is owed yet, but 2.27 says the group must never let
//                        someone finish paying in and receive nothing.

export type WaitingGroup = "awaiting-payment" | "awaiting-turn";

export type AwaitingPaymentRow = {
  kind: "awaiting-payment";
  payoutId: string;
  participationId: string;
  personId: string;
  name: string;
  nameAmharic: string;
  number: number;
  /** The week the draw belongs to (null only for a payout with no draw). */
  weekNumber: number | null;
  /** When the draw happened — what "waiting since" measures from. */
  drawnAt: string | null;
  grossAmount: number;
  feeAmount: number;
  /** Already reduced by the winner's own-week settlement — what they receive. */
  netAmount: number;
  /** The winner's own-week contribution settled from this payout (0 = none). */
  settlementAmount: number;
  method: "ZELLE" | "CASH" | "OTHER" | null;
  /** Whole days since the draw. Null when there is no draw to measure from. */
  daysWaiting: number | null;
};

export type AwaitingTurnRow = {
  kind: "awaiting-turn";
  participationId: string;
  personId: string;
  name: string;
  nameAmharic: string;
  /** Every undrawn number they hold. */
  numbers: number[];
  /** What they would receive if drawn today, across all their numbers. */
  netAmount: number;
  grossAmount: number;
  feeAmount: number;
  weeksPaid: number;
  weeksCommitted: number;
  startWeek: number;
  finishWeek: number;
  /** Weeks left before their window closes. Negative = already past it. */
  weeksLeft: number;
  /** 2.27: their window ends soon (or has ended) and they were never drawn. */
  atRisk: boolean;
};

export type WaitingRow = AwaitingPaymentRow | AwaitingTurnRow;

/**
 * How close to the end of their window counts as "at risk" (2.27). Four weeks
 * is the organizer's own working margin: enough time to plan a draw for them.
 */
export const AT_RISK_WEEKS = 4;

/** Whole days between two instants, floored, never negative. */
export function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

/** 2.27: undrawn and running out of weeks — the person who could get nothing. */
export function isAtRisk(input: { weeksLeft: number }): boolean {
  return input.weeksLeft <= AT_RISK_WEEKS;
}

export type WaitingSort = "amount-desc" | "amount-asc" | "longest" | "week" | "name";

export const WAITING_SORTS: { key: WaitingSort; label: string }[] = [
  { key: "longest", label: "Waiting longest" },
  { key: "amount-desc", label: "Amount, high to low" },
  { key: "amount-asc", label: "Amount, low to high" },
  { key: "week", label: "Week drawn" },
  { key: "name", label: "Name" },
];

function amountOf(row: WaitingRow): number {
  return row.netAmount;
}

/**
 * Sort either group by the organizer's chosen order. Stable and total: every
 * comparison falls back to name, so the list never reshuffles between renders.
 *
 * "longest" reads differently per group on purpose — an awaiting-payment row
 * has waited since its DRAW, while an awaiting-turn row has no draw at all, so
 * its urgency is how little of its window is left.
 */
export function sortWaiting<T extends WaitingRow>(rows: readonly T[], sort: WaitingSort): T[] {
  const byName = (a: WaitingRow, b: WaitingRow) => a.name.localeCompare(b.name);
  const list = [...rows];
  switch (sort) {
    case "amount-desc":
      return list.sort((a, b) => amountOf(b) - amountOf(a) || byName(a, b));
    case "amount-asc":
      return list.sort((a, b) => amountOf(a) - amountOf(b) || byName(a, b));
    case "longest":
      return list.sort((a, b) => {
        const aKey =
          a.kind === "awaiting-payment" ? (a.daysWaiting ?? -1) : Number.MAX_SAFE_INTEGER - a.weeksLeft;
        const bKey =
          b.kind === "awaiting-payment" ? (b.daysWaiting ?? -1) : Number.MAX_SAFE_INTEGER - b.weeksLeft;
        return bKey - aKey || byName(a, b);
      });
    case "week":
      return list.sort((a, b) => {
        const aKey = a.kind === "awaiting-payment" ? (a.weekNumber ?? Infinity) : a.finishWeek;
        const bKey = b.kind === "awaiting-payment" ? (b.weekNumber ?? Infinity) : b.finishWeek;
        return aKey - bKey || byName(a, b);
      });
    case "name":
      return list.sort(byName);
  }
}

export type WaitingTotals = {
  owedNow: number;
  owedNowCount: number;
  /** The single longest wait in days, or null when nobody is awaiting payment. */
  longestWaitDays: number | null;
  eventualTotal: number;
  eventualCount: number;
  atRiskCount: number;
};

/** The headline figures — what the group owes now, and what it will owe. */
export function waitingTotals(input: {
  awaitingPayment: readonly AwaitingPaymentRow[];
  awaitingTurn: readonly AwaitingTurnRow[];
}): WaitingTotals {
  const waits = input.awaitingPayment
    .map((r) => r.daysWaiting)
    .filter((d): d is number => d !== null);
  return {
    owedNow: input.awaitingPayment.reduce((s, r) => s + r.netAmount, 0),
    owedNowCount: input.awaitingPayment.length,
    longestWaitDays: waits.length > 0 ? Math.max(...waits) : null,
    eventualTotal: input.awaitingTurn.reduce((s, r) => s + r.netAmount, 0),
    eventualCount: input.awaitingTurn.length,
    atRiskCount: input.awaitingTurn.filter((r) => r.atRisk).length,
  };
}

/**
 * The few rows the DASHBOARD shows: the most urgent of each group. Urgency is
 * the default order — longest waiting for money owed now, closest to the end
 * of their window for people still waiting their turn.
 */
export function mostUrgent(input: {
  awaitingPayment: readonly AwaitingPaymentRow[];
  awaitingTurn: readonly AwaitingTurnRow[];
  limit?: number;
}): { awaitingPayment: AwaitingPaymentRow[]; awaitingTurn: AwaitingTurnRow[] } {
  const limit = input.limit ?? 3;
  return {
    awaitingPayment: sortWaiting(input.awaitingPayment, "longest").slice(0, limit),
    // At-risk people come first regardless of amount — 2.27 is the point.
    awaitingTurn: [...input.awaitingTurn]
      .sort(
        (a, b) => Number(b.atRisk) - Number(a.atRisk) || a.weeksLeft - b.weeksLeft || a.name.localeCompare(b.name),
      )
      .slice(0, limit),
  };
}

/** "3 days" · "1 day" · "today" — how long the money has been owed. */
export function waitedLabel(days: number | null): string {
  if (days === null) return "no draw recorded";
  if (days === 0) return "today";
  return `${days} day${days === 1 ? "" : "s"}`;
}

/** "2 weeks left" · "last week" · "window closed" — how much runway is left. */
export function runwayLabel(weeksLeft: number): string {
  if (weeksLeft < 0) return "window closed";
  if (weeksLeft === 0) return "final week";
  if (weeksLeft === 1) return "1 week left";
  return `${weeksLeft} weeks left`;
}
