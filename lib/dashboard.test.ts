import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cashPosition,
  cashSeries,
  receivedByMember,
  receiptsByWeek,
  memberAttention,
  standingIssues,
  weekReceipts,
  weekMemberStatus,
  type DashboardParticipation,
  type DashboardPayment,
} from "./dashboard";

describe("cashPosition — pinned to the REAL imported Cycle 1 figures", () => {
  it("reproduces the verified import: $197,175 in, $124,950 out, $72,225 held, $49,000 pending", () => {
    // The payout rows below are the EXACT live books after the Cycle 1
    // import (queried 2026-08-04): 9 collected, 5 drawn-but-pending. A
    // regression in any summation breaks against reality, not a toy.
    const payments = [
      { amountPaid: 19_717_500 - 500_000 }, // the bulk...
      { amountPaid: 500_000 }, // ...plus a second row so summation is exercised
    ];
    const payouts = [
      // 5 drawn but pending totalling $49,000 — already owed out
      { netAmount: 490_000, status: "PENDING" as const },
      { netAmount: 980_000, status: "PENDING" as const },
      { netAmount: 980_000, status: "PENDING" as const },
      { netAmount: 980_000, status: "PENDING" as const },
      { netAmount: 1_470_000, status: "PENDING" as const },
      // 9 collected totalling $124,950
      { netAmount: 490_000, status: "COLLECTED" as const },
      { netAmount: 490_000, status: "COLLECTED" as const },
      { netAmount: 490_000, status: "COLLECTED" as const },
      { netAmount: 1_225_000, status: "COLLECTED" as const },
      { netAmount: 1_960_000, status: "COLLECTED" as const },
      { netAmount: 1_960_000, status: "COLLECTED" as const },
      { netAmount: 1_960_000, status: "COLLECTED" as const },
      { netAmount: 1_960_000, status: "COLLECTED" as const },
      { netAmount: 1_960_000, status: "COLLECTED" as const },
    ];
    const position = cashPosition({ payments, payouts });
    expect(position.totalReceived).toBe(19_717_500); // $197,175.00
    expect(position.totalPaidOut).toBe(12_495_000); // $124,950.00
    expect(position.currentlyHeld).toBe(7_222_500); // $72,225.00
    expect(position.committedPending).toBe(4_900_000); // $49,000.00
    expect(position.uncommitted).toBe(2_322_500); // $23,225.00
    expect(position.pendingPayoutCount).toBe(5);
  });

  it("empty books are all zero", () => {
    expect(cashPosition({ payments: [], payouts: [] })).toEqual({
      totalReceived: 0,
      totalPaidOut: 0,
      currentlyHeld: 0,
      committedPending: 0,
      uncommitted: 0,
      pendingPayoutCount: 0,
    });
  });

  it("rejects fractional cents", () => {
    expect(() => cashPosition({ payments: [{ amountPaid: 10.5 }], payouts: [] })).toThrow(RangeError);
  });
});

const participations: (DashboardParticipation & { name: string })[] = [
  { id: "a", name: "Early", weeklyAmount: 25_000, startWeek: 1, weeksCommitted: 20 },
  { id: "b", name: "Late", weeklyAmount: 50_000, startWeek: 12, weeksCommitted: 9 },
];

function pay(
  participationId: string,
  weekNumber: number,
  amountPaid: number,
  isDeferred = false,
  isSkipped = false,
  // The organizer marking a week late himself (2.2) — off unless a test
  // is about it, exactly like the two flags above.
  markedLate = false,
): DashboardPayment {
  return { participationId, weekNumber, amountPaid, isDeferred, isSkipped, markedLate };
}

