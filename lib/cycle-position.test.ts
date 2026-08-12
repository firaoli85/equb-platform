import { describe, expect, it } from "vitest";
import {
  cashOnHand,
  collectionPosition,
  collectionSentence,
  feeEstimate,
  positionVerdict,
} from "./cycle-position";
import { cashPosition, receiptsByWeek } from "./dashboard";
import { formatMoney } from "./format";

// "Am I in negative, am I using someone else's money, or am I on track."
//
// The piece that was invisible is PAID AHEAD: money received for weeks that
// have not elapsed. A balance that looks healthy because four people paid
// early is not healthy, and nothing said so.

const week = (n: number, expected: number, received: number, elapsed: boolean) => ({
  weekNumber: n,
  expected,
  received,
  shortfall: Math.max(0, expected - received),
  membersPaid: 0,
  membersExpected: 0,
  elapsed,
});

describe("collectionPosition — should-vs-actual, and the money owed forward", () => {
  const series = [
    week(1, 100_000, 100_000, true),
    week(2, 100_000, 100_000, true),
    week(3, 100_000, 60_000, true), // someone short
    week(4, 100_000, 50_000, false), // NOT elapsed — paid ahead
    week(5, 100_000, 25_000, false), // NOT elapsed — paid ahead
  ];

  it("sums expectations over ELAPSED weeks only", () => {
    const p = collectionPosition({ series, owedBy: [], aheadBy: [] });
    expect(p.shouldHaveCollected).toBe(300_000);
    expect(p.elapsedThroughWeek).toBe(3);
  });

  it("counts only elapsed receipts as collected", () => {
    const p = collectionPosition({ series, owedBy: [], aheadBy: [] });
    expect(p.collected).toBe(260_000);
    expect(p.shortfall).toBe(40_000);
  });

  // THE PIECE HE CANNOT SEE TODAY.
  it("separates money paid toward weeks that have NOT happened", () => {
    const p = collectionPosition({ series, owedBy: [], aheadBy: [] });
    expect(p.paidAhead).toBe(75_000);
    // And it is NOT counted as collected — that is the whole distinction.
    expect(p.collected).toBe(260_000);
  });

  it("never reports a negative shortfall when a week is overpaid", () => {
    const over = [week(1, 100_000, 130_000, true)];
    expect(collectionPosition({ series: over, owedBy: [], aheadBy: [] }).shortfall).toBe(0);
  });

  it("reports zero paid-ahead when every week has elapsed", () => {
    const all = series.map((w) => ({ ...w, elapsed: true }));
    expect(collectionPosition({ series: all, owedBy: [], aheadBy: [] }).paidAhead).toBe(0);
  });

  it("names who makes up the shortfall, largest first", () => {
    const p = collectionPosition({
      series,
      owedBy: [
        { participationId: "a", name: "Abebe", amount: 10_000 },
        { participationId: "b", name: "Bekele", amount: 30_000 },
        { participationId: "c", name: "Chala", amount: 0 },
      ],
      aheadBy: [],
    });
    expect(p.owedBy.map((m) => m.name)).toEqual(["Bekele", "Abebe"]);
  });

  it("names who paid ahead, largest first", () => {
    const p = collectionPosition({
      series,
      owedBy: [],
      aheadBy: [
        { participationId: "a", name: "Abebe", amount: 25_000, weeks: 1 },
        { participationId: "b", name: "Bekele", amount: 50_000, weeks: 2 },
      ],
    });
    expect(p.aheadBy.map((m) => m.name)).toEqual(["Bekele", "Abebe"]);
  });
});

