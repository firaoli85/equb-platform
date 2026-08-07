import { describe, expect, it } from "vitest";
import {
  feeAttributable,
  removalConsequences,
  removalRefusal,
  type ParticipationAttachments,
} from "./participation-removal";
import { calculateFee, calculateGross } from "./money";

// Removing someone from a cycle used to be a bare cascade delete: no preview,
// no choices, no guards. A dependency map of the schema found it left FOUR
// orphans behind. These tests are the figures the organizer now sees, and the
// cleanup that has to happen with each choice.

const base: ParticipationAttachments = {
  personName: "Tsion",
  cycleName: "Cycle 1 2026",
  weeklyAmount: 50_000, // $500/wk
  weeksCommitted: 20,
  receiptCount: 12,
  receiptTotal: 600_000, // $6,000 paid in
  weeksWithMoney: 12,
  numbers: [{ number: 19, drawn: false }],
  payouts: [],
  drawsLeftEmpty: [],
  plansLeftEmpty: [],
  feePercent: 2,
};

/** The same member, but already drawn and paid out. */
const drawn: ParticipationAttachments = {
  ...base,
  numbers: [{ number: 19, drawn: true }],
  payouts: [{ number: 19, net: 960_000, status: "COLLECTED", settlement: 50_000 }],
  drawsLeftEmpty: [{ weekNumber: 6 }],
  plansLeftEmpty: [{ weekNumber: 6 }],
};

describe("the fee attributable to them", () => {
  it("is 2% of what they contribute over the cycle", () => {
    // $500 × 20 = $10,000 gross, 2% = $200.
    expect(feeAttributable(base)).toBe(20_000);
  });

  it("does NOT scale with the number of lucky numbers they hold", () => {
    // THE DEFECT THIS PINS. `feeAttributable` multiplied gross by
    // `numbers.length`, so anyone contributing more than the unit amount had
    // their fee reported double — on the red typed-name confirmation, and then
    // written into the permanent audit entry.
    //
    // A member's numbers are SLICES of their weekly amount, not copies of it:
    // splitIntoLuckyNumbers($2,000, unit $1,000) → [$1,000, $1,000], and the
    // participation still stores weeklyAmount = $2,000. Holding two numbers
    // does not double what you pay in, so it cannot double the fee.
    //
    // The old test used $500/week across two numbers at a $1,000 unit — a
    // state the split can never produce — which is how it pinned the bug as
    // intended behaviour.
    const twoThousand: ParticipationAttachments = {
      ...base,
      weeklyAmount: 200_000, // $2,000/wk — the shape of live member Mulugeta
      numbers: [
        { number: 2, drawn: false },
        { number: 22, drawn: false },
      ],
    };
    // $2,000 × 20 = $40,000 gross, 2% = $800. NOT $1,600.
    expect(feeAttributable(twoThousand)).toBe(80_000);
  });

  it("agrees with calculateGross, which is what the rest of the platform uses", () => {
    // The one assertion that keeps the two derivations from drifting apart:
    // whatever the fee is here, it must be the fee on the gross the payout
    // arithmetic computes (lib/money.ts).
    for (const [weekly, weeks] of [
      [50_000, 20],
      [200_000, 20],
      [37_500, 13],
      [100_000, 1],
    ] as const) {
      const a: ParticipationAttachments = {
        ...base,
        weeklyAmount: weekly,
        weeksCommitted: weeks,
        // The number count is deliberately varied and must not matter.
        numbers: Array.from({ length: Math.max(1, Math.round(weekly / 100_000)) }, (_, i) => ({
          number: i + 1,
          drawn: false,
        })),
      };
      expect(feeAttributable(a), `${weekly}c × ${weeks}`).toBe(
        calculateFee(calculateGross(weekly, weeks), 2),
      );
    }
  });
});

