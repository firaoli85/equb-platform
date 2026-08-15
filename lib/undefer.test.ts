import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeStanding, type StandingWeekInput } from "./standing";

// A PAYMENT ENDS THE NOT-KNOWING (Oli's ruling, 15 Aug 2026).
//
// DEFERRED means "paused, outcome unknown" (§2.29a). Money arriving answers
// the question the pause was holding open, so the member is active again and
// every deferred week of theirs returns to the ordinary ladder.
//
// THE MECHANISM IS A STORED CLEAR in lib/rebuild.ts, at the one place money
// lands on weeks — NOT a derived override. These tests therefore work the way
// the system does: they show what the derivation produces once the flag has
// been cleared, and pin the clear itself by reading the source.

const WEEKLY = 200_000; // $2,000
const TODAY = new Date(Date.UTC(2026, 7, 15));
const weekDate = (n: number) => new Date(Date.UTC(2026, 4, 3 + (n - 1) * 7));

function week(n: number, over: Partial<StandingWeekInput> = {}): StandingWeekInput {
  return {
    weekNumber: n,
    date: weekDate(n),
    amountDue: WEEKLY,
    storedPaid: 0,
    isDeferred: false,
    isSkipped: false,
    markedLate: false,
    ...over,
  };
}

function standingFor(weeks: StandingWeekInput[], totalPaid: number) {
  return computeStanding({
    weeklyAmount: WEEKLY,
    startWeek: 1,
    weeksCommitted: 20,
    cycleWeek: 15,
    today: TODAY,
    windowWeeks: weeks,
    totalPaid,
  });
}

/** Ten weeks paid, then weeks 11 and 12 — both closed by 15 Aug. */
const paidThroughTen = Array.from({ length: 10 }, (_, i) => week(i + 1, { storedPaid: WEEKLY }));

describe("THE FIRAOLI CASE — weeks 11 and 12 deferred, then $2,000 arrives", () => {
  // BEFORE: nothing has been paid since the pause. Both weeks are paused, and
  // their $4,000 is held rather than owed (D-42).
  const before = standingFor(
    [...paidThroughTen, week(11, { isDeferred: true }), week(12, { isDeferred: true })],
    10 * WEEKLY,
  );

  // AFTER: $2,000 arrives. It lands oldest-first on week 11 — and because the
  // payment reached a deferred week, rebuild.ts clears `isDeferred` on BOTH.
  // That cleared state is what the screens then derive from.
  const after = standingFor(
    [...paidThroughTen, week(11), week(12)],
    11 * WEEKLY,
  );

  it("before the payment: both weeks read DEFERRED and hold $4,000", () => {
    expect(before.weeks.find((w) => w.weekNumber === 11)!.status).toBe("DEFERRED");
    expect(before.weeks.find((w) => w.weekNumber === 12)!.status).toBe("DEFERRED");
    expect(before.amountDeferred).toBe(2 * WEEKLY); // $4,000 paused
    expect(before.amountOutstanding).toBe(0); // nothing owed right now
  });

  it("week 11 becomes PAID — the deferral mark is GONE, not still '~'", () => {
    const w11 = after.weeks.find((w) => w.weekNumber === 11)!;
    expect(w11.status).toBe("PAID");
    // The grid draws the "~" from `isDeferred`; this is the symptom Oli saw.
    expect(w11.isDeferred).toBe(false);
  });

  it("week 12 becomes LATE — expected again, because the member is active", () => {
    const w12 = after.weeks.find((w) => w.weekNumber === 12)!;
    expect(w12.status).toBe("LATE");
    expect(w12.isDeferred).toBe(false);
    // Its window closed on 24 July, so it is chased on its own calendar.
    expect(w12.coveredAtCurrentRate).toBe(0);
  });

  it("the money REPARTITIONS — nothing forgiven, nothing created", () => {
    // Week 12's $2,000 moves from held to owed-right-now.
    expect(after.amountDeferred).toBe(0);
    expect(after.amountOutstanding).toBe(WEEKLY);
    // The whole debt is $2,000 whichever way it is split. Under the option we
    // did NOT take — un-defer only the week the money reached — it would have
    // been outstanding $0 and deferred $2,000: the same total, differently
    // labelled. The ruling picks which label is true.
    expect(after.amountOutstanding + after.amountDeferred).toBe(WEEKLY);
  });

  it("and the member is counted behind again", () => {
    expect(before.weeksBehind).toBe(0); // paused: not chased, not counted
    expect(after.weeksBehind).toBe(1); // week 12 is owed
  });
});

