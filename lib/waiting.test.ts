import { describe, expect, it } from "vitest";
import {
  AT_RISK_WEEKS,
  daysBetween,
  isAtRisk,
  mostUrgent,
  runwayLabel,
  sortWaiting,
  waitedLabel,
  waitingTotals,
  type AwaitingPaymentRow,
  type AwaitingTurnRow,
} from "./waiting";

// The two groups mean different things and must never be merged: money OWED
// NOW versus money that will be owed eventually. These pin the split, the
// sorts, and 2.27's at-risk flag.

const owed = (over: Partial<AwaitingPaymentRow> = {}): AwaitingPaymentRow => ({
  kind: "awaiting-payment",
  payoutId: `p${over.number ?? 1}`,
  participationId: "pa1",
  personId: "pe1",
  name: "Alem",
  nameAmharic: "ዓለም",
  number: 1,
  weekNumber: 5,
  drawnAt: "2026-07-01T00:00:00.000Z",
  grossAmount: 2_000_000,
  feeAmount: 40_000,
  netAmount: 1_960_000,
  settlementAmount: 0,
  method: null,
  daysWaiting: 10,
  ...over,
});

const turn = (over: Partial<AwaitingTurnRow> = {}): AwaitingTurnRow => ({
  kind: "awaiting-turn",
  participationId: "pb1",
  personId: "pf1",
  name: "Tsion",
  nameAmharic: "ጽዮን",
  numbers: [9],
  netAmount: 980_000,
  grossAmount: 1_000_000,
  feeAmount: 20_000,
  weeksPaid: 8,
  weeksCommitted: 20,
  startWeek: 1,
  finishWeek: 20,
  weeksLeft: 8,
  atRisk: false,
  ...over,
});

describe("daysBetween — how long the money has been owed", () => {
  it("counts whole days and never goes negative", () => {
    expect(daysBetween(new Date("2026-07-01"), new Date("2026-07-11"))).toBe(10);
    expect(daysBetween(new Date("2026-07-01"), new Date("2026-07-01T23:00:00Z"))).toBe(0);
    expect(daysBetween(new Date("2026-07-11"), new Date("2026-07-01"))).toBe(0);
  });
});

describe("isAtRisk — 2.27: undrawn with the window closing", () => {
  it("flags anyone at or inside the margin, including a closed window", () => {
    expect(isAtRisk({ weeksLeft: AT_RISK_WEEKS })).toBe(true);
    expect(isAtRisk({ weeksLeft: 0 })).toBe(true);
    expect(isAtRisk({ weeksLeft: -3 })).toBe(true);
  });

  it("leaves someone with room to spare alone", () => {
    expect(isAtRisk({ weeksLeft: AT_RISK_WEEKS + 1 })).toBe(false);
  });
});

describe("waitingTotals — the two headline figures are never mixed", () => {
  it("separates money owed NOW from money owed eventually", () => {
    const totals = waitingTotals({
      awaitingPayment: [owed({ netAmount: 1_960_000, daysWaiting: 10 }), owed({ netAmount: 980_000, daysWaiting: 31 })],
      awaitingTurn: [turn({ netAmount: 980_000 }), turn({ netAmount: 1_470_000, atRisk: true })],
    });
    expect(totals.owedNow).toBe(2_940_000);
    expect(totals.owedNowCount).toBe(2);
    expect(totals.longestWaitDays).toBe(31);
    expect(totals.eventualTotal).toBe(2_450_000);
    expect(totals.eventualCount).toBe(2);
    expect(totals.atRiskCount).toBe(1);
  });

  it("is honest about an empty book", () => {
    const totals = waitingTotals({ awaitingPayment: [], awaitingTurn: [] });
    expect(totals).toEqual({
      owedNow: 0,
      owedNowCount: 0,
      longestWaitDays: null,
      eventualTotal: 0,
      eventualCount: 0,
      atRiskCount: 0,
    });
  });
});

