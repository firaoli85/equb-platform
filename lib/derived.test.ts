import { describe, expect, it } from "vitest";
import {
  amountDeferred,
  amountOutstanding,
  PAYMENT_WINDOW_DAYS,
  paymentStatus,
  weeksBehind,
  weeksCredited,
} from "./derived";

const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("weeksCredited (2.14: money ÷ current rate)", () => {
  it("credits whole weeks", () => {
    expect(weeksCredited(150_000, 25_000)).toBe(6);
    expect(weeksCredited(0, 25_000)).toBe(0);
  });

  it("rate change mid-cycle: $1,500 at a new $500 rate is 3 weeks — automatic", () => {
    expect(weeksCredited(150_000, 25_000)).toBe(6); // before the change
    expect(weeksCredited(150_000, 50_000)).toBe(3); // after — they are now behind
  });

  it("floors partial weeks ($1,000 at $450/wk covers 2 weeks)", () => {
    expect(weeksCredited(100_000, 45_000)).toBe(2);
  });

  it("rejects a non-positive weekly amount", () => {
    expect(() => weeksCredited(100, 0)).toThrow(RangeError);
    expect(() => weeksCredited(100.5, 100)).toThrow(RangeError);
  });
});

describe("weeksBehind (never below zero; only SKIPPED weeks are excused)", () => {
  it("elapsed minus credited", () => {
    expect(weeksBehind(5, 3, 0)).toBe(2);
    expect(weeksBehind(6, 6, 0)).toBe(0);
  });

  it("never below zero when paid ahead", () => {
    expect(weeksBehind(3, 7, 0)).toBe(0);
  });

  it("SKIPPED weeks never count as behind — nobody owed them", () => {
    expect(weeksBehind(6, 3, 2)).toBe(1);
    expect(weeksBehind(4, 0, 4)).toBe(0);
  });

  // THIS FUNCTION NEVER SEES DEFERRAL, and after D-42 that matters more, not
  // less. Its caller decides which weeks are elapsed; `weekCountsAsDue` now
  // drops deferred weeks before they reach here (§2.29a), so a deferred week
  // is excluded by never being counted, not by being subtracted. Six weeks
  // that DO count as due, three covered, leaves three behind.
  it("subtracts only what it is given — deferral is handled by the caller", () => {
    expect(weeksBehind(6, 3, 0)).toBe(3);
  });

  it("rate-change follow-through: 6 elapsed, newly credited 3 -> 3 behind", () => {
    expect(weeksBehind(6, weeksCredited(150_000, 50_000), 0)).toBe(3);
  });
});

describe("paymentStatus (derived from money and the calendar only)", () => {
  const weekDate = utc("2026-05-17"); // a Sunday
  const base = { amountDue: 25_000, isDeferred: false, weekDate };

  it("PAID at or above the due amount, regardless of dates", () => {
    expect(paymentStatus({ ...base, amountPaid: 25_000, today: utc("2027-01-01") })).toBe("PAID");
    expect(paymentStatus({ ...base, amountPaid: 30_000, today: utc("2026-05-17") })).toBe("PAID");
  });

  it("SKIPPED wins over everything — the week did not happen for anyone", () => {
    expect(
      paymentStatus({ ...base, isSkipped: true, amountPaid: 0, today: utc("2027-01-01") }),
    ).toBe("SKIPPED");
    expect(
      paymentStatus({ ...base, isSkipped: true, isDeferred: true, amountPaid: 25_000, today: utc("2026-05-17") }),
    ).toBe("SKIPPED");
  });

  it("DEFERRED stands exactly where LATE would — and nowhere else", () => {
    // Window long closed, nothing paid: LATE is suppressed, DEFERRED shows.
    expect(
      paymentStatus({ ...base, isDeferred: true, amountPaid: 0, today: utc("2027-01-01") }),
    ).toBe("DEFERRED");
    // Window still open, nothing paid: still DEFERRED, not UNPAID — the
    // organizer flagged it, so the flag is what the screen should say.
    expect(
      paymentStatus({ ...base, isDeferred: true, amountPaid: 0, today: utc("2026-05-17") }),
    ).toBe("DEFERRED");
  });

  it("PAID BEATS DEFERRED — a deferred week covered by money reads PAID", () => {
    expect(
      paymentStatus({ ...base, isDeferred: true, amountPaid: 25_000, today: utc("2026-05-17") }),
    ).toBe("PAID");
    expect(
      paymentStatus({ ...base, isDeferred: true, amountPaid: 30_000, today: utc("2027-01-01") }),
    ).toBe("PAID");
  });

  it("a PARTIALLY paid deferred week is DEFERRED, never LATE", () => {
    expect(
      paymentStatus({ ...base, isDeferred: true, amountPaid: 10_000, today: utc("2027-01-01") }),
    ).toBe("DEFERRED");
  });

  it("UNPAID while the window is open (Sunday start, Thursday still open)", () => {
    expect(paymentStatus({ ...base, amountPaid: 0, today: utc("2026-05-17") })).toBe("UNPAID");
    expect(paymentStatus({ ...base, amountPaid: 0, today: utc("2026-05-21") })).toBe("UNPAID");
  });

  it("LATE from the day the window closes (Friday, day 5)", () => {
    expect(paymentStatus({ ...base, amountPaid: 0, today: utc("2026-05-22") })).toBe("LATE");
    expect(paymentStatus({ ...base, amountPaid: 0, today: utc("2026-08-01") })).toBe("LATE");
  });

  it("PARTIAL with some money while open; LATE once closed (2.16: late is derived)", () => {
    expect(paymentStatus({ ...base, amountPaid: 10_000, today: utc("2026-05-20") })).toBe("PARTIAL");
    expect(paymentStatus({ ...base, amountPaid: 10_000, today: utc("2026-05-22") })).toBe("LATE");
  });

  it("a future week is simply UNPAID", () => {
    expect(paymentStatus({ ...base, amountPaid: 0, today: utc("2026-05-10") })).toBe("UNPAID");
  });

  it("respects a custom window length", () => {
    const args = { ...base, amountPaid: 0, today: utc("2026-05-23"), windowClosesDays: 7 };
    expect(paymentStatus(args)).toBe("UNPAID"); // day 6 of a 7-day window
    expect(paymentStatus({ ...args, today: utc("2026-05-24") })).toBe("LATE"); // day 7
  });

  it("the default window is 5 days (Sunday start, Thursday close)", () => {
    expect(PAYMENT_WINDOW_DAYS).toBe(5);
  });
});