describe("weekReceipts — window-aware (2.7)", () => {
  it("a week-12 joiner is NOT expected in week 5", () => {
    const week5 = weekReceipts({
      weekNumber: 5,
      participations,
      payments: [pay("a", 5, 25_000)],
    });
    expect(week5.expected).toBe(25_000); // only the early member
    expect(week5.received).toBe(25_000);
    expect(week5.membersExpected).toBe(1);
    expect(week5.membersPaid).toBe(1);
    expect(week5.shortfall).toBe(0);
  });

  it("both members expected once both windows cover the week", () => {
    const week12 = weekReceipts({
      weekNumber: 12,
      participations,
      payments: [pay("a", 12, 25_000)],
    });
    expect(week12.expected).toBe(75_000);
    expect(week12.membersExpected).toBe(2);
    expect(week12.membersPaid).toBe(1);
    expect(week12.shortfall).toBe(50_000);
  });

  it("deferred members are excused from expectation", () => {
    const week3 = weekReceipts({
      weekNumber: 3,
      participations,
      payments: [pay("a", 3, 0, true)],
    });
    expect(week3.expected).toBe(0);
    expect(week3.membersExpected).toBe(0);
  });

  it("a skipped week expects nothing but still shows money that arrived", () => {
    const week4 = weekReceipts({
      weekNumber: 4,
      isSkipped: true,
      participations,
      payments: [pay("a", 4, 10_000)],
    });
    expect(week4.expected).toBe(0);
    expect(week4.received).toBe(10_000);
    expect(week4.shortfall).toBe(0);
  });

  it("a partial payment does not count the member as paid", () => {
    const week1 = weekReceipts({
      weekNumber: 1,
      participations,
      payments: [pay("a", 1, 10_000)],
    });
    expect(week1.membersPaid).toBe(0);
    expect(week1.received).toBe(10_000);
  });
});

describe("receiptsByWeek", () => {
  it("produces the ordered series with per-week windows applied", () => {
    const series = receiptsByWeek({
      weeks: [
        { weekNumber: 2, isSkipped: false },
        { weekNumber: 1, isSkipped: false },
        { weekNumber: 13, isSkipped: false },
      ],
      participations,
      payments: [pay("a", 1, 25_000), pay("b", 13, 50_000)],
      elapsedThroughWeek: 2,
    });
    expect(series.map((w) => w.weekNumber)).toEqual([1, 2, 13]);
    // One rule, stamped once: the charts read this rather than re-deriving it.
    expect(series.map((w) => w.elapsed)).toEqual([true, true, false]);
    expect(series[0].expected).toBe(25_000);
    expect(series[2].expected).toBe(75_000); // both in window at week 13
    expect(series[2].received).toBe(50_000);
  });
});

describe("receivedByMember — what the received figure is made of", () => {
  it("totals per member, largest first, zeros included", () => {
    const result = receivedByMember({
      participations: [
        { id: "a", name: "Early" },
        { id: "b", name: "Late" },
        { id: "c", name: "Nothing" },
      ],
      payments: [
        { participationId: "a", amountPaid: 25_000 },
        { participationId: "a", amountPaid: 25_000 },
        { participationId: "b", amountPaid: 150_000 },
      ],
    });
    expect(result).toEqual([
      { participationId: "b", name: "Late", total: 150_000 },
      { participationId: "a", name: "Early", total: 50_000 },
      { participationId: "c", name: "Nothing", total: 0 },
    ]);
  });
});

describe("weekMemberStatus — who has paid and who has not", () => {
  // AN OPEN WEEK. These cases are about PAID / PARTIAL / UNPAID / DEFERRED,
  // and every one of them turns LATE the moment the window shuts — which is
  // the whole point of the fix below and would drown these assertions.
  const OPEN = { weekDate: new Date("2026-08-09T00:00:00Z"), today: new Date("2026-08-10T00:00:00Z") };
  it("classifies in-window members and skips out-of-window ones", () => {
    const rows = weekMemberStatus({
      weekNumber: 5,
      ...OPEN,
      participations,
      payments: [pay("a", 5, 25_000)],
    });
    // Late (week-12 joiner) is out of window at week 5 — not listed at all.
    expect(rows).toEqual([
      {
        participationId: "a",
        name: "Early",
        weeklyAmount: 25_000,
        amountPaid: 25_000,
        status: "PAID",
        markedLate: false,
      },
    ]);
  });

  it("distinguishes PARTIAL, UNPAID, and DEFERRED", () => {
    const many = [
      { id: "p", name: "Part", weeklyAmount: 25_000, startWeek: 1, weeksCommitted: 20 },
      { id: "u", name: "Unpaid", weeklyAmount: 25_000, startWeek: 1, weeksCommitted: 20 },
      { id: "d", name: "Deferred", weeklyAmount: 25_000, startWeek: 1, weeksCommitted: 20 },
    ];
    const rows = weekMemberStatus({
      weekNumber: 2,
      ...OPEN,
      participations: many,
      payments: [pay("p", 2, 10_000), pay("d", 2, 0, true)],
    });
    expect(rows.map((r) => [r.name, r.status])).toEqual([
      ["Deferred", "DEFERRED"],
      ["Part", "PARTIAL"],
      ["Unpaid", "UNPAID"],
    ]);
  });
});

