import { describe, expect, it } from "vitest";
import {
  autoArrange,
  calculatePayout,
  displayOrder,
  eligibleNumbers,
  reshuffle,
  selectWinningSlot,
  undrawnWindowWarnings,
  type WheelNumber,
  type WheelParticipation,
} from "./wheel";

const num = (id: string, number: number, participationId: string, amount = 100_000): WheelNumber => ({
  id,
  number,
  amount,
  participationId,
});
const member = (
  id: string,
  name: string,
  startWeek: number,
  weeksCommitted: number,
  status: "ACTIVE" | "CLOSED" = "ACTIVE",
): WheelParticipation => ({ id, name, startWeek, weeksCommitted, status });

/** Deterministic "random" from a fixed sequence. */
function seq(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe("eligibleNumbers — the pool (2.27)", () => {
  const members = [
    member("full", "Full", 1, 20),
    member("early", "EarlyFinisher", 1, 10), // window ends week 10
    member("late", "LateJoiner", 12, 9),
    member("closed", "Closed", 1, 20, "CLOSED"),
  ];
  const numbers = [
    num("a", 1, "full"),
    num("b", 2, "early"),
    num("c", 3, "late"),
    num("d", 4, "closed"),
  ];

  it("a number LEAVES the pool when its owner's window ends", () => {
    const atWeek10 = eligibleNumbers({ luckyNumbers: numbers, participations: members, drawnNumberIds: new Set(), currentWeek: 10 });
    expect(atWeek10.map((n) => n.number)).toContain(2); // week 10 is their last week — still in
    const atWeek11 = eligibleNumbers({ luckyNumbers: numbers, participations: members, drawnNumberIds: new Set(), currentWeek: 11 });
    expect(atWeek11.map((n) => n.number)).not.toContain(2); // gone
    expect(atWeek11.map((n) => n.number)).toContain(1);
  });

  it("a late joiner's number is not drawable before their window opens", () => {
    const atWeek5 = eligibleNumbers({ luckyNumbers: numbers, participations: members, drawnNumberIds: new Set(), currentWeek: 5 });
    expect(atWeek5.map((n) => n.number)).not.toContain(3);
    const atWeek12 = eligibleNumbers({ luckyNumbers: numbers, participations: members, drawnNumberIds: new Set(), currentWeek: 12 });
    expect(atWeek12.map((n) => n.number)).toContain(3);
  });

  it("drawn numbers and closed members are out", () => {
    const pool = eligibleNumbers({ luckyNumbers: numbers, participations: members, drawnNumberIds: new Set(["a"]), currentWeek: 5 });
    expect(pool.map((n) => n.number)).toEqual([2]); // 1 drawn, 3 not started, 4 closed
  });
});

describe("undrawnWindowWarnings — the 2.27 safeguard", () => {
  const members = [
    member("m1", "Meheret", 9, 10), // finishes week 18
    member("m2", "Full", 1, 20),
    member("m3", "AlreadyDrawn", 1, 10),
  ];
  const numbers = [num("a", 5, "m1"), num("b", 6, "m2"), num("c", 7, "m3")];

  it("warns when a window ends within N weeks and nothing has been drawn", () => {
    const warnings = undrawnWindowWarnings({
      luckyNumbers: numbers,
      participations: members,
      drawnNumberIds: new Set(["c"]),
      currentWeek: 16,
      weeksAhead: 2,
    });
    expect(warnings).toEqual([
      { participationId: "m1", name: "Meheret", finishWeek: 18, weeksLeft: 2, numbers: [5] },
    ]);
  });

  it("an ALREADY-closed undrawn window still warns (worst case, weeksLeft <= 0)", () => {
    const warnings = undrawnWindowWarnings({
      luckyNumbers: numbers,
      participations: members,
      drawnNumberIds: new Set(["c"]),
      currentWeek: 19,
      weeksAhead: 2,
    });
    expect(warnings[0]).toMatchObject({ name: "Meheret", weeksLeft: -1 });
  });

  it("drawn members never warn — they have received", () => {
    const warnings = undrawnWindowWarnings({
      luckyNumbers: numbers,
      participations: [member("m3", "AlreadyDrawn", 1, 10)],
      drawnNumberIds: new Set(["c"]),
      currentWeek: 9,
      weeksAhead: 2,
    });
    expect(warnings).toEqual([]);
  });
});

describe("selectWinningSlot — plan first, then chance (2.2/2.3)", () => {
  const slots = [
    { id: "s1", luckyNumberIds: ["a"] },
    { id: "s2", luckyNumberIds: ["b", "c"] },
    { id: "s3", luckyNumberIds: ["d"] },
  ];

  it("a plan committed to this week decides the winner", () => {
    const selection = selectWinningSlot({
      eligibleSlots: slots,
      winnerPlans: [{ id: "p1", weekId: "w9", luckyNumberIds: ["b", "c"] }],
      weekId: "w9",
    });
    expect(selection).toEqual({ slotId: "s2", reason: "planned", planId: "p1" });
  });

  it("no plan for this week -> uniformly random among eligible slots", () => {
    const selection = selectWinningSlot({
      eligibleSlots: slots,
      winnerPlans: [{ id: "p1", weekId: "w9", luckyNumberIds: ["b", "c"] }],
      weekId: "w10",
      random: () => 0.99,
    });
    expect(selection).toEqual({ slotId: "s3", reason: "random" });
  });

  it("a plan whose numbers are not together in an eligible slot fails loudly", () => {
    expect(() =>
      selectWinningSlot({
        eligibleSlots: slots,
        winnerPlans: [{ id: "p1", weekId: "w9", luckyNumberIds: ["a", "b"] }],
        weekId: "w9",
      }),
    ).toThrow(/not sitting together/);
  });

  it("throws when the pool is empty", () => {
    expect(() => selectWinningSlot({ eligibleSlots: [], winnerPlans: [], weekId: "w1" })).toThrow(
      /No eligible slots/,
    );
  });
});

describe("autoArrange — target the unit, flag over-unit, never block", () => {
  it("conserves every number exactly once, closing slots at the unit", () => {
    const numbers = [
      num("a", 1, "p1", 50_000),
      num("b", 2, "p2", 50_000),
      num("c", 3, "p3", 100_000),
    ];
    for (const roll of [0, 0.4, 0.9]) {
      const proposed = autoArrange({ unassignedNumbers: numbers, unitAmount: 100_000, random: seq([roll]) });
      const ids = proposed.flatMap((s) => s.luckyNumberIds).sort();
      expect(ids).toEqual(["a", "b", "c"]); // conservation, regardless of grouping
      expect(proposed.reduce((sum, s) => sum + s.total, 0)).toBe(200_000);
      for (const slot of proposed) expect(slot.overUnit).toBe(slot.total > 100_000);
    }
  });

  it("full-unit numbers each get their own slot", () => {
    const proposed = autoArrange({
      unassignedNumbers: [num("a", 1, "p1", 100_000), num("b", 2, "p2", 100_000)],
      unitAmount: 100_000,
      random: seq([0.5]),
    });
    expect(proposed).toHaveLength(2);
    expect(proposed.every((s) => s.total === 100_000 && !s.overUnit)).toBe(true);
  });

  it("over-unit slots are flagged, never blocked", () => {
    const proposed = autoArrange({
      unassignedNumbers: [num("a", 1, "p1", 75_000), num("b", 2, "p2", 75_000)],
      unitAmount: 100_000,
      random: seq([0]),
    });
    expect(proposed).toHaveLength(1);
    expect(proposed[0]).toMatchObject({ total: 150_000, overUnit: true });
  });

  it("locked ids never appear in a proposal even if passed in", () => {
    const proposed = autoArrange({
      unassignedNumbers: [num("a", 1, "p1"), num("b", 2, "p2")],
      unitAmount: 100_000,
      lockedNumberIds: new Set(["a"]),
      random: seq([0]),
    });
    expect(proposed.flatMap((s) => s.luckyNumberIds)).toEqual(["b"]);
  });
});

describe("reshuffle — THE pinned defect (2.3): frozen means frozen", () => {
  const slots = [
    { id: "s1", members: [num("drawn1", 1, "p1"), num("free1", 2, "p2")] }, // contains a drawn number
    { id: "s2", members: [num("committed1", 3, "p3"), num("committed2", 4, "p3")] }, // a TOGETHER plan
    { id: "s3", members: [num("free2", 5, "p4"), num("free3", 6, "p5")] },
    { id: "s4", members: [num("free4", 7, "p6")] },
  ];

  it("never moves a DRAWN number, and never re-pairs its slot", () => {
    for (const roll of [0, 0.3, 0.7, 0.999]) {
      const result = reshuffle({
        slots,
        drawnNumberIds: new Set(["drawn1"]),
        committedNumberIds: new Set(["committed1", "committed2"]),
        unitAmount: 100_000,
        random: seq([roll]),
      });
      expect(result.frozenSlotIds).toContain("s1");
      // Nothing from s1 — not even its free partner — appears in proposals:
      // re-pairing the partner would change who the drawn number sits with.
      const proposedIds = result.proposedSlots.flatMap((s) => s.luckyNumberIds);
      expect(proposedIds).not.toContain("drawn1");
      expect(proposedIds).not.toContain("free1");
    }
  });

  it("never moves or re-pairs COMMITTED numbers — the plan survives every shuffle", () => {
    for (const roll of [0, 0.25, 0.5, 0.75, 0.99]) {
      const result = reshuffle({
        slots,
        drawnNumberIds: new Set(["drawn1"]),
        committedNumberIds: new Set(["committed1", "committed2"]),
        unitAmount: 100_000,
        random: seq([roll]),
      });
      expect(result.frozenSlotIds).toContain("s2");
      const proposedIds = result.proposedSlots.flatMap((s) => s.luckyNumberIds);
      expect(proposedIds).not.toContain("committed1");
      expect(proposedIds).not.toContain("committed2");
      // Free numbers all reappear exactly once.
      expect([...proposedIds].sort()).toEqual(["free2", "free3", "free4"]);
    }
  });

  it("OPEN_PARTNER anchors stay and gain at most ONE partner", () => {
    const result = reshuffle({
      slots: [
        { id: "s1", members: [num("anchor", 1, "p1", 50_000)] },
        { id: "s2", members: [num("f1", 2, "p2", 25_000), num("f2", 3, "p3", 25_000), num("f3", 4, "p4", 25_000)] },
      ],
      drawnNumberIds: new Set(),
      committedNumberIds: new Set(),
      anchoredNumberIds: new Set(["anchor"]),
      unitAmount: 100_000,
      random: seq([0.5, 0.2]),
    });
    const anchoredSlot = result.proposedSlots.find((s) => s.luckyNumberIds.includes("anchor"));
    expect(anchoredSlot).toBeDefined();
    expect(anchoredSlot!.anchored).toBe(true);
    expect(anchoredSlot!.luckyNumberIds.length).toBeLessThanOrEqual(2); // anchor + at most one partner
  });
});

describe("calculatePayout — one payout per number, each pays their own fee", () => {
  const cycle = { feePercent: 2 };

  it("matches the imported books: $1,000 number over 20 weeks", () => {
    expect(
      calculatePayout({
        luckyNumber: { id: "n1", amount: 100_000 },
        participation: { weeksCommitted: 20 },
        cycle,
      }),
    ).toEqual({ luckyNumberId: "n1", gross: 2_000_000, fee: 40_000, net: 1_960_000 });
  });

  it("a multi-number slot pays each member separately on their own share", () => {
    // Slot: #15 ($1,000 of Getahun's $1,750) + #155 ($750 remainder).
    const p15 = calculatePayout({
      luckyNumber: { id: "n15", amount: 100_000 },
      participation: { weeksCommitted: 20 },
      cycle,
    });
    const p155 = calculatePayout({
      luckyNumber: { id: "n155", amount: 75_000 },
      participation: { weeksCommitted: 20 },
      cycle,
    });
    expect(p15.net).toBe(1_960_000); // $19,600
    expect(p155).toEqual({ luckyNumberId: "n155", gross: 1_500_000, fee: 30_000, net: 1_470_000 });
    // Two separate payouts — never one merged figure.
    expect(p15.net + p155.net).not.toBe(calculatePayout({ luckyNumber: { id: "x", amount: 175_000 }, participation: { weeksCommitted: 20 }, cycle }).net + 1);
  });

  it("a shorter window pays a smaller gross (their own weeks, 2.22)", () => {
    expect(
      calculatePayout({
        luckyNumber: { id: "n", amount: 150_000 },
        participation: { weeksCommitted: 10 },
        cycle,
      }),
    ).toEqual({ luckyNumberId: "n", gross: 1_500_000, fee: 30_000, net: 1_470_000 });
  });
});

describe("displayOrder — audit H3c: creation order never shows on the wheel", () => {
  const slots = Array.from({ length: 8 }, (_, i) => ({ id: `s${i + 1}` }));

  it("is deterministic for the same seed (reloads mid-draw keep the wheel identical)", () => {
    expect(displayOrder(slots, "week-abc")).toEqual(displayOrder(slots, "week-abc"));
  });

  it("keeps every slot exactly once and never mutates the input", () => {
    const before = slots.map((s) => s.id);
    const out = displayOrder(slots, "week-abc");
    expect(out.map((s) => s.id).sort()).toEqual([...before].sort());
    expect(slots.map((s) => s.id)).toEqual(before);
  });

  it("the last-CREATED slot (the planned winner's) is not the last segment week after week", () => {
    // Raw position order put the planned slot last every single week —
    // visible to the naked eye on Zoom. Across 20 different week seeds the
    // final segment must vary.
    const lastSegment = Array.from({ length: 20 }, (_, w) => {
      const order = displayOrder(slots, `week-${w + 1}`);
      return order[order.length - 1].id;
    });
    expect(new Set(lastSegment).size).toBeGreaterThan(1);
    expect(lastSegment.every((id) => id === "s8")).toBe(false);
  });
});