describe("agreement with the dashboard — one derivation, not two", () => {
  // The series the cycle position reads is the SAME one the dashboard builds.
  // If receiptsByWeek's elapsed rule ever changes, both move together.
  const weeks = [
    { weekNumber: 1, isSkipped: false },
    { weekNumber: 2, isSkipped: false },
    { weekNumber: 3, isSkipped: false },
  ];
  const participations = [
    { id: "p1", weeklyAmount: 100_000, startWeek: 1, weeksCommitted: 3 },
    { id: "p2", weeklyAmount: 100_000, startWeek: 1, weeksCommitted: 3 },
  ];
  const payments = [
    { participationId: "p1", weekNumber: 1, amountPaid: 100_000, isDeferred: false, isSkipped: false },
    { participationId: "p2", weekNumber: 1, amountPaid: 100_000, isDeferred: false, isSkipped: false },
    { participationId: "p1", weekNumber: 2, amountPaid: 100_000, isDeferred: false, isSkipped: false },
    // p2 has not paid week 2; p1 has already paid week 3 (not elapsed).
    { participationId: "p1", weekNumber: 3, amountPaid: 100_000, isDeferred: false, isSkipped: false },
  ];

  it("reads elapsed-ness from the dashboard series, never its own rule", () => {
    const series = receiptsByWeek({ weeks, participations, payments, elapsedThroughWeek: 2 });
    const p = collectionPosition({ series, owedBy: [], aheadBy: [] });
    expect(p.elapsedThroughWeek).toBe(2);
    expect(p.shouldHaveCollected).toBe(400_000); // weeks 1+2, two members
    expect(p.collected).toBe(300_000);
    expect(p.shortfall).toBe(100_000); // p2's week 2
    expect(p.paidAhead).toBe(100_000); // p1's week 3
  });

  it("moving the elapsed boundary moves collected and paid-ahead together", () => {
    const later = receiptsByWeek({ weeks, participations, payments, elapsedThroughWeek: 3 });
    const p = collectionPosition({ series: later, owedBy: [], aheadBy: [] });
    // Week 3 is now elapsed, so its money is collection, not owed forward.
    expect(p.paidAhead).toBe(0);
    expect(p.collected).toBe(400_000);
  });

  it("what he should be holding starts from the dashboard's own cash position", () => {
    const cash = cashPosition({
      payments: [{ amountPaid: 400_000 }],
      payouts: [
        { netAmount: 100_000, status: "COLLECTED" },
        { netAmount: 90_000, status: "PENDING" },
      ],
    });
    const h = cashOnHand({
      collected: cash.totalReceived,
      handedOut: cash.totalPaidOut,
      drawnNotHandedOut: cash.committedPending,
      paidEarly: 100_000,
    });
    expect(h.shouldBeHolding).toBe(cash.currentlyHeld);
    // The drawn payout is REPORTED, not subtracted: the cash is still in hand.
    expect(h.drawnNotHandedOut).toBe(cash.committedPending);
    expect(h.shouldBeHolding).toBe(400_000 - 100_000);
  });
});

describe("cashOnHand — money in, money out, what is left. Three facts.", () => {
  const base = {
    collected: 1_000_000,
    handedOut: 200_000,
    drawnNotHandedOut: 150_000,
    paidEarly: 50_000,
  };

  it("is exactly collected minus handed out, and nothing else", () => {
    const h = cashOnHand(base);
    expect(h.collected).toBe(1_000_000);
    expect(h.handedOut).toBe(200_000);
    expect(h.shouldBeHolding).toBe(800_000);
  });

  // THE FEE IS NOT IN THE CASH POSITION.
  //
  // It used to be subtracted here. It is a projection of what he MIGHT keep,
  // and a projection folded into a statement of fact makes the whole figure
  // less believable. This test fails the moment anyone puts it back.
  it("does not move when the fee changes, because the fee is not in it", () => {
    const h = cashOnHand(base);
    expect(h.shouldBeHolding).toBe(base.collected - base.handedOut);
    // No fee input exists to pass. The figure cannot depend on one.
    expect(Object.keys(h).sort()).toEqual([
      "collected",
      "drawnNotHandedOut",
      "handedOut",
      "paidEarly",
      "shouldBeHolding",
    ]);
  });

  // THE CRITICAL ARITHMETIC. A payout DRAWN but not yet handed over is cash
  // still sitting in his hand. Subtracting it tells him he holds less than he
  // does — the direction that makes an organizer borrow money he did not need.
  it("does NOT subtract a payout that is drawn but not handed over", () => {
    const none = cashOnHand({ ...base, drawnNotHandedOut: 0 });
    const huge = cashOnHand({ ...base, drawnNotHandedOut: 750_000 });
    expect(none.shouldBeHolding).toBe(800_000);
    expect(huge.shouldBeHolding).toBe(800_000);
    // Reported, so he can see it. Never subtracted.
    expect(huge.drawnNotHandedOut).toBe(750_000);
  });

  it("does not subtract money paid early either — it is stated, not netted", () => {
    const a = cashOnHand({ ...base, paidEarly: 0 });
    const b = cashOnHand({ ...base, paidEarly: 400_000 });
    expect(a.shouldBeHolding).toBe(b.shouldBeHolding);
    expect(b.paidEarly).toBe(400_000);
  });

  it("handing the drawn payout over is what finally moves the figure", () => {
    // Same money, one step later: it has left his hand.
    const before = cashOnHand({ ...base, drawnNotHandedOut: 150_000 });
    const after = cashOnHand({
      ...base,
      handedOut: base.handedOut + 150_000,
      drawnNotHandedOut: 0,
    });
    expect(before.shouldBeHolding - after.shouldBeHolding).toBe(150_000);
  });
});