describe("memberAttention — worst first, deferred excluded", () => {
  it("finds who is behind, by how much, sorted worst first", () => {
    // Week 14: Early (from wk 1) has paid 10 of 14; Late (from wk 12) paid 0 of 3.
    const payments = [
      ...Array.from({ length: 10 }, (_, i) => pay("a", i + 1, 25_000)),
    ];
    const list = memberAttention({ participations, payments, elapsedThroughWeek: 14 });
    expect(list).toEqual([
      { participationId: "b", name: "Late", weeksBehind: 3, amountOwed: 150_000 },
      { participationId: "a", name: "Early", weeksBehind: 4, amountOwed: 100_000 },
    ]);
  });

  it("SKIPPED weeks never count as behind — nobody owed them", () => {
    const payments = [
      pay("a", 1, 25_000),
      pay("a", 2, 0, false, true), // the week did not happen for anyone
      pay("a", 3, 25_000),
    ];
    const list = memberAttention({
      participations: [participations[0]],
      payments,
      elapsedThroughWeek: 3,
    });
    expect(list).toEqual([]);
  });

  // AMENDED BY D-42 (§2.29a, 15 Aug 2026). This asserted the opposite until
  // then — one week behind, on the attention list. A paused week is one the
  // organizer has agreed not to chase, and the attention list is the chase, so
  // a member whose only gap is deferred does not belong on it. The money is not
  // forgiven: it sits in `amountDeferred` and resolves at close.
  it("a member whose only gap is DEFERRED is not on the attention list (D-42)", () => {
    const payments = [
      pay("a", 1, 25_000),
      pay("a", 2, 0, true), // deferred: paused, not chased
      pay("a", 3, 25_000),
    ];
    const list = memberAttention({
      participations: [participations[0]],
      payments,
      elapsedThroughWeek: 3,
    });
    expect(list).toEqual([]);
  });

  it("but an UNPAID week beside a deferred one still brings them onto it", () => {
    // The deferred week leaves the count; the genuinely unpaid one does not.
    const payments = [pay("a", 1, 25_000), pay("a", 2, 0, true), pay("a", 3, 0)];
    const list = memberAttention({
      participations: [participations[0]],
      payments,
      elapsedThroughWeek: 3,
    });
    expect(list).toHaveLength(1);
    expect(list[0].weeksBehind).toBe(1);
    expect(list[0].amountOwed).toBe(25_000);
  });

  it("weeks with no stored row still count as owed", () => {
    const list = memberAttention({
      participations: [participations[0]],
      payments: [], // nothing recorded at all
      elapsedThroughWeek: 4,
    });
    expect(list).toEqual([
      { participationId: "a", name: "Early", weeksBehind: 4, amountOwed: 100_000 },
    ]);
  });

  it("paid-ahead members never appear", () => {
    const payments = [pay("a", 1, 250_000)]; // 10 weeks of money in week 1
    expect(
      memberAttention({ participations: [participations[0]], payments, elapsedThroughWeek: 5 }),
    ).toEqual([]);
  });
});

// ————————————————————————————————————————————————————————————————
// THE CASH POSITION OVER TIME (ADMIN_IA §5.2)
//
// A production-shaped cycle: 20 weeks, money coming in every week, six weeks
// drawn, one winner still waiting to collect. The figures below are the ones
// a chart draws, so what is tested is the thing the organizer READS.
// ————————————————————————————————————————————————————————————————

