import { describe, expect, it } from "vitest";
import {
  buildArchiveData,
  closeBlockers,
  closingStatementText,
  cycleDeletePlan,
  finalBalanceEntries,
  frozenCycleRefusal,
  type MemberFinal,
} from "./cycle-close";

const member = (over: Partial<MemberFinal> = {}): MemberFinal => ({
  participationId: "part-1",
  personId: "person-1",
  name: "Abebe",
  nameAmharic: "አበበ",
  weeklyAmount: 100_000,
  weeksCommitted: 20,
  weeksPaid: 20,
  outstanding: 0,
  lastPaymentWeek: 20,
  drawnWeek: 5,
  receivedNet: 1_860_000,
  // Awarded defaults to collected: the common case is a payout handed over.
  // A test that cares about the difference sets both explicitly.
  awardedNet: 1_860_000,
  pendingNet: 0,
  settledFromPayout: 100_000,
  totalPaid: 2_000_000,
  ...over,
});

describe("closeBlockers — 2.27: nobody may be quietly missed", () => {
  const undrawn = [{ name: "Abebe", numbers: [7, 22] }];

  it("blocks while someone paid in and was never drawn", () => {
    const check = closeBlockers({ undrawn });
    expect(check.blocked).toBe(true);
    expect(check.reasons[0]).toContain("Abebe");
    expect(check.reasons[0]).toContain("#7, #22");
  });

  it("an explicit acknowledgement with a real reason unblocks", () => {
    expect(closeBlockers({ undrawn, acknowledgeReason: "They agreed to roll into Cycle 2" }).blocked).toBe(false);
  });

  it("a blank or whitespace reason does NOT unblock", () => {
    expect(closeBlockers({ undrawn, acknowledgeReason: "" }).blocked).toBe(true);
    expect(closeBlockers({ undrawn, acknowledgeReason: "   " }).blocked).toBe(true);
  });

  it("nothing blocks when everyone was drawn", () => {
    expect(closeBlockers({ undrawn: [] }).blocked).toBe(false);
  });
});

describe("finalBalanceEntries — 2.18: debts land on the PERSON with their story", () => {
  it("a member short $2,000 after 12 of 20 weeks gets a DEBT that tells the story", () => {
    const entries = finalBalanceEntries(
      [
        member({
          personId: "p-behind",
          weeksPaid: 12,
          outstanding: 200_000,
          lastPaymentWeek: 12,
        }),
      ],
      "Cycle 1 2026",
    );
    expect(entries).toEqual([
      {
        personId: "p-behind",
        amount: 200_000,
        description:
          "Cycle 1 2026 closed — paid 12 of 20 weeks (last payment week 12), $2,000 unpaid",
      },
    ]);
  });

  it("fully-paid members get NOTHING", () => {
    expect(finalBalanceEntries([member()], "Cycle 1 2026")).toEqual([]);
  });

  it("one entry per short member, none for the rest", () => {
    const entries = finalBalanceEntries(
      [
        member(),
        member({ personId: "p2", outstanding: 50_000, weeksPaid: 19, lastPaymentWeek: 19 }),
        member({ personId: "p3", outstanding: 100_000, weeksPaid: 18, lastPaymentWeek: 18 }),
      ],
      "Cycle 1 2026",
    );
    expect(entries.map((e) => e.personId)).toEqual(["p2", "p3"]);
    expect(entries.map((e) => e.amount)).toEqual([50_000, 100_000]);
  });
});

describe("closingStatementText — 2.21: factual and calm, the law's own wording", () => {
  it("complete: “You completed all 20 weeks. Balance $0.”", () => {
    expect(
      closingStatementText({ weeksPaid: 20, weeksCommitted: 20, outstanding: 0, lastPaymentWeek: 20 }),
    ).toBe("You completed all 20 weeks. Balance $0.");
  });

  it("short: “You paid 12 of 20. Last payment week 12. Outstanding $2,000.”", () => {
    expect(
      closingStatementText({ weeksPaid: 12, weeksCommitted: 20, outstanding: 200_000, lastPaymentWeek: 12 }),
    ).toBe("You paid 12 of 20. Last payment week 12. Outstanding $2,000.");
  });

  it("short with no payment ever: no dangling “last payment” clause", () => {
    expect(
      closingStatementText({ weeksPaid: 0, weeksCommitted: 20, outstanding: 2_000_000, lastPaymentWeek: null }),
    ).toBe("You paid 0 of 20. Outstanding $20,000.");
  });

  it("settled early (fewer weeks, zero balance) stays factual", () => {
    expect(
      closingStatementText({ weeksPaid: 12, weeksCommitted: 20, outstanding: 0, lastPaymentWeek: 12 }),
    ).toBe("You paid 12 of 20. Balance $0.");
  });
});