describe("feeEstimate — kept out of the cash position, labelled an estimate", () => {
  it("separates the settled part from the part that depends on the cycle finishing", () => {
    const f = feeEstimate({ onHandedOut: 4_000, onDrawn: 3_000 });
    expect(f.soFar).toBe(4_000);
    expect(f.ifRemainingPayoutsComplete).toBe(3_000);
    expect(f.total).toBe(7_000);
  });

  it("is a separate function from the cash position — not a field on it", () => {
    const h = cashOnHand({
      collected: 1_000_000,
      handedOut: 200_000,
      drawnNotHandedOut: 0,
      paidEarly: 0,
    });
    expect("fee" in h).toBe(false);
    expect("feeEarned" in h).toBe(false);
  });
});

describe("positionVerdict — never just a number", () => {
  // $10,000 in, $2,000 handed over → he should be holding $8,000.
  // Of that: $1,500 is drawn and not handed out, $500 was paid early.
  // So $2,000 of what he holds belongs to other people.
  const cash = cashOnHand({
    collected: 1_000_000,
    handedOut: 200_000,
    drawnNotHandedOut: 150_000,
    paidEarly: 50_000,
  });

  it("SURPLUS: says how much more, and what is left that is his to use", () => {
    const v = positionVerdict({ cash, actual: cash.shouldBeHolding + 230_000, formatMoney });
    expect(v.kind).toBe("surplus");
    expect(v.difference).toBe(230_000);
    expect(v.sentence).toContain("$2,300 MORE than the books say");
    expect(v.sentence).toContain("$2,000 you are holding for other people");
    expect(v.sentence).toContain("$8,300 is yours to use");
  });

  it("SHORT: says by how much, what it is against, and what he must do", () => {
    // Holding less than the money that belongs to other people.
    const v = positionVerdict({ cash, actual: 100_000, formatMoney });
    expect(v.kind).toBe("short");
    expect(v.shortBy).toBe(100_000);
    expect(v.sentence).toContain("short by $1,000");
    expect(v.sentence).toContain("$1,500 is drawn but not handed out yet");
    expect(v.sentence).toContain("$500 was paid early for weeks that have not happened");
    expect(v.sentence).toContain("before the next payout");
  });

  it("a gap in the books is reported even when he can still cover everything", () => {
    const v = positionVerdict({ cash, actual: cash.shouldBeHolding - 40_000, formatMoney });
    expect(v.kind).toBe("covered");
    expect(v.sentence).toContain("$400 LESS than the books say");
    // Two different questions, both answered.
    expect(v.sentence).toContain("can still cover everything");
    expect(v.sentence).toContain("not recorded");
  });

  it("EXACT: the books and the cash agree", () => {
    const v = positionVerdict({ cash, actual: cash.shouldBeHolding, formatMoney });
    expect(v.kind).toBe("exact");
    expect(v.difference).toBe(0);
    expect(v.sentence).toContain("exactly what the books say");
  });

  // "Can I meet what I owe" must not lean on an estimate. The fee is not in
  // the cash position and it is not in this answer either.
  it("coverage is what he holds against what belongs to other people, fee absent", () => {
    const v = positionVerdict({ cash, actual: 200_000, formatMoney });
    // drawn-not-handed-out 150,000 + paid early 50,000 = 200,000
    expect(v.coverage).toBe(0);
    expect(v.kind).not.toBe("short");
  });

  it("a drawn payout still counts against him even though it has not left", () => {
    // He holds nothing beyond the $1,500 he has promised a winner.
    const v = positionVerdict({ cash, actual: 199_999, formatMoney });
    expect(v.kind).toBe("short");
    expect(v.shortBy).toBe(1);
  });

  it("never emits a bare number, NaN or a negative-looking amount", () => {
    for (const actual of [0, 1, 200_000, 800_000, 5_000_000]) {
      const v = positionVerdict({ cash, actual, formatMoney });
      expect(v.sentence.length).toBeGreaterThan(40);
      expect(v.sentence).not.toContain("NaN");
      expect(v.sentence).not.toContain("undefined");
      expect(v.sentence).not.toContain("$-");
    }
  });

  // PLAIN ENGLISH IS THE RULE, NOT A PREFERENCE. He is not an accountant and
  // he never was. Every one of these words was on this screen and every one
  // of them made him stop and translate.
  it("uses no accounting vocabulary in any verdict, ever", () => {
    const banned = /\b(uncommitted|committed|owed forward|claimed|free|net|reconcil\w*)\b/i;
    for (const actual of [0, 1, 199_999, 200_000, 760_000, 800_000, 1_030_000, 5_000_000]) {
      const v = positionVerdict({ cash, actual, formatMoney });
      expect(v.sentence).not.toMatch(banned);
      // And the fee never appears in a statement of what he is holding.
      expect(v.sentence.toLowerCase()).not.toContain("fee");
    }
  });
});