describe("the cash position week by week", () => {
  const weeks = Array.from({ length: 20 }, (_, i) => ({ weekNumber: i + 1 }));

  // 27 members × $1,000/week, in cents. Weeks 1-6 fully paid, week 7 partial.
  const payments = [
    ...Array.from({ length: 6 }, (_, i) => ({
      weekNumber: i + 1,
      amountPaid: 2_700_000,
    })),
    { weekNumber: 7, amountPaid: 1_800_000 },
  ];

  const payouts = [
    { weekNumber: 1, netAmount: 2_646_000, status: "COLLECTED" as const },
    { weekNumber: 2, netAmount: 2_646_000, status: "COLLECTED" as const },
    { weekNumber: 3, netAmount: 2_646_000, status: "COLLECTED" as const },
    { weekNumber: 4, netAmount: 2_646_000, status: "COLLECTED" as const },
    { weekNumber: 5, netAmount: 2_646_000, status: "COLLECTED" as const },
    { weekNumber: 6, netAmount: 2_646_000, status: "PENDING" as const },
  ];

  const series = cashSeries({ weeks, payments, payouts, elapsedThroughWeek: 6 });

  it("has one point per week, in order", () => {
    expect(series).toHaveLength(20);
    expect(series.map((p) => p.weekNumber)).toEqual(weeks.map((w) => w.weekNumber));
  });

  it("runs the held position forward rather than reporting each week alone", () => {
    // Week 1: in 2,700,000, out 2,646,000 → 54,000 held.
    expect(series[0].held).toBe(54_000);
    // Week 2 adds the same movement again: the position ACCUMULATES.
    expect(series[1].held).toBe(108_000);
    expect(series[4].held).toBe(270_000);
  });

  it("does not let a PENDING payout reduce the position — the cash has not left", () => {
    // Week 6 was drawn but not collected, so held rises by the full receipt.
    expect(series[5].paidOut).toBe(0);
    expect(series[5].pendingOut).toBe(2_646_000);
    expect(series[5].held).toBe(series[4].held + 2_700_000);
  });

  it("agrees exactly with cashPosition — the chart and the stat card are one figure", () => {
    // The whole point of 2.14: two screens showing the same money must not be
    // able to disagree. The last point of the series IS currentlyHeld.
    const snapshot = cashPosition({
      payments: payments.map((p) => ({ amountPaid: p.amountPaid })),
      payouts,
    });
    expect(series[series.length - 1].held).toBe(snapshot.currentlyHeld);
    const pending = series.reduce((s, p) => s + p.pendingOut, 0);
    expect(pending).toBe(snapshot.committedPending);
  });

  it("marks the elapsed/to-come divider from the week window, not from data", () => {
    // Week 7 has real money in it and is still OPEN. Drawing it as an actual
    // would show a collapse in the position that has not happened.
    expect(series[6].received).toBe(1_800_000);
    expect(series[6].elapsed).toBe(false);
    expect(series[5].elapsed).toBe(true);
    expect(series.filter((p) => p.elapsed)).toHaveLength(6);
  });

  it("keeps weeks with no movement at zero rather than dropping them", () => {
    // A gap in the axis would compress time and make the slope a lie.
    expect(series[10].received).toBe(0);
    expect(series[10].paidOut).toBe(0);
    expect(series[10].held).toBe(series[9].held);
  });

  it("folds a payout with no draw into the first week rather than losing it", () => {
    const undrawn = cashSeries({
      weeks,
      payments: [{ weekNumber: 1, amountPaid: 2_700_000 }],
      payouts: [{ weekNumber: null, netAmount: 1_000_000, status: "COLLECTED" }],
      elapsedThroughWeek: 1,
    });
    // Dropping it would make the chart's final held disagree with the stat card.
    expect(undrawn[0].paidOut).toBe(1_000_000);
    expect(undrawn[19].held).toBe(1_700_000);
  });

  it("refuses a non-integer or negative amount rather than drawing it", () => {
    expect(() =>
      cashSeries({
        weeks,
        payments: [{ weekNumber: 1, amountPaid: 12.5 }],
        payouts: [],
        elapsedThroughWeek: 1,
      }),
    ).toThrow(RangeError);
  });

  it("survives an empty cycle without inventing a position", () => {
    expect(cashSeries({ weeks: [], payments: [], payouts: [], elapsedThroughWeek: 0 })).toEqual([]);
  });
});

