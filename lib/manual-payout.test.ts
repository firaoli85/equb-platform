import { describe, expect, it } from "vitest";
import {
  firstFreeWeek,
  manualPayoutPreview,
  numbersRefusal,
  weekChoice,
  weekChoices,
  type ManualPayoutWeek,
} from "./manual-payout";
import { calculatePayout } from "./wheel";

// 2.2 organizer discretion: a payout may be ASSIGNED rather than drawn. The
// arithmetic and the guardrails must match a drawn payout exactly — these pin
// the consequences the organizer confirms against, and the figures.

const week = (over: Partial<ManualPayoutWeek> = {}): ManualPayoutWeek => ({
  weekNumber: 7,
  hasDraw: false,
  drawnManually: false,
  planned: false,
  drawnNumbers: [],
  payouts: [],
  isSkipped: false,
  ...over,
});

/** A week with a real draw on it — the common "already drawn" case. */
const drawnWeek = (over: Partial<ManualPayoutWeek> = {}): ManualPayoutWeek =>
  week({
    hasDraw: true,
    drawnNumbers: [15],
    payouts: [{ number: 15, netAmount: 1_960_000, status: "PENDING", settlementAmount: 0 }],
    ...over,
  });

describe("weekChoice — every week is choosable, with its consequence stated", () => {
  it("a free week needs nothing else", () => {
    expect(weekChoice(week())).toEqual({ weekNumber: 7, kind: "free" });
  });

  // WHERE THE ORGANIZER FIRST SAW THE BUG. Week 6 held a draw with no payout,
  // so this branch produced "Week 6 already has a draw (, no payout recorded)"
  // — an empty parenthesis where every other drawn week quoted a figure. Such
  // a week should no longer be creatable (lib/draw-cascade removes the draw
  // with its last payout), but older data must still read honestly.
  describe("a draw holding NO payout — the half-state that stranded weeks 1 and 6", () => {
    it("says exactly what it is, never a drawn week with a blank amount", () => {
      const c = weekChoice(drawnWeek({ payouts: [], drawnNumbers: [78] }));
      expect(c.kind).toBe("replaces");
      if (c.kind !== "replaces") return;
      expect(c.consequence).toContain("marked drawn but holds NO payout");
      expect(c.consequence).not.toContain("(,");
      expect(c.consequence).not.toContain(", ,");
      expect(c.totalNet).toBe(0);
      expect(c.payoutCount).toBe(0);
    });

    it("names the numbers stranded in its slot as returning", () => {
      const c = weekChoice(drawnWeek({ payouts: [], drawnNumbers: [78] }));
      if (c.kind !== "replaces") throw new Error("expected replaces");
      expect(c.numbersReturning).toEqual([78]);
      expect(c.consequence).toContain("#78 returns to the wheel");
    });

    it("says no number is affected when the slot is empty too — the week-6 shape", () => {
      const c = weekChoice(drawnWeek({ payouts: [], drawnNumbers: [] }));
      if (c.kind !== "replaces") throw new Error("expected replaces");
      expect(c.numbersReturning).toEqual([]);
      expect(c.consequence).toContain("no number is affected");
      expect(c.consequence).not.toMatch(/\s+returns? to the wheel/);
    });

    it("is NOT high stakes — there is no money record to destroy", () => {
      const c = weekChoice(drawnWeek({ payouts: [], drawnNumbers: [78] }));
      if (c.kind !== "replaces") throw new Error("expected replaces");
      expect(c.highStakes).toBe(false);
      expect(c.reopensWeeks).toEqual([]);
    });
  });

  it("a DRAWN week is offered, not refused — with the real figures", () => {
    const c = weekChoice(drawnWeek());
    expect(c.kind).toBe("replaces");
    if (c.kind !== "replaces") return;
    expect(c.consequence).toContain("Week 7 already has a draw");
    expect(c.consequence).toContain("#15");
    expect(c.consequence).toContain("$19,600");
    expect(c.consequence).toContain("pending");
    expect(c.consequence).toContain("undoing that draw first");
    expect(c.consequence).toContain("returns to the wheel");
    expect(c.highStakes).toBe(false);
    expect(c.numbersReturning).toEqual([15]);
    expect(c.totalNet).toBe(1_960_000);
  });

  it("a COLLECTED payout raises the stakes — money already handed over", () => {
    const c = weekChoice(
      drawnWeek({
        payouts: [{ number: 15, netAmount: 1_960_000, status: "COLLECTED", settlementAmount: 0 }],
      }),
    );
    expect(c.kind).toBe("replaces");
    if (c.kind !== "replaces") return;
    expect(c.consequence).toContain("collected");
    expect(c.highStakes).toBe(true);
  });

  it("names the settled week that reopens, with the amount", () => {
    const c = weekChoice(
      drawnWeek({
        payouts: [
          { number: 15, netAmount: 1_960_000, status: "PENDING", settlementAmount: 100_000 },
        ],
      }),
    );
    if (c.kind !== "replaces") throw new Error("expected replaces");
    expect(c.consequence).toContain("owed again");
    expect(c.consequence).toContain("$1,000");
    expect(c.reopensWeeks).toEqual([7]);
  });

  it("says ASSIGNMENT, not draw, when the existing one was manual", () => {
    const c = weekChoice(drawnWeek({ drawnManually: true }));
    if (c.kind !== "replaces") throw new Error("expected replaces");
    expect(c.consequence).toContain("manually assigned payout");
    expect(c.consequence).toContain("undoing that assignment first");
  });

  it("reports a mixed collected/pending draw honestly", () => {
    const c = weekChoice(
      drawnWeek({
        drawnNumbers: [15, 22],
        payouts: [
          { number: 15, netAmount: 1_960_000, status: "COLLECTED", settlementAmount: 0 },
          { number: 22, netAmount: 980_000, status: "PENDING", settlementAmount: 0 },
        ],
      }),
    );
    if (c.kind !== "replaces") throw new Error("expected replaces");
    expect(c.consequence).toContain("1 of 2 collected");
    expect(c.consequence).toContain("$29,400");
    expect(c.numbersReturning).toEqual([15, 22]);
  });

  // The ONE genuinely unsafe case: a locked plan is not a draw, so there is
  // nothing to undo. The reason names that week's own obstacle (2.3) rather
  // than disabling the option globally.
  it("blocks ONLY a week with a committed plan, and says why for that week", () => {
    const c = weekChoice(week({ planned: true }));
    expect(c.kind).toBe("blocked");
    if (c.kind !== "blocked") return;
    expect(c.reason).toContain("committed winner plan");
    expect(c.reason).toContain("Cancel the plan");
  });

  it("a week that is BOTH drawn and planned is still replaceable — the draw is the fact", () => {
    expect(weekChoice(drawnWeek({ planned: true })).kind).toBe("replaces");
  });

  it("a skipped week is still assignable — skipping is about contributions, not payouts", () => {
    expect(weekChoice(week({ isSkipped: true })).kind).toBe("free");
  });
});

