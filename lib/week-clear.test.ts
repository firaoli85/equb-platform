import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { planWeekClear, weekClearSummary, type ClearableEvent } from "./week-clear";
import { computeStanding } from "./standing";
import { formatMoney } from "./format";

const read = (path: string) => readFileSync(path, "utf8").split("\r\n").join("\n");

// CLEARING A WEEK — one action, then the engine recomputes.
//
// Undo removes ONE receipt, so a week paid in ten partials took ten presses.
// At ten presses a correction gets abandoned half way and the record drifts,
// which is worse than the mistake it was fixing.
//
// THE RULE THAT SHAPES ALL OF IT: a week has no money of its own. A receipt is
// one amount the member handed over, and where it lands is a REPLAY that
// rebuild.ts re-derives oldest-first on every edit. So clearing a week means
// deleting the receipts whose money currently lands there — and a receipt that
// covered two weeks takes both, which has to be said before he presses.

const WEEKLY = 200_000;
const ev = (
  eventId: string,
  amount: number,
  lands: [number, number][],
  isPinned = false,
): ClearableEvent => ({
  eventId,
  amount,
  lands: lands.map(([weekNumber, applied]) => ({ weekNumber, applied })),
  isPinned,
});

describe("ONE ACTION CLEARS THE WHOLE WEEK", () => {
  it("takes every receipt on the week, not one of them", () => {
    // Oli's screenshot: week 13 holding $760 and $440 as two receipts, each
    // with its own Undo.
    const plan = planWeekClear({
      events: [ev("a", 76_000, [[13, 76_000]]), ev("b", 44_000, [[13, 44_000]])],
      weekNumbers: [13],
    });
    expect(plan.eventIds).toEqual(["a", "b"]);
    expect(plan.totalRemoved).toBe(120_000);
    expect(plan.weeksAffectedBeyondSelection).toEqual([]);
  });

  it("leaves receipts that land on other weeks alone", () => {
    const plan = planWeekClear({
      events: [ev("a", 76_000, [[13, 76_000]]), ev("b", 200_000, [[14, 200_000]])],
      weekNumbers: [13],
    });
    expect(plan.eventIds).toEqual(["a"]);
  });

  it("MULTI-WEEK: several weeks in one action, each contributing its receipts", () => {
    const plan = planWeekClear({
      events: [
        ev("a", 76_000, [[13, 76_000]]),
        ev("b", 200_000, [[14, 200_000]]),
        ev("c", 200_000, [[16, 200_000]]),
      ],
      weekNumbers: [13, 14],
    });
    expect(plan.eventIds).toEqual(["a", "b"]);
    expect(plan.totalRemoved).toBe(276_000);
    // Week 16 is untouched, and each week's outcome is independent.
    expect(plan.weeksAffected).toEqual([13, 14]);
  });

  it("a receipt counted ONCE when it lands on two selected weeks", () => {
    const plan = planWeekClear({
      events: [ev("a", 250_000, [[13, 80_000], [14, 170_000]])],
      weekNumbers: [13, 14],
    });
    expect(plan.eventIds).toEqual(["a"]);
    expect(plan.totalRemoved).toBe(250_000);
  });
});

describe("THE SPILL IS DISCLOSED, never discovered afterwards", () => {
  it("names the weeks that lose money without being selected", () => {
    // $2,500 recorded when week 13 owed $800: $800 lands on 13 and $1,700 runs
    // on to 14. Clearing 13 takes both, because a receipt cannot be split.
    const plan = planWeekClear({
      events: [ev("a", 250_000, [[13, 80_000], [14, 170_000]])],
      weekNumbers: [13],
    });
    expect(plan.weeksAffectedBeyondSelection).toEqual([14]);
    expect(weekClearSummary(plan, formatMoney)).toContain("also takes money off week 14");
    expect(weekClearSummary(plan, formatMoney)).toContain("cannot be split");
  });

  it("says nothing about a spill when there is none", () => {
    const plan = planWeekClear({
      events: [ev("a", 76_000, [[13, 76_000]])],
      weekNumbers: [13],
    });
    expect(weekClearSummary(plan, formatMoney)).not.toContain("also takes");
    expect(weekClearSummary(plan, formatMoney)).toContain("1 receipt totalling $760");
  });

  it("an empty week says so rather than offering an action that does nothing", () => {
    const plan = planWeekClear({ events: [], weekNumbers: [13] });
    expect(plan.eventIds).toEqual([]);
    expect(weekClearSummary(plan, formatMoney)).toBe("There is nothing recorded on these weeks.");
  });
});