// A CLOSED WINDOW MAKES A WEEK LATE, HOWEVER IT BECAME LATE.
//
// THE REPORTED DEFECT, reproduced exactly. Week 12's window closed on 7 August
// 2026. Read on the 13th, /admin/this-week showed:
//
//     "Marked late 0 — Nobody."
//     "Have not paid 7"  ← Mulualem, Markos, Miraf, Surashe, Alex, Getahun, Firaoli
//
// All seven were LATE: unpaid, and the window had shut six days earlier.
// `paymentStatus` had been returning LATE for those rows the whole time —
// `weekMemberStatus` was not asking it. It carried its own copy of the status
// ladder, and that copy had no date and no clock, so the ONLY route to LATE it
// could see was the organizer's manual mark.
//
// COULD NOT HAVE PASSED BEFORE: every assertion below turns on a week whose
// window has closed, and the old implementation could not produce LATE for one.
describe("weekMemberStatus — the closed-window collapse (2.19: one engine)", () => {
  // The live figures: week 12 fell on Sunday 2 August, so its five-day window
  // shut on the 7th. Today is the 13th.
  const WEEK_12 = new Date("2026-08-02T00:00:00Z");
  const THE_13TH = new Date("2026-08-13T00:00:00Z");

  const seven = [
    "Mulualem",
    "Markos",
    "Miraf",
    "Surashe",
    "Alex",
    "Getahun",
    "Firaoli",
  ].map((name) => ({
    id: name.toLowerCase(),
    name,
    weeklyAmount: 50_000,
    startWeek: 1,
    weeksCommitted: 20,
  }));

  const rowsOn = (today: Date, over: Partial<DashboardPayment> = {}) =>
    weekMemberStatus({
      weekNumber: 12,
      weekDate: WEEK_12,
      today,
      participations: seven,
      payments: seven.map((p) => ({
        participationId: p.id,
        weekNumber: 12,
        amountPaid: 0,
        isDeferred: false,
        isSkipped: false,
        markedLate: false,
        ...over,
      })),
    });

  it("puts every unpaid member in LATE once the window has closed", () => {
    const rows = rowsOn(THE_13TH);
    expect(rows).toHaveLength(7);
    expect(rows.every((r) => r.status === "LATE")).toBe(true);
  });

  // THE HEADLINE. "Have not paid" is the label for a week still OPEN, and the
  // screen was filing seven closed-window members under it.
  it("puts NONE of them in UNPAID", () => {
    expect(rowsOn(THE_13TH).filter((r) => r.status === "UNPAID")).toEqual([]);
  });

  // …and none of them was marked by hand, which is why the "Marked late"
  // section read 0 while seven people were late.
  it("reports them late WITHOUT any manual mark", () => {
    expect(rowsOn(THE_13TH).every((r) => r.markedLate === false)).toBe(true);
  });

  // THE OTHER SIDE OF THE SAME RULE: while the window is open they are not
  // late, and calling them late would be an accusation before the deadline.
  it("still reads UNPAID while the window is open", () => {
    const dayFour = new Date("2026-08-06T00:00:00Z");
    const rows = rowsOn(dayFour);
    expect(rows.every((r) => r.status === "UNPAID")).toBe(true);
  });

  it("flips exactly on the day the window shuts", () => {
    expect(rowsOn(new Date("2026-08-06T00:00:00Z"))[0].status).toBe("UNPAID");
    expect(rowsOn(new Date("2026-08-07T00:00:00Z"))[0].status).toBe("LATE");
  });

  // THE MARK IS ONE ROUTE, NOT A CATEGORY. A marked member on a closed week is
  // in the same section as everyone else, with a note on the row.
  it("does not separate a marked member from a calendar-late one", () => {
    const rows = weekMemberStatus({
      weekNumber: 12,
      weekDate: WEEK_12,
      today: THE_13TH,
      participations: seven.slice(0, 2),
      payments: [
        { participationId: "mulualem", weekNumber: 12, amountPaid: 0, isDeferred: false, isSkipped: false, markedLate: true },
        { participationId: "markos", weekNumber: 12, amountPaid: 0, isDeferred: false, isSkipped: false, markedLate: false },
      ],
    });
    expect(rows.map((r) => r.status)).toEqual(["LATE", "LATE"]);
    // …and the row still says which is which.
    expect(rows.find((r) => r.name === "Mulualem")!.markedLate).toBe(true);
    expect(rows.find((r) => r.name === "Markos")!.markedLate).toBe(false);
  });

  // Money and the standing decisions still win over the calendar.
  it("PAID, DEFERRED and SKIPPED all still beat a closed window", () => {
    const one = [seven[0]];
    const status = (over: Partial<DashboardPayment>, isSkipped = false) =>
      weekMemberStatus({
        weekNumber: 12,
        weekDate: WEEK_12,
        today: THE_13TH,
        isSkipped,
        participations: one,
        payments: [
          { participationId: "mulualem", weekNumber: 12, amountPaid: 0, isDeferred: false, isSkipped: false, markedLate: false, ...over },
        ],
      })[0].status;

    expect(status({ amountPaid: 50_000 })).toBe("PAID");
    expect(status({ isDeferred: true })).toBe("DEFERRED");
    expect(status({}, true)).toBe("SKIPPED");
    // A partial payment on a CLOSED week is late, not "partially paid" — the
    // money did not arrive in time, and PARTIAL is an open-window state.
    expect(status({ amountPaid: 20_000 })).toBe("LATE");
  });
});