describe("amountOutstanding", () => {
  it("the 2.19 profile example: weeks 8–12 unpaid at $250 -> $1,250 behind", () => {
    const window = [8, 9, 10, 11, 12].map(() => ({
      amountDue: 25_000,
      amountAlreadyPaid: 0,
      isDeferred: false,
    }));
    expect(amountOutstanding(window)).toBe(125_000);
  });

  it("nets surplus against debt — money is fungible (2.14)", () => {
    // Due on weeks that were not SKIPPED: 4 x $250 = $1,000. Paid anywhere:
    // $750. The $150 surplus on the overpaid week offsets other debt.
    expect(
      amountOutstanding([
        { amountDue: 25_000, amountAlreadyPaid: 25_000, isDeferred: false }, // paid
        { amountDue: 25_000, amountAlreadyPaid: 10_000, isDeferred: false }, // short
        { amountDue: 25_000, amountAlreadyPaid: 0, isSkipped: true, isDeferred: false }, // no due
        { amountDue: 25_000, amountAlreadyPaid: 40_000, isDeferred: false }, // surplus counts
        { amountDue: 25_000, amountAlreadyPaid: 0, isDeferred: false }, // fully owed
      ]),
    ).toBe(25_000);
  });

  // AMENDED BY D-42 (§2.29a, 15 Aug 2026). Until then a deferred week counted
  // here in full, and this test asserted 50_000. It is paused now, not
  // forgiven: its money moves to `amountDeferred`, and the two together are
  // still the whole debt.
  it("DEFERRED weeks are NOT owed right now — they leave outstanding (D-42)", () => {
    const weeks = [
      { amountDue: 25_000, amountAlreadyPaid: 0, isDeferred: true },
      { amountDue: 25_000, amountAlreadyPaid: 0, isDeferred: false },
    ];
    expect(amountOutstanding(weeks)).toBe(25_000);
    expect(amountDeferred(weeks)).toBe(25_000);
    // NOTHING IS LOST — the partition is exact.
    expect(amountOutstanding(weeks) + amountDeferred(weeks)).toBe(50_000);
  });

  it("a part-paid deferred week keeps its receipt with it, not in what is owed", () => {
    const weeks = [{ amountDue: 25_000, amountAlreadyPaid: 10_000, isDeferred: true }];
    expect(amountOutstanding(weeks)).toBe(0);
    expect(amountDeferred(weeks)).toBe(15_000);
  });

  it("a SKIPPED week holds nothing, deferred or not — nobody ever owed it", () => {
    expect(
      amountDeferred([
        { amountDue: 25_000, amountAlreadyPaid: 0, isDeferred: true, isSkipped: true },
      ]),
    ).toBe(0);
  });

  it("SKIPPED weeks are still fully excused — they contribute nothing", () => {
    expect(
      amountOutstanding([
        { amountDue: 25_000, amountAlreadyPaid: 0, isSkipped: true, isDeferred: false },
        { amountDue: 25_000, amountAlreadyPaid: 0, isSkipped: true, isDeferred: true },
        { amountDue: 25_000, amountAlreadyPaid: 0, isDeferred: false },
      ]),
    ).toBe(25_000);
  });

  it("money recorded on a SKIPPED week still counts — it is money", () => {
    expect(
      amountOutstanding([
        { amountDue: 25_000, amountAlreadyPaid: 25_000, isSkipped: true, isDeferred: false },
        { amountDue: 25_000, amountAlreadyPaid: 0, isDeferred: false },
      ]),
    ).toBe(0);
  });

  it("rate decrease leaves no stranded debt: 6 weeks paid at the old higher rate", () => {
    // Paid $500/wk for 6 weeks ($3,000 recorded), rate lowered to $250, 8
    // weeks elapsed: due 8 x $250 = $2,000 < $3,000 paid -> nothing owed,
    // agreeing with weeksCredited(300_000, 25_000) = 12 and weeksBehind = 0.
    const window = [
      ...Array.from({ length: 6 }, () => ({
        amountDue: 25_000,
        amountAlreadyPaid: 50_000,
        isDeferred: false,
      })),
      ...Array.from({ length: 2 }, () => ({
        amountDue: 25_000,
        amountAlreadyPaid: 0,
        isDeferred: false,
      })),
    ];
    expect(amountOutstanding(window)).toBe(0);
    expect(weeksBehind(8, weeksCredited(300_000, 25_000), 0)).toBe(0);
  });

  it("a single overpaid week is never negative", () => {
    expect(amountOutstanding([{ amountDue: 25_000, amountAlreadyPaid: 40_000, isDeferred: false }])).toBe(0);
  });

  it("empty window owes nothing", () => {
    expect(amountOutstanding([])).toBe(0);
  });

  it("rejects fractional cents", () => {
    expect(() =>
      amountOutstanding([{ amountDue: 100.5, amountAlreadyPaid: 0, isDeferred: false }]),
    ).toThrow(RangeError);
  });
});
