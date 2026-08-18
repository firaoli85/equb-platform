import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bucketOutstanding, endOfCycle, endOfCycleSentence, type RefundOwed } from "./end-of-cycle";
import { formatMoney } from "./format";

// THE LIVE CYCLE, as reconciled on 18 Aug 2026. These are the real figures,
// kept as the test because the whole point of this module is that it agrees
// with the organizer's own arithmetic.
//
//   awaiting their turn, fee already out    $151,900
//   future contributions weeks 15-23        $113,250
//   arrears on elapsed weeks                 $20,125
//   counted cash                             $17,650
//   refund owed to Tsion (§2.30)              $4,200
//
// He made it $875 short. He was right about four of those five lines to the
// cent — including the fee, which he had already taken out. The line he
// missed was Tsion: she is not awaiting a turn, so she appeared nowhere in
// his sum, and $4,200 still has to leave his hands.
const LIVE = {
  outstanding: {
    overdue: 2_012_500,
    currentWeekOutstanding: 0,
    notYetDue: 11_325_000,
    total: 13_337_500,
  },
  payoutsStillToGoOut: 15_190_000,
  feeStillToEarn: 310_000,
  inHand: 1_765_000,
};
const TSION: RefundOwed = {
  participationId: "p-tsion",
  name: "Tsion",
  amount: 420_000,
  counted: true,
};

describe("the live cycle, reproduced", () => {
  it("finishes $5,075 short with Tsion counted", () => {
    const p = endOfCycle({ ...LIVE, refunds: [TSION] });
    expect(p.comingIn).toBe(13_337_500);
    expect(p.goingOut).toBe(15_610_000);
    expect(p.endOfCycle).toBe(-507_500);
  });

  it("finishes $875 short with Tsion handled by hand — the organizer's own figure", () => {
    // His paper sum, exactly. Not a coincidence: his arithmetic was right, he
    // simply had no line for a member he owes rather than owes a turn.
    const p = endOfCycle({ ...LIVE, refunds: [{ ...TSION, counted: false }] });
    expect(p.endOfCycle).toBe(-87_500);
  });

  it("the toggle moves it by EXACTLY her refund and nothing else", () => {
    const on = endOfCycle({ ...LIVE, refunds: [TSION] });
    const off = endOfCycle({ ...LIVE, refunds: [{ ...TSION, counted: false }] });
    expect(off.endOfCycle - on.endOfCycle).toBe(TSION.amount);
    // Every other line is untouched by the choice.
    expect(off.comingIn).toBe(on.comingIn);
    expect(off.payoutsStillToGoOut).toBe(on.payoutsStillToGoOut);
    expect(off.inHand).toBe(on.inHand);
    expect(off.feeStillToEarn).toBe(on.feeStillToEarn);
  });

  it("what he owes is reported in full either way — the debt never hides", () => {
    const off = endOfCycle({ ...LIVE, refunds: [{ ...TSION, counted: false }] });
    expect(off.refundsOwedInFull).toBe(420_000);
    expect(off.refundsCounted).toBe(0);
    expect(off.refundsHandledByHand).toBe(420_000);
    // And she is still in the list, by name.
    expect(off.refunds.map((r) => r.name)).toEqual(["Tsion"]);
  });
});