describe("weekChoices / firstFreeWeek — the default never proposes destruction", () => {
  it("keeps every week in the list, in order", () => {
    const all = weekChoices([
      drawnWeek({ weekNumber: 1 }),
      week({ weekNumber: 2 }),
      week({ weekNumber: 3, planned: true }),
      drawnWeek({ weekNumber: 4, drawnManually: true }),
    ]);
    expect(all).toHaveLength(4);
    expect(all.map((c) => c.kind)).toEqual(["replaces", "free", "blocked", "replaces"]);
  });

  it("defaults to the first GENUINELY FREE week, not a drawn one", () => {
    const all = weekChoices([
      drawnWeek({ weekNumber: 1 }),
      drawnWeek({ weekNumber: 2 }),
      week({ weekNumber: 3 }),
      week({ weekNumber: 4 }),
    ]);
    expect(firstFreeWeek(all)?.weekNumber).toBe(3);
  });

  it("returns null when nothing is free — the caller must not invent one", () => {
    expect(firstFreeWeek(weekChoices([drawnWeek({ weekNumber: 1 })]))).toBeNull();
  });
});

describe("numbersRefusal — 2.27: a drawn number never comes back", () => {
  const n = (id: string, number: number, alreadyDrawn = false) => ({
    id,
    number,
    amount: 100_000,
    alreadyDrawn,
  });

  it("requires at least one number", () => {
    expect(numbersRefusal([])).toContain("at least one");
  });

  it("refuses a number that has already been drawn, naming it", () => {
    const r = numbersRefusal([n("a", 7), n("b", 22, true)]);
    expect(r).toContain("#22");
    expect(r).toContain("2.27");
  });

  it("names every drawn number when several are chosen", () => {
    const r = numbersRefusal([n("a", 7, true), n("b", 22, true)]);
    expect(r).toContain("#7, #22");
    expect(r).toContain("have already been drawn");
  });

  it("accepts numbers still in the pool", () => {
    expect(numbersRefusal([n("a", 7), n("b", 22)])).toBeNull();
  });
});

