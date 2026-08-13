import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  autoArrange,
  calculatePayout,
  displayOrder,
  eligibleNumbers,
  reshuffle,
  selectWinningSlot,
  undrawnWindowWarnings,
  winnerPlanArityRefusal,
  winnerPlanConfirmation,
  winnerPlanModeLabel,
  type WheelNumber,
  type WheelParticipation,
  type WinnerPlanMode,
} from "./wheel";

const MODES = ["ALONE", "TOGETHER", "OPEN_PARTNER"] as const satisfies readonly WinnerPlanMode[];

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

  it("no plan for this week -> random among the slots NOT committed elsewhere", () => {
    // This test used to assert s3 with all three slots in the pool, and it
    // still passes — for a different reason, which is why it is rewritten
    // rather than left alone. The point is now the exclusion.
    const selection = selectWinningSlot({
      eligibleSlots: slots,
      winnerPlans: [{ id: "p1", weekId: "w9", luckyNumberIds: ["b", "c"] }],
      weekId: "w10",
      random: () => 0.99,
    });
    // s2 is committed to w9, so the pool is [s1, s3] and 0.99 lands on s3.
    expect(selection).toEqual({ slotId: "s3", reason: "random" });
  });

  it("CHANCE NEVER CONSUMES A NUMBER COMMITTED TO A LATER WEEK (2.3)", () => {
    // THE DEFECT. 2.3 says committed numbers are treated exactly like drawn
    // ones — "excluded from the shuffle pool, their slot frozen" — and that
    // was implemented for the shuffle but not for the spin.
    //
    // #5 is planned for week 15. Weeks are drawn in order, so week 12 comes
    // up first, finds no plan of its own, and rolled over every eligible slot
    // including #5's. When it landed there, plan P was left PLANNED, pointing
    // at week 15, holding an already-drawn number — and week 15 could then
    // never be spun at all: the plan throws, and on the SHARED draw screen
    // the organizer sees only the neutral error (2.4).
    //
    // random() = 0 picks the first slot in the pool. With the committed slot
    // excluded, that can never be s2 — however the dice fall.
    for (const roll of [0, 0.34, 0.5, 0.67, 0.999]) {
      const selection = selectWinningSlot({
        eligibleSlots: slots,
        winnerPlans: [{ id: "p1", weekId: "w15", luckyNumberIds: ["b", "c"] }],
        weekId: "w12",
        random: () => roll,
      });
      expect(selection.slotId, `roll ${roll}`).not.toBe("s2");
      expect(selection.reason).toBe("random");
    }
  });

  it("a partly-committed slot is excluded — one committed number is enough", () => {
    // s2 holds b and c; only c is committed. The slot still cannot be spun,
    // because landing on it would draw c.
    const selection = selectWinningSlot({
      eligibleSlots: slots,
      winnerPlans: [{ id: "p1", weekId: "w15", luckyNumberIds: ["c"] }],
      weekId: "w12",
      random: () => 0.5,
    });
    expect(selection.slotId).not.toBe("s2");
  });

  it("a plan with NO week assigned commits nothing and never blocks", () => {
    // An unassigned or open-partner plan is not a commitment to a week, and
    // 2.3 says those numbers stay on the wheel.
    const selection = selectWinningSlot({
      eligibleSlots: [{ id: "s2", luckyNumberIds: ["b", "c"] }],
      winnerPlans: [{ id: "p1", weekId: null, luckyNumberIds: ["b", "c"] }],
      weekId: "w12",
      random: () => 0,
    });
    expect(selection).toEqual({ slotId: "s2", reason: "random" });
  });

  it("says so plainly when EVERY remaining slot is committed to a later week", () => {
    // Better than picking one anyway, and better than a bare throw: the
    // operational pages show this privately, and the draw screen shows the
    // neutral message (2.4).
    expect(() =>
      selectWinningSlot({
        eligibleSlots: [{ id: "s2", luckyNumberIds: ["b", "c"] }],
        winnerPlans: [{ id: "p1", weekId: "w15", luckyNumberIds: ["b", "c"] }],
        weekId: "w12",
      }),
    ).toThrow(/committed to a later week/);
  });

  it("the plan for THIS week still fires, even though it is a commitment", () => {
    // The exclusion must not lock a plan out of its own week.
    const selection = selectWinningSlot({
      eligibleSlots: slots,
      winnerPlans: [{ id: "p1", weekId: "w9", luckyNumberIds: ["b", "c"] }],
      weekId: "w9",
    });
    expect(selection).toEqual({ slotId: "s2", reason: "planned", planId: "p1" });
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

  // FOUND LIVE, ON WEEK 11. `WinnerPlanNumber` cascades when a LuckyNumber is
  // deleted, so removing a member or a number can leave a PLANNED plan with no
  // numbers in it — the organizer never did anything to it. `[].every(...)` is
  // VACUOUSLY TRUE, so that plan matched the FIRST eligible slot and would
  // have decided week 11 silently, audited as an intentional "planned" win
  // rather than a spin. There is no honest reading of a plan with no numbers.
  it("refuses to let a plan with ZERO numbers decide the draw", () => {
    expect(() =>
      selectWinningSlot({
        eligibleSlots: slots,
        winnerPlans: [{ id: "p-empty", weekId: "w9", luckyNumberIds: [] }],
        weekId: "w9",
      }),
    ).toThrow(/no numbers left in it/);
  });

  it("does not let an empty plan silently take the first slot", () => {
    // The precise failure: without the guard this returned s1 with
    // reason "planned".
    let selection: ReturnType<typeof selectWinningSlot> | null = null;
    try {
      selection = selectWinningSlot({
        eligibleSlots: slots,
        winnerPlans: [{ id: "p-empty", weekId: "w9", luckyNumberIds: [] }],
        weekId: "w9",
      });
    } catch {
      /* expected */
    }
    expect(selection).toBeNull();
  });

  it("an empty plan for ANOTHER week never interferes with this one", () => {
    const selection = selectWinningSlot({
      eligibleSlots: slots,
      winnerPlans: [{ id: "p-empty", weekId: "w11", luckyNumberIds: [] }],
      weekId: "w9",
      random: () => 0,
    });
    expect(selection).toEqual({ slotId: "s1", reason: "random" });
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

// ————————————————————————————————————————————————————————————————
// "WIN ALONE" SILENTLY PAIRED NUMBERS (2.3).
//
// WHY NONE OF THIS COULD HAVE PASSED BEFORE. `createWinnerPlan` validated
// arity for TOGETHER (< 2 refused) and OPEN_PARTNER (!== 1 refused) and had
// NO ALONE branch. It then created ONE slot and wrote EVERY picked id into
// it whatever the mode, so #3 and #7 committed as "Win alone" went into a
// single slot under a single plan and won the SAME week. There was no rule
// to ask, no refusal to read, and the confirmation agreed with him on the
// way past ("Commit #3 + #7 as ALONE?"). Every assertion below is against
// code that did not exist; the behavioural ones state the defect they close.
// ————————————————————————————————————————————————————————————————

describe("winnerPlanArityRefusal — 'win alone' means alone (2.3)", () => {
  it("THE DEFECT: two numbers under 'Win alone' are refused, both named", () => {
    // The audit's exact reproduction. This input used to reach
    // `tx.slotMember.createMany` and pair them.
    const refusal = winnerPlanArityRefusal({ mode: "ALONE", count: 2, numbers: [7, 3] });
    expect(refusal).not.toBeNull();
    // His own selection read back, ordered — not a bare "2 numbers".
    expect(refusal).toContain("#3");
    expect(refusal).toContain("#7");
    expect(refusal!.indexOf("#3")).toBeLessThan(refusal!.indexOf("#7"));
    // A refusal with no way out is a dead end (UI_STANDARDS 6b). Both routes
    // named: one at a time, or the mode that means what he did.
    expect(refusal).toMatch(/one at a time/);
    expect(refusal).toContain(winnerPlanModeLabel("TOGETHER"));
    // And it quotes the control he actually used.
    expect(refusal).toContain(winnerPlanModeLabel("ALONE"));
  });

  it("THE OTHER DIRECTION: exactly one is allowed, or the rule would just be 'no'", () => {
    // A refusal that fires on everything is a refusal nobody can satisfy.
    expect(winnerPlanArityRefusal({ mode: "ALONE", count: 1, numbers: [3] })).toBeNull();
  });

  it("the SAME two numbers under 'Win together' are allowed — the mode is refused, not the pick", () => {
    // This is the whole point of 2.3's "together or separate": #3 + #7
    // sharing a week is a legitimate plan. What was never legitimate is
    // getting it while declaring the opposite.
    expect(winnerPlanArityRefusal({ mode: "TOGETHER", count: 2, numbers: [3, 7] })).toBeNull();
  });

  it("refuses every count above one, not only two (sweep — §5.7)", () => {
    for (const count of [2, 3, 4, 8, 31]) {
      expect(winnerPlanArityRefusal({ mode: "ALONE", count }), `count ${count}`).not.toBeNull();
    }
  });

  it("TOGETHER and OPEN_PARTNER keep exactly the arity they already had", () => {
    expect(winnerPlanArityRefusal({ mode: "TOGETHER", count: 1, numbers: [3] })).not.toBeNull();
    expect(winnerPlanArityRefusal({ mode: "TOGETHER", count: 2, numbers: [3, 7] })).toBeNull();
    expect(winnerPlanArityRefusal({ mode: "TOGETHER", count: 5 })).toBeNull();
    expect(winnerPlanArityRefusal({ mode: "OPEN_PARTNER", count: 1, numbers: [3] })).toBeNull();
    expect(winnerPlanArityRefusal({ mode: "OPEN_PARTNER", count: 2, numbers: [3, 7] })).not.toBeNull();
  });

  it("nothing picked is refused in every mode", () => {
    for (const mode of MODES) {
      expect(winnerPlanArityRefusal({ mode, count: 0 }), mode).toBe("Pick at least one number.");
    }
  });

  it("no refusal speaks the database's word for the mode", () => {
    // "Commit #3 + #7 as ALONE?" is what he used to read. Every sentence he
    // sees is built from the control's own label now.
    for (const mode of MODES) {
      for (const count of [0, 1, 2, 3]) {
        const refusal = winnerPlanArityRefusal({
          mode,
          count,
          numbers: [3, 7, 9].slice(0, count),
        });
        if (refusal === null) continue;
        expect(refusal, `${mode}/${count}`).not.toMatch(/ALONE|TOGETHER|OPEN_PARTNER/);
      }
    }
  });

  it("falls back to a count when the caller has ids only — the action's case", () => {
    // The server checks arity before it has resolved ids to numbers, so its
    // sentence must still be a sentence.
    const refusal = winnerPlanArityRefusal({ mode: "ALONE", count: 2 });
    expect(refusal).toContain("2 numbers");
    expect(refusal).not.toMatch(/undefined|NaN|#\D/);
  });

  it("never under-reports the selection when the labels do not cover it", () => {
    // A ticked number deleted from another screen resolves to nothing on the
    // setup page, so `numbers` can be shorter than `count`. "you picked #3"
    // over a two-number selection would describe less than the button sends.
    const refusal = winnerPlanArityRefusal({ mode: "ALONE", count: 2, numbers: [3] });
    expect(refusal).toContain("2 numbers");
    expect(refusal).not.toContain("#3");
  });
});

describe("winnerPlanConfirmation — the dialog cannot describe a plan the server will not build", () => {
  it("'Win alone' confirms ONE number winning by itself, in its week", () => {
    const { title, effect } = winnerPlanConfirmation({
      mode: "ALONE",
      numbers: [3],
      weekNumber: 12,
    });
    expect(title).toBe("Commit #3 to win alone?");
    expect(effect).toContain("week 12");
    expect(effect).toMatch(/by itself/);
    // The distinction from "Open partner", stated rather than implied.
    expect(effect).toMatch(/nothing else can join/);
  });

  it("'Win together' says same week, one slot — and never borrows 'alone'", () => {
    const { title, effect } = winnerPlanConfirmation({
      mode: "TOGETHER",
      numbers: [7, 3],
      weekNumber: 12,
    });
    expect(title).toBe("Commit #3 and #7 to win together, in the same week?");
    expect(effect).toMatch(/one slot/);
    expect(title).not.toMatch(/alone/i);
  });

  it("'Open partner' says a partner may be attached — the opposite of alone", () => {
    const { effect } = winnerPlanConfirmation({
      mode: "OPEN_PARTNER",
      numbers: [3],
      weekNumber: 12,
    });
    expect(effect).toMatch(/may attach one other number/);
  });

  it("no confirmation speaks the database's word for the mode", () => {
    for (const mode of MODES) {
      const { title, effect } = winnerPlanConfirmation({ mode, numbers: [3], weekNumber: 12 });
      expect(`${title} ${effect}`, mode).not.toMatch(/ALONE|TOGETHER|OPEN_PARTNER/);
    }
  });

  it("says so plainly when no week is assigned yet", () => {
    for (const weekNumber of [null, undefined]) {
      const { effect } = winnerPlanConfirmation({ mode: "ALONE", numbers: [3], weekNumber });
      expect(effect).toMatch(/week you assign later/);
      expect(effect).not.toMatch(/week (undefined|null)/);
    }
  });
});

// ————————————————————————————————————————————————————————————————
// GUARD — the rule is enforced on the SERVER, and stated at the control.
//
// The pure function above proves the RULE. It proves nothing about whether
// anything asks it: the defect was never a wrong function, it was a rule
// with no owner (§5.8). These scan the two callers for the mechanical
// properties a unit test cannot see — that the action refuses BEFORE it
// writes, that the page states the reason next to the button rather than in
// the banner 400 lines up (UI_STANDARDS 6b), and that neither builds a
// sentence out of the enum.
// ————————————————————————————————————————————————————————————————

const GUARD_ROOT = join(import.meta.dirname, "..");
const readSource = (file: string) => readFileSync(join(GUARD_ROOT, file), "utf8");
const ACTION_FILE = "app/actions/wheel.ts";
const SETUP_FILE = "app/admin/wheel/setup/wheel-setup.tsx";

describe("GUARD — the ALONE rule has an owner, and both callers use it", () => {
  const action = readSource(ACTION_FILE);
  const setup = readSource(SETUP_FILE);

  it("reads the real files (a broken path would make every check below vacuous)", () => {
    expect(action).toContain("export async function createWinnerPlan");
    expect(setup).toContain("Winner planning");
  });

  it("createWinnerPlan CALLS the rule, and refuses BEFORE it writes the slot", () => {
    // Scoped to createWinnerPlan's own body. The first version compared
    // whole-file offsets and failed on correct code, because `saveSlots`
    // writes slot members 300 lines earlier — an ordering claim about the
    // wrong function (§5.3: a guard that fails on correct code gets deleted).
    const start = action.indexOf("export async function createWinnerPlan");
    const end = action.indexOf("export async function", start + 1);
    const body = action.slice(start, end === -1 ? undefined : end);
    expect(body, "createWinnerPlan's body must be isolatable").toContain("winnerPlan.create(");

    // CALLS, not names: matching the bare identifier is satisfied by the
    // import line alone, which is how the lucky-number guard shipped vacuous
    // (§5.2). The paren is the difference.
    const call = body.indexOf("winnerPlanArityRefusal(");
    expect(call, `${ACTION_FILE} must ask the shared rule`).toBeGreaterThan(-1);
    // The write that caused the defect: one slot, then every id into it.
    const write = body.indexOf("tx.slotMember.createMany(");
    expect(write, `${ACTION_FILE} must still be the thing that writes the slot`).toBeGreaterThan(-1);
    expect(call, "the refusal must come before anything is written").toBeLessThan(write);
  });

  it("the action does not re-implement its own arity check", () => {
    // Two functions answering one question is the same defect as none
    // (§5.10) — a private count check here would drift from the sentence
    // the setup page shows, and the organizer would get two answers.
    expect(action, `${ACTION_FILE} counts ids by hand instead of asking the rule`).not.toMatch(
      /ids\.length\s*(<|>|!==|===)\s*\d/,
    );
  });

  it("the setup page asks the SAME rule, before the round trip", () => {
    expect(setup, `${SETUP_FILE} must ask the shared rule`).toMatch(/winnerPlanArityRefusal\(/);
    // Gated on the rule, never on a hand-rolled count the rule can outgrow.
    // `disabled={busy || planNumbers.size === 0 || dirty}` is what let a
    // two-number ALONE selection reach the server at all.
    expect(setup).not.toContain("planNumbers.size === 0");
    expect(setup).toContain("planRefusal !== null");
  });

  it("the refusal renders AT the control — between the button and the plan list", () => {
    // UI_STANDARDS 6b lists this exact control as a known violation: the
    // reason went to the banner at the top of a long page, so the organizer
    // saw nothing change and reported "it did not save".
    const commit = setup.indexOf("createWinnerPlan({");
    const list = setup.indexOf("state.plans.length > 0");
    expect(commit).toBeGreaterThan(-1);
    expect(list).toBeGreaterThan(commit);
    for (const slot of ["{planRefusal}", "{planError}"]) {
      const at = setup.indexOf(slot);
      expect(at, `${slot} must be rendered`).toBeGreaterThan(-1);
      expect(at, `${slot} must sit under the button, not elsewhere`).toBeGreaterThan(commit);
      expect(at, `${slot} must sit above the plan list`).toBeLessThan(list);
      // And be announced, not just printed.
      const openTag = setup.lastIndexOf("<p", at);
      expect(setup.slice(openTag, at), `${slot} needs role="alert"`).toContain('role="alert"');
    }
    // The server's refusal must reach that slot, not only the banner. Matched
    // on the CALL and not on `result.error` verbatim: the action's union makes
    // `error` optional, so the page narrows it to a reason string first — and
    // pinning the old spelling would have forced that narrowing back out.
    expect(setup).toMatch(/setPlanError\((?!null)/);
  });

  it("no screen builds a sentence out of the mode enum", () => {
    // The confirmation was `Commit ${picked} as ${planMode}?`, and the plan
    // list printed `— {p.mode}`.
    expect(setup).not.toMatch(/\$\{planMode\}/);
    expect(setup).not.toMatch(/\{p\.mode\}/);
    expect(setup).toMatch(/winnerPlanModeLabel\(/);
    expect(setup).toMatch(/winnerPlanConfirmation\(/);
  });

  it("the labels the refusal quotes ARE the labels on the control", () => {
    // If these drift, the refusal tells him to choose an option that is not
    // on screen — §5.15, a reason string that outlived its cause.
    for (const mode of MODES) {
      expect(setup, `the ${mode} option must be labelled by the shared function`).toContain(
        `{ value: "${mode}", label: winnerPlanModeLabel("${mode}") }`,
      );
    }
  });

  it("the scan is not vacuous — every pattern fires on the shape it forbids", () => {
    // Verbatim from the tree this replaced, so a future rewrite that
    // reintroduces any of them is caught rather than argued about.
    expect(/ids\.length\s*(<|>|!==|===)\s*\d/.test(
      `    if (input.mode === "TOGETHER" && ids.length < 2) {`,
    )).toBe(true);
    expect(/ids\.length\s*(<|>|!==|===)\s*\d/.test(
      `    if (ids.length === 0) return { ok: false as const, error: "Pick at least one number." };`,
    )).toBe(true);
    // ...and NOT on the corrected form, or a guard that flags correct code
    // gets switched off by whoever meets it next (§5.3).
    expect(/ids\.length\s*(<|>|!==|===)\s*\d/.test(
      `    const arity = winnerPlanArityRefusal({ mode: input.mode, count: ids.length });`,
    )).toBe(false);

    expect(/\$\{planMode\}/.test("title: `Commit ${picked} as ${planMode}?`,")).toBe(true);
    expect(/\{p\.mode\}/.test("{p.numbers.map((n) => `#${n}`).join(\" + \")} — {p.mode}")).toBe(true);
    expect("disabled={busy || planNumbers.size === 0 || dirty}").toContain("planNumbers.size === 0");
  });
});
