import { describe, expect, it } from "vitest";
import {
  buildArchiveData,
  closeBlockers,
  closingStatementText,
  cycleDeletePlan,
  finalBalanceEntries,
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