describe("REMOVE COMPLETELY", () => {
  it("states the money erased, in real figures", () => {
    const c = removalConsequences(base, "remove-completely");
    expect(c.receivedErased).toBe(600_000);
    expect(c.lines[0]).toBe(
      "12 receipts totalling $6,000 are deleted, across 12 weeks.",
    );
  });

  it("names the fee that comes out of the cycle total", () => {
    const c = removalConsequences(base, "remove-completely");
    expect(c.lines.some((l) => l.includes("$200"))).toBe(true);
  });

  it("returns a DRAWN number to the wheel", () => {
    const c = removalConsequences(drawn, "remove-completely");
    expect(c.numbersReturning).toEqual([19]);
    expect(c.lines.some((l) => l.includes("#19 returns to the wheel pool."))).toBe(true);
  });

  it("reverses the settlement before deleting the payout", () => {
    const c = removalConsequences(drawn, "remove-completely");
    expect(
      c.lines.some((l) => l.includes("$500 of own-week contribution") && l.includes("reversed")),
    ).toBe(true);
  });

  it("flags COLLECTED money as already handed over", () => {
    const c = removalConsequences(drawn, "remove-completely");
    expect(c.lines.some((l) => l.includes("already handed over"))).toBe(true);
  });

  describe("the cash position moves the counter-intuitive way", () => {
    it("goes UP when the member had collected more than they paid in", () => {
      // Paid in $6,000, collected $9,600. Removing them lowers received by
      // $6,000 AND paid-out by $9,600, so `currentlyHeld` RISES by $3,600 —
      // the books claim more cash than before. Stated, not hidden.
      const c = removalConsequences(drawn, "remove-completely");
      expect(c.cashPositionDelta).toBe(360_000);
    });

    it("goes DOWN for a member who only ever paid in", () => {
      const c = removalConsequences(base, "remove-completely");
      expect(c.cashPositionDelta).toBe(-600_000);
    });
  });

  describe("the cleanup that stops the four orphans", () => {
    it("undoes a draw that would be left with no winners at all", () => {
      const c = removalConsequences(drawn, "remove-completely");
      expect(
        c.cleanup.some((l) => l.includes("Week 6's draw is undone")),
      ).toBe(true);
      expect(c.cleanup.some((l) => l.includes("permanently blocking that week"))).toBe(true);
    });

    it("deletes a winner plan left with zero numbers — the vacuous-every trap", () => {
      // `[].every(...)` is TRUE, so an emptied plan matches the FIRST eligible
      // slot and rigs the next draw while auditing it as "planned".
      const c = removalConsequences(drawn, "remove-completely");
      expect(c.cleanup.some((l) => l.includes("winner plan") && l.includes("week 6"))).toBe(true);
      expect(c.cleanup.some((l) => l.includes("rig the next draw"))).toBe(true);
    });

    it("has NOTHING to clean up when the member was never drawn", () => {
      const c = removalConsequences(base, "remove-completely");
      expect(c.cleanup).toEqual([]);
    });

    it("does not undo a SHARED week's draw — the other winner keeps it", () => {
      // drawsLeftEmpty only lists draws with no winners remaining, so a slot
      // holding two people's numbers is untouched.
      const shared = { ...drawn, drawsLeftEmpty: [] };
      const c = removalConsequences(shared, "remove-completely");
      expect(c.cleanup.some((l) => l.includes("draw is undone"))).toBe(false);
    });
  });
});

describe("KEEP THE MONEY RECORDS", () => {
  it("erases no money at all", () => {
    const c = removalConsequences(drawn, "keep-money-records");
    expect(c.receivedErased).toBe(0);
    expect(c.paidOutErased).toBe(0);
    expect(c.cashPositionDelta).toBe(0);
  });

  it("says the receipts and the payout STAY", () => {
    const c = removalConsequences(drawn, "keep-money-records");
    expect(c.lines.some((l) => l.includes("STAY in the books"))).toBe(true);
    expect(c.lines.some((l) => l.includes("stays drawn"))).toBe(true);
  });

  it("takes UNDRAWN numbers out of the pool without destroying them (2.27)", () => {
    const c = removalConsequences(base, "keep-money-records");
    expect(c.numbersDestroyed).toEqual([]);
    expect(c.lines.some((l) => l.includes("leaves the wheel pool"))).toBe(true);
    expect(c.lines.some((l) => l.includes("can no longer be drawn"))).toBe(true);
  });

  it("needs no cleanup — nothing is orphaned because nothing is deleted", () => {
    const c = removalConsequences(drawn, "keep-money-records");
    expect(c.cleanup).toEqual([]);
  });

  it("never claims the cash position moves", () => {
    const c = removalConsequences(drawn, "keep-money-records");
    expect(c.lines.some((l) => l.includes("cash position does not move"))).toBe(true);
  });
});

describe("the two choices are genuinely different", () => {
  it("differ on every money figure for a drawn member", () => {
    const complete = removalConsequences(drawn, "remove-completely");
    const keep = removalConsequences(drawn, "keep-money-records");
    expect(complete.receivedErased).not.toBe(keep.receivedErased);
    expect(complete.paidOutErased).not.toBe(keep.paidOutErased);
    expect(complete.cashPositionDelta).not.toBe(keep.cashPositionDelta);
    expect(complete.numbersReturning).not.toEqual(keep.numbersReturning);
  });

  it("neither is a default — both are described in full", () => {
    for (const choice of ["remove-completely", "keep-money-records"] as const) {
      const c = removalConsequences(drawn, choice);
      expect(c.lines.length).toBeGreaterThan(2);
      for (const line of c.lines) {
        expect(line).not.toContain("undefined");
        expect(line).not.toContain("NaN");
        expect(line.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe("refusals", () => {
  it("refuses any removal from a CLOSED cycle — the books are frozen", () => {
    expect(
      removalRefusal({ cycleStatus: "CLOSED", choice: "remove-completely", alreadyClosed: false }),
    ).toContain("books are frozen");
  });

  it("refuses closing someone who is already closed", () => {
    expect(
      removalRefusal({ cycleStatus: "ACTIVE", choice: "keep-money-records", alreadyClosed: true }),
    ).toContain("already closed");
  });

  it("still allows a COMPLETE removal of someone already closed", () => {
    // Their records exist and the organizer may still want them gone entirely.
    expect(
      removalRefusal({ cycleStatus: "ACTIVE", choice: "remove-completely", alreadyClosed: true }),
    ).toBeNull();
  });

  it("allows the ordinary case", () => {
    expect(
      removalRefusal({ cycleStatus: "ACTIVE", choice: "remove-completely", alreadyClosed: false }),
    ).toBeNull();
  });
});