describe("A PAYOUT SETTLEMENT IS LEFT IN PLACE, and said so", () => {
  it("is skipped rather than deleted, and does not fail the whole clear", () => {
    // A settlement is the winner's own week taken out of their payout, and the
    // payout's netAmount was decremented by exactly it. Deleting it without
    // putting that back charges the member twice — the single undo refuses it
    // by name. A BULK action must not fail entirely because one receipt is
    // special: it clears the rest and reports what it left.
    const plan = planWeekClear({
      events: [ev("a", 76_000, [[13, 76_000]]), ev("s", 200_000, [[13, 200_000]], true)],
      weekNumbers: [13],
    });
    expect(plan.eventIds).toEqual(["a"]);
    expect(plan.skippedPinned).toEqual([{ eventId: "s", amount: 200_000 }]);
    expect(weekClearSummary(plan, formatMoney)).toContain("payout settlement is left in place");
  });

  it("a week holding ONLY a settlement offers nothing and explains why", () => {
    const plan = planWeekClear({
      events: [ev("s", 200_000, [[13, 200_000]], true)],
      weekNumbers: [13],
    });
    expect(plan.eventIds).toEqual([]);
    expect(weekClearSummary(plan, formatMoney)).toContain("undone from the draw");
  });
});

// ————————————————— WHAT THE WEEK BECOMES AFTERWARDS —————————————————
//
// There is NO STATUS COLUMN. LATE, pending, part-paid and the rest are derived
// from money and the calendar on every read (2.14), so clearing the receipts
// and replaying IS the recompute. These prove the derivation lands where Oli
// said it must, from a window with the money taken out.

const weekDate = (n: number) => new Date(Date.UTC(2026, 4, 3 + (n - 1) * 7));

function standingAfterClear(input: {
  clearedWeek: number;
  today: Date;
  deferred?: boolean;
  paidThrough: number;
}) {
  const windowWeeks = Array.from({ length: 20 }, (_, i) => {
    const n = i + 1;
    // The cleared week has nothing on it; earlier weeks are settled.
    const paid = n === input.clearedWeek ? 0 : n <= input.paidThrough ? WEEKLY : 0;
    return {
      weekNumber: n,
      date: weekDate(n),
      amountDue: WEEKLY,
      storedPaid: paid,
      isDeferred: n === input.clearedWeek ? (input.deferred ?? false) : false,
      markedLate: false,
      isSkipped: false,
    };
  });
  return computeStanding({
    weeklyAmount: WEEKLY,
    startWeek: 1,
    weeksCommitted: 20,
    cycleWeek: 20,
    today: input.today,
    windowWeeks,
    totalPaid: windowWeeks.reduce((s, w) => s + w.storedPaid, 0),
  });
}