describe("buildArchiveData — 2.9: every figure precomputed into the record", () => {
  it("totals derive from members and weeks; statements are baked in", () => {
    const archive = buildArchiveData({
      cycleName: "Cycle 1 2026",
      startDate: "2026-05-17",
      closedAt: "2026-09-27",
      plannedWeeks: 20,
      feePercent: 2,
      members: [
        member(),
        member({ personId: "p2", weeksPaid: 12, outstanding: 200_000, receivedNet: 0, drawnWeek: null, totalPaid: 1_200_000 }),
      ],
      weeks: [
        { weekNumber: 1, date: "2026-05-17", isSkipped: false, received: 300_000, draw: null },
        {
          weekNumber: 2,
          date: "2026-05-24",
          isSkipped: false,
          received: 2_900_000,
          draw: {
            numbers: [7],
            winners: ["Abebe"],
            payouts: [{ number: 7, who: "Abebe", net: 1_860_000, status: "COLLECTED", paidAt: "2026-05-25" }],
          },
        },
      ],
    });
    expect(archive.totals).toEqual({
      received: 3_200_000,
      paidOutNet: 1_860_000,
      // Nothing pending in this scenario — both payouts were collected.
      pendingNet: 0,
      stillHeld: 1_340_000,
      outstanding: 200_000,
      membersShort: 1,
    });
    expect(archive.members[0].statement).toBe("You completed all 20 weeks. Balance $0.");
    expect(archive.members[1].statement).toBe("You paid 12 of 20. Last payment week 20. Outstanding $2,000.");
  });
});

describe("cycleDeletePlan — 2.9: what goes, what stays, stated plainly", () => {
  it("removes only cycle-scoped data and keeps people, ledger, archive", () => {
    const plan = cycleDeletePlan({
      participations: 28,
      weeks: 20,
      receipts: 300,
      draws: 11,
      payouts: 12,
      luckyNumbers: 41,
      slots: 24,
      plans: 2,
    });
    expect(plan.removed.some((l) => l.includes("28 participations"))).toBe(true);
    expect(plan.removed.some((l) => l.includes("300 receipts"))).toBe(true);
    expect(plan.kept.some((l) => l.includes("PERSON"))).toBe(true);
    expect(plan.kept.some((l) => l.includes("ledger"))).toBe(true);
    expect(plan.kept.some((l) => l.includes("archive"))).toBe(true);
  });
});

describe("frozenCycleRefusal — audit H5: no money onto a closed cycle's weeks", () => {
  it("refuses a CLOSED cycle and names the correct path instead (2.19)", () => {
    const refusal = frozenCycleRefusal({ name: "Cycle 1", status: "CLOSED" });
    expect(refusal).not.toBeNull();
    expect(refusal).toContain("Cycle 1");
    expect(refusal).toContain("closed");
    // It must TELL the organizer where the money does belong, not just say no.
    expect(refusal).toContain("ledger");
  });

  it("lets an ACTIVE or DRAFT cycle through untouched", () => {
    expect(frozenCycleRefusal({ name: "Cycle 1", status: "ACTIVE" })).toBeNull();
    expect(frozenCycleRefusal({ name: "Cycle 2", status: "DRAFT" })).toBeNull();
  });
});

describe("the archive's cash position — a PENDING payout is still held", () => {
  // THE DEFECT. `receivedNet` summed every payout regardless of status, and
  // buildArchiveData built paidOutNet from it. A payout recorded but not yet
  // handed over therefore inflated "paid out" and understated "still held" by
  // the same figure — permanently, because the archive is rendered verbatim
  // and never recomputed. The same page then printed that payout's own row as
  // "pending", so the record contradicted itself on one screen.
  const collected = member({
    participationId: "p-collected",
    personId: "person-collected",
    receivedNet: 1_860_000,
    awardedNet: 1_860_000,
    pendingNet: 0,
  });
  const pending = member({
    participationId: "p-pending",
    personId: "person-pending",
    name: "Hana",
    // Drawn in the final week, money not yet handed over.
    receivedNet: 0,
    awardedNet: 1_960_000,
    pendingNet: 1_960_000,
  });
  const weeks = [
    { weekNumber: 1, date: "2026-05-17", isSkipped: false, received: 4_000_000, draw: null },
  ];

  const archive = buildArchiveData({
    cycleName: "Cycle 1 2026",
    startDate: "2026-05-17",
    closedAt: "2026-09-27T00:00:00.000Z",
    plannedWeeks: 20,
    feePercent: 2,
    members: [collected, pending],
    weeks,
  });

  it("counts only COLLECTED payouts as paid out", () => {
    expect(archive.totals.paidOutNet).toBe(1_860_000);
  });

  it("states what was awarded but not handed over, rather than hiding it", () => {
    expect(archive.totals.pendingNet).toBe(1_960_000);
  });

  it("STILL HELD includes the pending payout — the group has that cash", () => {
    // $40,000 received − $18,600 actually handed over = $21,400 held.
    // The old arithmetic reported $2,800, understating by exactly the pending
    // payout, and the organizer's final record of the cash position was wrong.
    expect(archive.totals.stillHeld).toBe(4_000_000 - 1_860_000);
    expect(archive.totals.stillHeld).not.toBe(4_000_000 - (1_860_000 + 1_960_000));
  });

  it("the totals reconcile: paid out + pending = everything awarded", () => {
    const awarded = [collected, pending].reduce((s, m) => s + m.awardedNet, 0);
    expect(archive.totals.paidOutNet + archive.totals.pendingNet).toBe(awarded);
  });

  it("a member's own row still shows what they were AWARDED", () => {
    // The member record must not lose the fact that they won: it is their
    // statement of the cycle, and a $0 against a drawn week reads as an error.
    const row = archive.members.find((m) => m.participationId === "p-pending")!;
    expect(row.awardedNet).toBe(1_960_000);
    expect(row.receivedNet).toBe(0);
    expect(row.pendingNet).toBe(1_960_000);
  });
});