// The screen must not reintroduce a category for the mark.
describe("the this-week screen groups by the derived status", () => {
  const src = readFileSync(
    join(import.meta.dirname, "..", "app/admin/(protected)/this-week/page.tsx"),
    "utf8",
  );

  it("has no section that counts only the manual mark", () => {
    expect(src).not.toContain('title: "Marked late"');
  });

  it("titles LATE from the shared vocabulary, not a hand-written phrase", () => {
    expect(src).toMatch(/key: "LATE", title: STATUS_LABELS\.LATE\.text/);
  });

  // "Have not paid" reads as a verdict; "have not paid YET" reads as a window
  // still open, which is what the section actually holds.
  it("says the unpaid section is a week still open", () => {
    expect(src).toContain('title: "Have not paid yet"');
    expect(src).toContain("the payment window for this week is still open");
  });

  it("notes the mark on the ROW instead", () => {
    expect(src).toMatch(/m\.markedLate && <Pill[^>]*>you marked this<\/Pill>/);
  });

  // RIGHT-SIZING (14 Aug 2026). Every group used to render a full Card
  // whether or not anyone was in it, and the grid stretched it to its
  // neighbour's height — so "Partially paid", a state that occurs about five
  // times in a cycle, sat beside a 27-row "Paid" card as a ~1,100px empty
  // panel. These pin the two halves of the fix.
  it("builds a card only for groups that have somebody in them", () => {
    expect(src).toMatch(/GROUPS\.filter\(\(\{ key \}\) => members\(key\)\.length > 0\)/);
    // The old always-render branch and its filler line are gone.
    expect(src).not.toContain(">Nobody.</p>");
  });

  it("does not let an empty card stretch to its neighbour's height", () => {
    // Without items-start a CSS grid row stretches every cell to the tallest,
    // which is the mechanism that made an empty bucket a full-height panel.
    expect(src).toMatch(/className="grid items-start[^"]*md:grid-cols-2/);
  });

  it("names the empty buckets in one line rather than dropping them", () => {
    // Dropping a bucket makes the reader wonder whether it was checked.
    expect(src).toContain("Nobody this week in");
    expect(src).toMatch(/variant="dashed"/);
  });

  it("states nobody-in-window BEFORE the buckets, not after six denials", () => {
    const empty = src.indexOf("Nobody is in their window this week.");
    const grid = src.indexOf('className="grid items-start');
    expect(empty).toBeGreaterThan(-1);
    expect(grid).toBeGreaterThan(-1);
    expect(empty).toBeLessThan(grid);
  });

  it("gives the member rows the same disc as every other member list", () => {
    expect(src).toMatch(/<InitialAvatar name=\{m\.name\} size="sm" \/>/);
  });
});