describe("collectionSentence — the dashboard's register", () => {
  it("states should, actual, who is short, and what was paid early", () => {
    const p = collectionPosition({
      series: [week(1, 100_000, 100_000, true), week(2, 100_000, 60_000, true), week(3, 100_000, 30_000, false)],
      owedBy: [{ participationId: "a", name: "Abebe", amount: 40_000 }],
      aheadBy: [{ participationId: "b", name: "Bekele", amount: 30_000, weeks: 1 }],
    });
    const s = collectionSentence(p, formatMoney);
    expect(s).toContain("Through week 2");
    expect(s).toContain("$2,000 should have come in");
    expect(s).toContain("$1,600 has");
    expect(s).toContain("$400 is outstanding, from 1 member");
    expect(s).toContain("$300 has been paid toward weeks that have not happened");
    expect(s).toContain("belongs to those weeks, not to this one");
    // The plain-English rule reaches this sentence too (UI_STANDARDS 8b).
    expect(s).not.toMatch(/\b(owed forward|uncommitted|committed)\b/i);
  });

  it("says nothing about paid-ahead when there is none", () => {
    const p = collectionPosition({ series: [week(1, 100_000, 100_000, true)], owedBy: [], aheadBy: [] });
    const s = collectionSentence(p, formatMoney);
    expect(s).toContain("Nothing is outstanding.");
    expect(s).not.toContain("paid toward weeks");
  });

  // A MEMBER WHO STOPPED GETS THEIR OWN CLAUSE. Folding them into the
  // outstanding figure told the organizer he was waiting on money nobody was
  // going to send — the sentence this whole feature exists to correct.
  it("says who stopped, and separates it from what is outstanding", () => {
    const p = collectionPosition({
      series: [week(1, 100_000, 100_000, true), week(2, 100_000, 40_000, true)],
      owedBy: [{ participationId: "a", name: "Abebe", amount: 20_000 }],
      aheadBy: [],
      stoppedBy: [
        {
          participationId: "m",
          name: "Meheret",
          closedAtWeek: 2,
          balanceRecorded: 40_000,
          amountLeaving: 800_000,
          alreadyPaidOut: 1_960_000,
          shortfallToCover: 800_000,
          reason: "Stopped contributing",
        },
      ],
    });
    const s = collectionSentence(p, formatMoney);
    // The gap is $600; $400 of it belongs to Meheret and is on her record.
    expect(p.shouldHaveCollected - p.collected).toBe(60_000);
    expect(p.willNotArrive).toBe(40_000);
    expect(p.shortfall).toBe(20_000);
    expect(s).toContain("$200 is outstanding, from 1 member");
    expect(s).toContain("1 member has stopped");
    expect(s).toContain("$400 they had not paid is on their own record");
    expect(s).toContain("$8,000 of contributions behind payouts you have already handed over");
    expect(s).toContain("yours to cover");
  });

  it("says nothing about stopped members when nobody has stopped", () => {
    const p = collectionPosition({ series: [week(1, 100_000, 100_000, true)], owedBy: [], aheadBy: [] });
    expect(collectionSentence(p, formatMoney)).not.toContain("stopped");
  });
});