describe("NO FALSE REACTIVATION — the rule only fires on money", () => {
  it("a deferred member with nothing paid since STAYS deferred", () => {
    const s = standingFor(
      [...paidThroughTen, week(11, { isDeferred: true }), week(12, { isDeferred: true })],
      10 * WEEKLY,
    );
    expect(s.weeks.find((w) => w.weekNumber === 11)!.status).toBe("DEFERRED");
    expect(s.weeks.find((w) => w.weekNumber === 12)!.status).toBe("DEFERRED");
    expect(s.amountDeferred).toBe(2 * WEEKLY);
  });

  it("earlier payments cannot reactivate — coverage is oldest-first", () => {
    // The member paid ten weeks BEFORE the pause. That money covers weeks 1-10
    // and never reaches 11 or 12, so no deferred week holds any of it and the
    // pause stands. This is why the signal is money ON a deferred week rather
    // than "has this member ever paid".
    const s = standingFor(
      [...paidThroughTen, week(11, { isDeferred: true }), week(12, { isDeferred: true })],
      10 * WEEKLY,
    );
    expect(s.weeks.find((w) => w.weekNumber === 11)!.coveredAtCurrentRate).toBe(0);
    expect(s.amountOutstanding).toBe(0);
  });
});

describe("RE-DEFER STILL WORKS — the organizer keeps his half of the rule", () => {
  it("a week deferred again after reactivation reads DEFERRED", () => {
    // rebuild.ts cleared the flag when the money landed; he now marks week 12
    // deferred again from world-knowledge. Nothing re-derives it away, because
    // the un-defer is a stored clear at payment time, not a standing override.
    const s = standingFor(
      [...paidThroughTen, week(11), week(12, { isDeferred: true })],
      11 * WEEKLY,
    );
    expect(s.weeks.find((w) => w.weekNumber === 12)!.status).toBe("DEFERRED");
    expect(s.amountDeferred).toBe(WEEKLY);
    expect(s.amountOutstanding).toBe(0);
  });

  it("and week 11 stays PAID — money still beats everything", () => {
    const s = standingFor(
      [...paidThroughTen, week(11), week(12, { isDeferred: true })],
      11 * WEEKLY,
    );
    expect(s.weeks.find((w) => w.weekNumber === 11)!.status).toBe("PAID");
  });

  it("a week he pauses that ALREADY holds money is not un-paused behind him", () => {
    // THE CASE A DERIVED RULE WOULD HAVE BROKEN. Week 11 holds a part payment
    // and he deliberately pauses it. Deriving "money on a deferred week means
    // active" would flip it back the instant he saved. The stored clear only
    // fires when money ARRIVES, so his decision stands.
    const s = standingFor(
      [...paidThroughTen, week(11, { isDeferred: true }), week(12)],
      10 * WEEKLY + 50_000, // $500 on week 11
    );
    expect(s.weeks.find((w) => w.weekNumber === 11)!.status).toBe("DEFERRED");
    expect(s.amountDeferred).toBe(WEEKLY - 50_000); // $1,500 still paused
  });
});

describe("GUARD — the clear lives where money lands, and goes one way only", () => {
  const rebuild = readFileSync(join(import.meta.dirname, "rebuild.ts"), "utf8");

  it("rebuild.ts clears isDeferred when a payment reaches a paused week", () => {
    expect(rebuild).toMatch(/const reactivated = state\.some\(/);
    expect(rebuild).toMatch(/data: \{ isDeferred: false \}/);
  });

  it("it clears ALL the member's paused weeks, not only the one money reached", () => {
    // Option (b) of the ruling: the pause was about the MEMBER.
    expect(rebuild).toMatch(/state\.filter\(\(s\) => s\.isDeferred && s\.paymentId\)/);
  });

  it("NOTHING ever sets isDeferred back to true automatically", () => {
    // One way only: re-deferring is the organizer's call (2.2). A write of
    // `isDeferred: true` in this file would be the system overruling him.
    expect(rebuild).not.toMatch(/isDeferred: true/);
  });
});