describe("manualPayoutPreview — the same arithmetic a drawn payout uses", () => {
  it("one line per lucky number, each with its OWN fee", () => {
    // $1,000/wk over 20 weeks at 2% = $20,000 gross, $400 fee, $19,600 net.
    const preview = manualPayoutPreview({
      numbers: [
        { id: "n1", number: 7, amount: 100_000, alreadyDrawn: false },
        { id: "n2", number: 22, amount: 50_000, alreadyDrawn: false },
      ],
      weeksCommitted: 20,
      feePercent: 2,
      calculate: (n) =>
        calculatePayout({
          luckyNumber: n,
          participation: { weeksCommitted: 20 },
          cycle: { feePercent: 2 },
        }),
    });
    expect(preview.lines).toEqual([
      { luckyNumberId: "n1", number: 7, gross: 2_000_000, fee: 40_000, net: 1_960_000 },
      { luckyNumberId: "n2", number: 22, gross: 1_000_000, fee: 20_000, net: 980_000 },
    ]);
    expect(preview.totalGross).toBe(3_000_000);
    expect(preview.totalFee).toBe(60_000);
    expect(preview.totalNet).toBe(2_940_000);
  });

  it("matches calculatePayout exactly — no separate money path", () => {
    const direct = calculatePayout({
      luckyNumber: { id: "n1", amount: 75_000 },
      participation: { weeksCommitted: 12 },
      cycle: { feePercent: 3 },
    });
    const preview = manualPayoutPreview({
      numbers: [{ id: "n1", number: 9, amount: 75_000, alreadyDrawn: false }],
      weeksCommitted: 12,
      feePercent: 3,
      calculate: (n) =>
        calculatePayout({
          luckyNumber: n,
          participation: { weeksCommitted: 12 },
          cycle: { feePercent: 3 },
        }),
    });
    expect(preview.lines[0]).toMatchObject({
      gross: direct.gross,
      fee: direct.fee,
      net: direct.net,
    });
  });
});

describe("a committed number cannot be assigned manually (2.3)", () => {
  const free = { id: "n1", number: 12, amount: 100_000, alreadyDrawn: false };

  it("REFUSES a number a plan has reserved for another week, and names it", () => {
    // THE DEFECT. The only per-number guard was `alreadyDrawn`, so #12 —
    // committed to week 9 — could be assigned to week 5 with no warning.
    // The plan then sat PLANNED on week 9 holding a drawn number:
    // selectWinningSlot throws, and on the SHARED draw screen that surfaces
    // only as the neutral error (2.4). The manual fallback is blocked too,
    // because weekChoice marks a planned undrawn week as blocked. Week 9
    // becomes undrawable live on Zoom, and only cancelling the plan recovers
    // it.
    const refusal = numbersRefusal([{ ...free, committedToWeek: 9 }]);
    expect(refusal).not.toBeNull();
    expect(refusal).toContain("#12");
    expect(refusal).toContain("week 9");
    // It must point at the undo, not merely refuse.
    expect(refusal).toContain("wheel setup");
  });

  it("allows an uncommitted number — the ordinary case is untouched", () => {
    expect(numbersRefusal([free])).toBeNull();
    expect(numbersRefusal([{ ...free, committedToWeek: null }])).toBeNull();
  });

  it("catches a committed number sitting among free ones", () => {
    const refusal = numbersRefusal([
      free,
      { id: "n2", number: 27, amount: 100_000, alreadyDrawn: false, committedToWeek: 15 },
    ]);
    expect(refusal).toContain("#27");
    expect(refusal).toContain("week 15");
  });

  it("the already-drawn refusal still fires", () => {
    expect(numbersRefusal([{ ...free, alreadyDrawn: true }])).not.toBeNull();
  });
});