describe("THE ENGINE RECOMPUTES — past the window is LATE, inside it is not", () => {
  it("PAST THE WINDOW: a cleared week reads LATE", () => {
    // Week 5 closed on 5 Jun 2026 (its date + 5 days); today is August.
    const s = standingAfterClear({
      clearedWeek: 5,
      paidThrough: 4,
      today: new Date(Date.UTC(2026, 7, 15)),
    });
    const week = s.weeks.find((w) => w.weekNumber === 5)!;
    expect(week.status).toBe("LATE");
    expect(week.amountPaid).toBe(0);
  });

  it("INSIDE THE WINDOW: a cleared week is not yet due, and is not late", () => {
    // Same week, but "today" is two days after it — the window is still open.
    const s = standingAfterClear({
      clearedWeek: 5,
      paidThrough: 4,
      today: new Date(Date.UTC(2026, 4, 3 + 4 * 7 + 2)),
    });
    const week = s.weeks.find((w) => w.weekNumber === 5)!;
    expect(week.status).not.toBe("LATE");
    expect(["UNPAID", "PENDING", "DUE", "UPCOMING"]).toContain(week.status);
  });

  it("a DEFERRED week cleared stays paused, not late (D-42)", () => {
    // Removing money from a deferred week must not start chasing it: deferral
    // is the organizer's agreement, and it outranks the calendar (2.29).
    const s = standingAfterClear({
      clearedWeek: 5,
      paidThrough: 4,
      deferred: true,
      today: new Date(Date.UTC(2026, 7, 15)),
    });
    const week = s.weeks.find((w) => w.weekNumber === 5)!;
    expect(week.status).toBe("DEFERRED");
    // And its money moves to the paused pot rather than the chased one.
    expect(s.amountDeferred).toBe(WEEKLY);
  });

  it("outstanding repartitions — the money comes back as owed", () => {
    const before = standingAfterClear({
      clearedWeek: 99, // nothing cleared
      paidThrough: 5,
      today: new Date(Date.UTC(2026, 7, 15)),
    });
    const after = standingAfterClear({
      clearedWeek: 5,
      paidThrough: 5,
      today: new Date(Date.UTC(2026, 7, 15)),
    });
    expect(after.amountOutstanding).toBe(before.amountOutstanding + WEEKLY);
    expect(after.weeksCredited).toBe(before.weeksCredited - 1);
  });

  it("cleared then re-paid is an ordinary week again — no broken state", () => {
    const cleared = standingAfterClear({
      clearedWeek: 5,
      paidThrough: 5,
      today: new Date(Date.UTC(2026, 7, 15)),
    });
    const repaid = standingAfterClear({
      clearedWeek: 99,
      paidThrough: 5,
      today: new Date(Date.UTC(2026, 7, 15)),
    });
    expect(cleared.weeks.find((w) => w.weekNumber === 5)!.status).toBe("LATE");
    expect(repaid.weeks.find((w) => w.weekNumber === 5)!.status).toBe("PAID");
  });
});

describe("GUARD — the clear goes through rebuild, and writes no negative", () => {
  const edits = read("app/actions/edits.ts");
  const clear = edits.slice(
    edits.indexOf("export async function clearWeeks("),
    edits.length,
  );

  it("the scan is real", () => {
    expect(clear.length).toBeGreaterThan(1200);
  });

  it("it recomputes through rebuild.ts — never a hand-set status", () => {
    // §5.10: adding and removing money must flow through ONE recompute, or the
    // two can disagree about lateness.
    expect(clear).toContain("await rebuildParticipationPayments(tx, input.participationId)");
    // There is no status column to write, and nothing here invents one.
    expect(clear).not.toContain("status:");
    expect(clear).not.toContain("markedLateAt:");
  });

  it("ONE rebuild for however many weeks were ticked", () => {
    expect((clear.match(/rebuildParticipationPayments\(/g) ?? []).length).toBe(1);
  });

  it("NO NEGATIVE MONEY — it deletes, and never writes a compensating row", () => {
    // Oli: "there is no negative payment for us." A negative receipt would be a
    // second way to represent "this did not happen", which every total would
    // then have to know about.
    expect(clear).toContain("tx.paymentEvent.deleteMany({");
    expect(clear).not.toContain("paymentEvent.create");
    expect(clear).not.toContain("amount: -");
    expect(clear).not.toContain("-amount");
    expect(clear).not.toContain("negate");
  });

  it("it tolerates a receipt that is already gone", () => {
    // The undo bug: findUniqueOrThrow on a stale event threw "No record was
    // found". A bulk correction is exactly where two people are most likely to
    // be clearing at once, and "some of it was already done" is the desired end
    // state, not an error.
    expect(clear).toContain("deleteMany");
    expect(clear).not.toContain("findUniqueOrThrow({ where: { id: { in:");
  });

  it("a closed cycle is still refused (2.9) and the whole thing is one transaction", () => {
    expect(clear).toContain("await refuseIfCycleClosed(tx, { participationId: input.participationId })");
    expect(clear).toContain("serializableTransaction");
  });

  it("the preview and the commit compute the SAME plan", () => {
    // A preview that described a different outcome than the commit would be
    // worse than no preview.
    const preview = edits.slice(
      edits.indexOf("export async function previewWeekClear("),
      edits.indexOf("export async function clearWeeks("),
    );
    expect(preview).toContain("planWeekClear({ events, weekNumbers: input.weekNumbers })");
    expect(clear).toContain("planWeekClear({ events, weekNumbers: input.weekNumbers })");
  });
});
