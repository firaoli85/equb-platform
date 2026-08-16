import { readFileSync } from "node:fs";
import { join } from "node:path";
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
    { participationId: "p1", weekNumber: 1, amountPaid: 100_000, isDeferred: false, markedLate: false, isSkipped: false },
    { participationId: "p2", weekNumber: 1, amountPaid: 100_000, isDeferred: false, markedLate: false, isSkipped: false },
    { participationId: "p1", weekNumber: 2, amountPaid: 100_000, isDeferred: false, markedLate: false, isSkipped: false },
    // p2 has not paid week 2; p1 has already paid week 3 (not elapsed).
    { participationId: "p1", weekNumber: 3, amountPaid: 100_000, isDeferred: false, markedLate: false, isSkipped: false },
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
    // Every field is a FACT that has already happened, or a statement about
    // the figure. None of them is a projection, and there is no fee among them.
    expect(Object.keys(h).sort()).toEqual([
      "collected",
      "drawnNotHandedOut",
      "handedOut",
      "owedToStopped",
      "paidEarly",
      "shouldBeHolding",
    ]);
    expect(Object.keys(h).some((k) => /fee/i.test(k))).toBe(false);
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

  it("SURPLUS: says how much more, and never calls the remainder his", () => {
    const v = positionVerdict({ cash, actual: cash.shouldBeHolding + 230_000, formatMoney });
    expect(v.kind).toBe("surplus");
    expect(v.difference).toBe(230_000);
    expect(v.sentence).toContain("$2,300 MORE than the books say");
    expect(v.sentence).toContain("$2,000 is already owed to particular people");
    expect(v.sentence).toContain("$8,300 is not promised to anyone yet");
    // THE WHOLE POINT: the remainder is never described as his. He read
    // "yours to use" as money he could spend, and it is equb money held in
    // trust (2.18).
    expect(v.sentence).toContain("not yours to spend");
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

  it("a gap in the books LEADS, and is never glossed by what is left over", () => {
    const v = positionVerdict({ cash, actual: cash.shouldBeHolding - 40_000, formatMoney });
    expect(v.kind).toBe("covered");
    expect(v.sentence).toContain("$400 LESS than the books say");
    // The gap is named as MISSING money that needs explaining, not as an
    // aside after a reassurance.
    expect(v.sentence).toContain("collected and not paid out");
    expect(v.sentence).toContain("missing");
    expect(v.sentence).toContain("not recorded");
    // Two different questions, both still answered.
    expect(v.sentence).toContain("can still cover what you owe today");

    // ORDER IS THE FIX. The shortfall must come BEFORE the remainder — the
    // old sentence led with "You can still cover everything", so the two true
    // halves together read as reassurance while the loss sat unexplained.
    expect(v.sentence.indexOf("missing")).toBeLessThan(
      v.sentence.indexOf("not promised to anyone yet"),
    );
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

// ————————————————— THE CURRENT WEEK IS NOT "AHEAD" —————————————————
//
// Reported from live data on a Wednesday of week 13: 13 members shown as
// "paid ahead" totalling $12,925, most of them "1 week ahead" for what was
// ordinary on-time money. Week 13's date had arrived; its payment window did
// not close until the Thursday. The split was made on `elapsed` alone, so for
// those five days every normal contribution was filed as money paid toward a
// week that had not happened.
//
// A WINDOW BEING OPEN AND A WEEK NOT HAVING HAPPENED ARE DIFFERENT FACTS.
describe("paid ahead means AFTER the current week, not 'window still open'", () => {
  // Weeks 1..12 finished. Week 13 has ARRIVED and its window is still OPEN.
  // Weeks 14+ have not arrived. Two members at $500: one paid week 13 on
  // time, one paid weeks 13 AND 14.
  const midWeek13 = [
    ...Array.from({ length: 12 }, (_, i) => week(i + 1, 100_000, 100_000, true)),
    week(13, 100_000, 75_000, false), // arrived, window open — money is ordinary
    week(14, 100_000, 25_000, false), // not arrived — genuinely early
    week(15, 100_000, 0, false),
  ];

  const position = () =>
    collectionPosition({
      series: midWeek13,
      owedBy: [],
      aheadBy: [{ participationId: "b", name: "Bekele", amount: 25_000, weeks: 1 }],
      currentWeek: 13,
    });

  // THE DEFECT, STATED DIRECTLY.
  it("does NOT count this week's money as paid ahead", () => {
    const p = position();
    expect(p.paidAhead).toBe(25_000); // week 14 only
    expect(p.paidAhead).not.toBe(100_000); // NOT week 13 + week 14
  });

  it("reports this week's money on its own, so it lands somewhere", () => {
    const p = position();
    expect(p.currentWeek).toBe(13);
    expect(p.collectedThisWeek).toBe(75_000);
    expect(p.expectedThisWeek).toBe(100_000);
  });

  // Nobody is short for a week whose window has not closed (2.16).
  it("keeps the open week OUT of what should have come in", () => {
    const p = position();
    expect(p.elapsedThroughWeek).toBe(12);
    expect(p.shouldHaveCollected).toBe(1_200_000); // weeks 1..12 only
    expect(p.collected).toBe(1_200_000);
    expect(p.shortfall).toBe(0);
  });

  it("every cent lands in exactly one bucket", () => {
    const p = position();
    const total = midWeek13.reduce((s, w) => s + w.received, 0);
    expect(p.collected + p.collectedThisWeek + p.paidAhead).toBe(total);
  });

  // The regression, from the other side: the OLD rule reproduced.
  it("the elapsed boundary — the old rule — really would have swept it up", () => {
    const old = midWeek13.filter((w) => !w.elapsed).reduce((s, w) => s + w.received, 0);
    expect(old).toBe(100_000); // week 13 AND week 14 — the bug
    expect(position().paidAhead).toBe(25_000); // the fix
  });

  // Once the window closes the same week becomes ordinary collection, and
  // nothing moves into "ahead".
  it("when the week's window closes, its money becomes collection", () => {
    const closed = midWeek13.map((w) => (w.weekNumber === 13 ? { ...w, elapsed: true } : w));
    const p = collectionPosition({ series: closed, owedBy: [], aheadBy: [], currentWeek: 13 });
    expect(p.elapsedThroughWeek).toBe(13);
    expect(p.collected).toBe(1_275_000);
    expect(p.collectedThisWeek).toBe(0);
    expect(p.paidAhead).toBe(25_000); // week 14, unchanged
  });

  it("says so in the sentence, rather than leaving the money unexplained", () => {
    const s = collectionSentence(position(), formatMoney);
    expect(s).toContain("Week 13 is still open");
    expect(s).toContain("$750 of $1,000 is in");
    expect(s).toContain("nobody is short for it until it closes");
    expect(s).toContain("$250 has been paid toward weeks after this one");
  });

  // A member who pays on time must never appear on the paid-ahead list, and
  // that list is built in the action from the SAME boundary.
  it("a member who paid only this week is not on the ahead list at all", () => {
    const p = collectionPosition({
      series: midWeek13,
      owedBy: [],
      // The action filters `weekNumber > currentWeek`, so an on-time payer
      // never reaches this array. Passing an empty list is what it produces.
      aheadBy: [],
      currentWeek: 13,
    });
    expect(p.aheadBy).toEqual([]);
    expect(p.paidAhead).toBe(25_000);
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
    expect(s).toContain("$300 has been paid toward weeks after this one");
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
          owedBack: 0, // she was drawn — she owes him, not the other way
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

// ————————————————————————————————————————————————————————————————
// A MEMBER WHO WAS NEVER DRAWN GETS EVERYTHING BACK
//
// app/actions/cycle-position.ts subtracted `feeOnReturn` from a stopped
// member's returned money while the comment immediately above it said "No fee
// is withheld — a fee is only ever taken from a payout and they never had
// one." The comment was the half that was right.
//
// On a $500-a-week, 20-week commitment the subtraction quietly moved $300 of
// the member's OWN money onto the organizer's side of the page — money she
// paid in and never received a payout against. 2.18 says the opposite: the
// organizer absorbs, the member is made whole.
//
// This is a source guard rather than a behavioural test because the figure is
// assembled inside a server action against the live database. It pins the one
// thing that went wrong: the fee is not in that expression.
// ————————————————————————————————————————————————————————————————

describe("a stopped member's returned money carries no fee", () => {
  const src = readFileSync(
    join(import.meta.dirname, "..", "app", "actions", "cycle-position.ts"),
    "utf8",
  );
  const owedBack = src.slice(src.indexOf("owedBack:"), src.indexOf("reason: closeReasonText"));

  it("returns every cent they paid in, with nothing taken out", () => {
    expect(owedBack).toContain("paidInByThem");
    expect(owedBack).not.toContain("feeOnReturn");
  });

  it("still returns nothing to a member who was already paid out", () => {
    // The other half of the rule: they HAD a payout, so there is no money of
    // theirs being held. Removing the fee must not turn this into a refund.
    expect(owedBack).toContain("alreadyPaidOut > 0");
  });
});