describe("the fee is inside the payout figure and nowhere else", () => {
  it("is never added to the arithmetic", () => {
    const withFee = endOfCycle({ ...LIVE, refunds: [TSION] });
    const noFee = endOfCycle({ ...LIVE, feeStillToEarn: 0, refunds: [TSION] });
    // Changing the reported fee must not move the answer by a cent. If it
    // ever does, the fee has been counted twice.
    expect(noFee.endOfCycle).toBe(withFee.endOfCycle);
    expect(noFee.goingOut).toBe(withFee.goingOut);
    expect(noFee.comingIn).toBe(withFee.comingIn);
  });

  it("is reported, so the page can state it without using it", () => {
    expect(endOfCycle({ ...LIVE, refunds: [] }).feeStillToEarn).toBe(310_000);
  });

  it("SOURCE GUARD: no fee term appears in any sum in this module", () => {
    // Same discipline as "coverage does not touch the fee". The arithmetic
    // lines are the ones that matter; `feeStillToEarn` may only be carried
    // through, never operated on.
    const src = readFileSync(join(import.meta.dirname, "end-of-cycle.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*)/.test(l))
      .join("\n");
    // Anything like `+ feeStillToEarn`, `- input.feeStillToEarn`, `fee +` ...
    expect(src).not.toMatch(/[+\-]\s*(input\.)?feeStillToEarn/);
    expect(src).not.toMatch(/feeStillToEarn\s*[+\-]/);
    // It is assigned through and nothing more.
    expect(src).toMatch(/feeStillToEarn: input\.feeStillToEarn/);
  });
});

describe("several refunds, each with its own answer", () => {
  const a: RefundOwed = { participationId: "a", name: "Alem", amount: 100_000, counted: true };
  const b: RefundOwed = { participationId: "b", name: "Bruk", amount: 250_000, counted: false };

  it("only the counted ones enter the sum", () => {
    const p = endOfCycle({ ...LIVE, refunds: [a, b] });
    expect(p.refundsCounted).toBe(100_000);
    expect(p.refundsHandledByHand).toBe(250_000);
    expect(p.refundsOwedInFull).toBe(350_000);
    expect(p.goingOut).toBe(LIVE.payoutsStillToGoOut + 100_000);
  });

  it("no refunds at all is not an error", () => {
    const p = endOfCycle({ ...LIVE, refunds: [] });
    expect(p.refundsCounted).toBe(0);
    expect(p.refundsOwedInFull).toBe(0);
    expect(p.goingOut).toBe(LIVE.payoutsStillToGoOut);
  });
});

describe("the sentence", () => {
  it("names the shortfall and what it means", () => {
    const s = endOfCycleSentence(endOfCycle({ ...LIVE, refunds: [TSION] }), formatMoney);
    expect(s).toContain("finishes $5,075 short");
    expect(s).toContain("find yourself");
  });

  it("ALWAYS states the assumption", () => {
    // A projection read as settled fact is worse than no projection.
    for (const refunds of [[TSION], [{ ...TSION, counted: false }], []]) {
      const s = endOfCycleSentence(endOfCycle({ ...LIVE, refunds }), formatMoney);
      expect(s).toContain("assumes every remaining contribution arrives");
    }
  });

  it("a surplus is not called his", () => {
    const p = endOfCycle({ ...LIVE, inHand: 5_000_000, refunds: [] });
    const s = endOfCycleSentence(p, formatMoney);
    expect(s).toContain("left over");
    expect(s).toContain("not yours to spend");
  });

  it("always answers, with or without a counted reading", () => {
    // It used to refuse until he had typed one in, because the sum rested on
    // one. It rests on the derived position now, which exists from the first
    // payment onward.
    const s = endOfCycleSentence(endOfCycle({ ...LIVE, refunds: [TSION] }), formatMoney);
    expect(s).toContain("finishes");
    expect(s).not.toContain("Enter what you are holding");
  });

  it("plain English only — the banned register never appears", () => {
    // The same list the cash sentence is held to. "net" is on it, which is why
    // this module says "what actually crosses the table" instead.
    const banned = /\b(uncommitted|committed|owed forward|claimed|free|net|reconcil\w*)\b/i;
    for (const inHand of [0, 1_765_000, 5_000_000, 20_000_000]) {
      for (const refunds of [[TSION], [{ ...TSION, counted: false }], []]) {
        const s = endOfCycleSentence(endOfCycle({ ...LIVE, inHand, refunds }), formatMoney);
        expect(s, s).not.toMatch(banned);
        expect(s).not.toContain("NaN");
        expect(s).not.toContain("$-");
      }
    }
  });
});

// ————————————————— THE PARTITION —————————————————
//
// The bug this is the guard for: the buckets were two INDEPENDENT filters
// reading two different clocks, so the week the cycle was in matched neither
// and $12,125 fell out of the sum. The projection said the cycle would finish
// $12,750 short when the truth was $625.
//
// The property is the point. Not "week 14 is handled" — that fixes one week.
// EVERY week's uncollected money is in exactly one bucket, whatever the two
// clocks happen to be doing relative to each other.
describe("every week lands in exactly one bucket", () => {
  const week = (weekNumber: number, expected: number, received: number, elapsed: boolean) => ({
    weekNumber,
    expected,
    received,
    elapsed,
  });

  it("THE LIVE SHAPE: the current week is not lost", () => {
    // Weeks 1-13 elapsed, week 14 arrived with its window still open, 15+ not
    // arrived. This is exactly the shape that broke.
    const series = [
      week(13, 1_862_500, 1_312_500, true),
      week(14, 1_962_500, 750_000, false),
      week(15, 1_962_500, 275_000, false),
    ];
    const b = bucketOutstanding({ series, currentWeek: 14 });
    expect(b.overdue).toBe(550_000);
    expect(b.currentWeekOutstanding).toBe(1_212_500);
    expect(b.notYetDue).toBe(1_687_500);
    expect(b.total).toBe(550_000 + 1_212_500 + 1_687_500);
  });

  it("the three buckets sum to the total uncollected across ALL weeks", () => {
    const series = [
      week(1, 100, 100, true),
      week(2, 500, 200, true),
      week(3, 700, 0, true),
      week(4, 900, 400, false),
      week(5, 300, 300, false),
      week(6, 1000, 0, false),
    ];
    for (let currentWeek = 0; currentWeek <= 7; currentWeek++) {
      const b = bucketOutstanding({ series, currentWeek });
      const totalUncollected = series.reduce((s, w) => s + Math.max(0, w.expected - w.received), 0);
      expect(
        b.overdue + b.currentWeekOutstanding + b.notYetDue,
        `currentWeek ${currentWeek} lost money`,
      ).toBe(totalUncollected);
      expect(b.total).toBe(totalUncollected);
    }
  });

  it("holds when the two clocks disagree by any distance", () => {
    // elapsed lags currentWeek by 0, 1, 2 ... weeks. The gap between them is
    // exactly where the money used to vanish.
    for (let lag = 0; lag <= 5; lag++) {
      const series = Array.from({ length: 12 }, (_, i) =>
        week(i + 1, 1000, i % 3 === 0 ? 250 : 0, i + 1 <= 8 - lag),
      );
      const b = bucketOutstanding({ series, currentWeek: 8 });
      const total = series.reduce((s, w) => s + Math.max(0, w.expected - w.received), 0);
      expect(b.overdue + b.currentWeekOutstanding + b.notYetDue, `lag ${lag}`).toBe(total);
    }
  });

  it("a week paid in full contributes to nothing", () => {
    const b = bucketOutstanding({ series: [week(1, 500, 500, true)], currentWeek: 1 });
    expect(b.total).toBe(0);
  });

  it("overpayment on one week never offsets a shortfall on another", () => {
    // max(0, ...) per week. A member paying double in week 2 does not make
    // week 1's missing money disappear.
    const b = bucketOutstanding({
      series: [week(1, 500, 0, true), week(2, 500, 1500, true)],
      currentWeek: 2,
    });
    expect(b.overdue).toBe(500);
  });

  it("no weeks at all is zero, not NaN", () => {
    const b = bucketOutstanding({ series: [], currentWeek: 3 });
    expect(b.total).toBe(0);
    expect(Number.isFinite(b.total)).toBe(true);
  });

  it("the projection's comingIn IS the total — no bucket can be forgotten", () => {
    // `comingIn` reads outstanding.total rather than adding named fields, so
    // adding a fourth bucket later cannot silently drop it from the sum.
    const outstanding = bucketOutstanding({
      series: [week(1, 1000, 0, true), week(2, 1000, 0, false), week(3, 1000, 0, false)],
      currentWeek: 2,
    });
    const p = endOfCycle({ ...LIVE, outstanding, refunds: [] });
    expect(p.comingIn).toBe(outstanding.total);
    expect(p.arrears + p.currentWeekOutstanding + p.futureContributions).toBe(p.comingIn);
  });
});