describe("sortWaiting — every order the organizer can ask for", () => {
  const rows = [
    owed({ number: 1, name: "Bereket", netAmount: 500_000, daysWaiting: 3, weekNumber: 9 }),
    owed({ number: 2, name: "Almaz", netAmount: 1_960_000, daysWaiting: 30, weekNumber: 2 }),
    owed({ number: 3, name: "Chala", netAmount: 980_000, daysWaiting: 12, weekNumber: 5 }),
  ];

  it("amount, high to low — the biggest obligation first", () => {
    expect(sortWaiting(rows, "amount-desc").map((r) => r.number)).toEqual([2, 3, 1]);
  });

  it("amount, low to high", () => {
    expect(sortWaiting(rows, "amount-asc").map((r) => r.number)).toEqual([1, 3, 2]);
  });

  it("waiting longest — the DEFAULT, because it is the most urgent money", () => {
    expect(sortWaiting(rows, "longest").map((r) => r.number)).toEqual([2, 3, 1]);
  });

  it("week drawn, earliest first", () => {
    expect(sortWaiting(rows, "week").map((r) => r.number)).toEqual([2, 3, 1]);
  });

  it("name", () => {
    expect(sortWaiting(rows, "name").map((r) => r.name)).toEqual(["Almaz", "Bereket", "Chala"]);
  });

  it("falls back to name so equal rows never reshuffle", () => {
    const tied = [
      owed({ number: 1, name: "Zewditu", netAmount: 100, daysWaiting: 5 }),
      owed({ number: 2, name: "Abebe", netAmount: 100, daysWaiting: 5 }),
    ];
    expect(sortWaiting(tied, "amount-desc").map((r) => r.name)).toEqual(["Abebe", "Zewditu"]);
    expect(sortWaiting(tied, "longest").map((r) => r.name)).toEqual(["Abebe", "Zewditu"]);
  });

  it("a payout with no draw sorts last under 'longest' — nothing to measure", () => {
    const mixed = [owed({ number: 1, daysWaiting: null }), owed({ number: 2, daysWaiting: 1 })];
    expect(sortWaiting(mixed, "longest").map((r) => r.number)).toEqual([2, 1]);
  });

  it("for people awaiting their turn, 'longest' means least window left", () => {
    const waiting = [
      turn({ participationId: "a", name: "Aster", weeksLeft: 9 }),
      turn({ participationId: "b", name: "Bekele", weeksLeft: 1 }),
      turn({ participationId: "c", name: "Chaltu", weeksLeft: 5 }),
    ];
    expect(sortWaiting(waiting, "longest").map((r) => r.name)).toEqual([
      "Bekele",
      "Chaltu",
      "Aster",
    ]);
  });

  it("does not mutate the input array", () => {
    const original = [...rows];
    sortWaiting(rows, "name");
    expect(rows).toEqual(original);
  });
});

describe("mostUrgent — what the dashboard shows", () => {
  it("takes the longest-waiting money and the closest-to-the-edge people", () => {
    const result = mostUrgent({
      awaitingPayment: [
        owed({ number: 1, name: "A", daysWaiting: 2 }),
        owed({ number: 2, name: "B", daysWaiting: 40 }),
        owed({ number: 3, name: "C", daysWaiting: 9 }),
        owed({ number: 4, name: "D", daysWaiting: 20 }),
      ],
      awaitingTurn: [
        turn({ name: "W", weeksLeft: 12 }),
        turn({ name: "X", weeksLeft: 2, atRisk: true }),
        turn({ name: "Y", weeksLeft: 7 }),
        turn({ name: "Z", weeksLeft: 0, atRisk: true }),
      ],
      limit: 2,
    });
    expect(result.awaitingPayment.map((r) => r.name)).toEqual(["B", "D"]);
    // At-risk first (2.27), then whoever has least runway.
    expect(result.awaitingTurn.map((r) => r.name)).toEqual(["Z", "X"]);
  });

  it("shows three of each by default", () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      owed({ number: i, name: `M${i}`, daysWaiting: i }),
    );
    expect(mostUrgent({ awaitingPayment: many, awaitingTurn: [] }).awaitingPayment).toHaveLength(3);
  });
});

describe("labels — plain English, no jargon", () => {
  it("says how long the money has waited", () => {
    expect(waitedLabel(0)).toBe("today");
    expect(waitedLabel(1)).toBe("1 day");
    expect(waitedLabel(14)).toBe("14 days");
    expect(waitedLabel(null)).toBe("no draw recorded");
  });

  it("says how much of the window is left", () => {
    expect(runwayLabel(-1)).toBe("window closed");
    expect(runwayLabel(0)).toBe("final week");
    expect(runwayLabel(1)).toBe("1 week left");
    expect(runwayLabel(6)).toBe("6 weeks left");
  });
});