// WHO NEEDS AN ACTION THE MONEY COLUMNS CANNOT SHOW. Both states are
// invisible to memberAttention by construction: an unsigned member may be
// fully paid up, and a member who has paid NOTHING is not "behind" until a
// week of theirs closes — a new joiner sits at zero-behind and fell off every
// list. That fall-through is the defect this list exists to close.
describe("standingIssues — welcomed-but-unsigned, and never-paid-at-all", () => {
  const TODAY = new Date(Date.UTC(2026, 7, 13));
  const henok = {
    id: "part-henok",
    personId: "person-henok",
    name: "Henok",
    weeklyAmount: 100_000,
    weeksCommitted: 10,
    status: "ACTIVE" as const,
    agreementRequiredAt: null as Date | null,
    lastSignedAt: null as Date | null,
    totalPaid: 0,
    joinedAt: new Date(Date.UTC(2026, 7, 3)),
  };
  const payer = {
    ...henok,
    id: "part-payer",
    personId: "person-payer",
    name: "Tizita",
    totalPaid: 650_000,
  };

  // THE LIVE CASE, the one found on real data: committed to ten weeks at
  // $1,000, never paid a cent, on no list anywhere.
  it("reports a member who has never paid, with what is at stake", () => {
    const issues = standingIssues({ participations: [henok, payer], today: TODAY });
    expect(issues).toEqual([
      {
        personId: "person-henok",
        participationId: "part-henok",
        name: "Henok",
        kind: "never-paid",
        commitment: 1_000_000,
        daysWaiting: 10,
      },
    ]);
  });

  it("reports a welcomed member who has not signed, and for how long", () => {
    const welcomed = {
      ...payer,
      agreementRequiredAt: new Date(Date.UTC(2026, 7, 6)),
    };
    const issues = standingIssues({ participations: [welcomed], today: TODAY });
    expect(issues).toEqual([
      {
        personId: "person-payer",
        participationId: "part-payer",
        name: "Tizita",
        kind: "unsigned",
        commitment: 1_000_000,
        daysWaiting: 7,
      },
    ]);
  });

  // One row per person, and the gate's order: he ASKED them, so unsigned is
  // the fact he is waiting on — never-paid would double-report the same body.
  it("an unwelcomed unsigned unpaid member is one row, not two, and it is the asked one", () => {
    const both = { ...henok, agreementRequiredAt: new Date(Date.UTC(2026, 7, 6)) };
    const issues = standingIssues({ participations: [both], today: TODAY });
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("unsigned");
  });

  it("a signature answers the welcome, and the member leaves the list", () => {
    const signed = {
      ...payer,
      agreementRequiredAt: new Date(Date.UTC(2026, 7, 6)),
      lastSignedAt: new Date(Date.UTC(2026, 7, 7)),
    };
    expect(standingIssues({ participations: [signed], today: TODAY })).toEqual([]);
  });

  // FALSIFIABLE: drop the ACTIVE check and this fails — a stopped member has
  // left, and neither "sign this" nor "chase the first payment" is an action
  // about them. They are `stopped`'s job (2.18).
  it("never reports a stopped participation", () => {
    const stopped = { ...henok, status: "CLOSED" as const };
    expect(standingIssues({ participations: [stopped], today: TODAY })).toEqual([]);
  });

  it("orders by commitment — what is at stake is the reason to act", () => {
    const small = { ...henok, id: "p-s", personId: "pp-s", name: "Zed", weeklyAmount: 25_000 };
    const issues = standingIssues({ participations: [small, henok], today: TODAY });
    expect(issues.map((i) => i.name)).toEqual(["Henok", "Zed"]);
  });
});
