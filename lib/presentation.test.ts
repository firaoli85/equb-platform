import { describe, expect, it } from "vitest";
import {
  numbersLabel,
  redactCycleDetail,
  redactDashboard,
  redactGrid,
  redactProposedSlots,
  redactWeekBoard,
  redactWheelState,
} from "./presentation";
import { SETTING_DEFAULTS } from "./settings";

// The tripwires: none of these strings may survive any redactor.
const NAME = "Tizita Bekele";
const AMHARIC = "ትዕግስት";
const PHONE = "+1 555 0100";
const SECRET_MARKERS = [NAME, AMHARIC, PHONE, "271500", "98700", "$"];

function leaks(value: unknown): string[] {
  const json = JSON.stringify(value);
  return SECRET_MARKERS.filter((m) => json.includes(m));
}

describe("presentation mode — the setting itself", () => {
  it("defaults to OFF", () => {
    expect(SETTING_DEFAULTS.presentationMode).toBe(false);
  });
});

describe("numbersLabel — the identity substitute", () => {
  it("formats one and many numbers, and falls back for none", () => {
    expect(numbersLabel([7])).toBe("#7");
    expect(numbersLabel([5, 13])).toBe("#5 + #13");
    expect(numbersLabel([])).toBe("Member");
  });
});

describe("redactDashboard", () => {
  const full = {
    cycle: { id: "c1", name: "Cycle 1", plannedWeeks: 20 },
    currentWeek: 9,
    weeksRemaining: 11,
    memberCount: 26,
    window: { lastOpenDayName: "Thursday", daysLeft: 2 },
    drawsCount: 10,
    paidOutCount: 9,
    undrawnWarnings: [
      { participationId: "p1", name: NAME, finishWeek: 12, weeksLeft: 3, numbers: [5, 13] },
    ],
    // Sensitive sections that must NOT survive:
    position: { totalReceived: 271500, totalPaidOut: 98700, currentlyHeld: 1 },
    series: [{ weekNumber: 1, expected: 271500, received: 98700, shortfall: 0 }],
    attention: [{ participationId: "p1", name: NAME, weeksBehind: 2, amountOwed: 271500 }],
    pendingPayouts: [{ id: "x", who: NAME, netAmount: 98700, weekNumber: 3 }],
    receivedByMember: [{ name: AMHARIC, total: 271500 }],
    paidOutDetail: [{ who: NAME, netAmount: 98700 }],
    thisWeekMembers: [{ name: NAME, phone: PHONE }],
    thisWeek: { expected: 271500, received: 98700 },
    closedShortfalls: [{ weekNumber: 3, shortfall: 271500 }],
  };

  it("keeps the cycle shape and warnings (numbers only) — nothing sensitive survives", () => {
    const redacted = redactDashboard(full);
    expect(leaks(redacted)).toEqual([]);
    expect(redacted.presentation).toBe(true);
    expect(redacted.currentWeek).toBe(9);
    expect(redacted.memberCount).toBe(26);
    expect(redacted.drawsCount).toBe(10);
    expect(redacted.undrawnWarnings[0].name).toBe("#5 + #13");
    // Allowlist: the money sections are ABSENT, not zeroed.
    expect("position" in redacted).toBe(false);
    expect("series" in redacted).toBe(false);
    expect("attention" in redacted).toBe(false);
    expect("pendingPayouts" in redacted).toBe(false);
    expect("receivedByMember" in redacted).toBe(false);
    expect("paidOutDetail" in redacted).toBe(false);
    expect("thisWeekMembers" in redacted).toBe(false);
  });
});

describe("redactGrid", () => {
  const full = {
    cycleName: "Cycle 1",
    currentCycleWeek: 9,
    grid: {
      columns: [
        {
          participationId: "p1",
          name: `${AMHARIC} — ${NAME}`,
          numbersLabel: "#5, #13",
          startWeek: 1,
          finishWeek: 20,
          weeksCredited: 8,
          outstanding: 271500,
        },
      ],
      rows: [
        {
          weekNumber: 1,
          date: new Date("2026-01-04"),
          isSkipped: false,
          received: 271500,
          expected: 98700,
          cells: [
            { kind: "week" as const, status: "PAID", storedPaid: 271500, amountDue: 98700 },
            { kind: "before-start" as const },
          ],
        },
      ],
    },
    memberWeekly: { p1: 271500 },
  };

  it("columns become numbers, statuses stay, money is gone", () => {
    const redacted = redactGrid(full);
    expect(leaks(redacted)).toEqual([]);
    expect(redacted.grid.columns[0].name).toBe("#5, #13");
    expect(redacted.grid.columns[0].outstanding).toBe(0);
    expect(redacted.grid.rows[0].cells[0]).toEqual({
      kind: "week",
      status: "PAID",
      storedPaid: 0,
      amountDue: 0,
    });
    expect(redacted.grid.rows[0].cells[1]).toEqual({ kind: "before-start" });
    expect(redacted.memberWeekly).toEqual({});
  });
});

describe("redactWeekBoard", () => {
  const member = {
    participationId: "p1",
    name: `${AMHARIC} — ${NAME}`,
    amountDue: 271500,
    amountPaidThisWeek: 98700,
    isDeferred: false,
    weeksBehind: 2,
    amountOwed: 271500,
  };
  const full = {
    cycleName: "Cycle 1",
    weekNumber: 9,
    weekDate: new Date("2026-03-01"),
    isSkipped: false,
    currentCycleWeek: 9,
    allWeeks: [{ weekNumber: 9, date: new Date("2026-03-01") }],
    expected: 271500,
    receivedTotal: 98700,
    membersPaid: 20,
    membersExpected: 26,
    windowDaysLeft: 2,
    owing: [member],
    paid: [],
    receiptsByParticipation: {
      p1: [{ eventId: "e1", appliedHere: 271500, eventAmount: 98700, method: "ZELLE" }],
    },
  };

  it("keeps who-and-state, drops names, amounts, and receipts", () => {
    const redacted = redactWeekBoard(full, () => "#5 + #13");
    expect(leaks(redacted)).toEqual([]);
    expect(redacted.owing[0].name).toBe("#5 + #13");
    expect(redacted.owing[0].weeksBehind).toBe(2);
    expect(redacted.owing[0].amountOwed).toBe(0);
    expect(redacted.expected).toBe(0);
    expect(redacted.receiptsByParticipation).toEqual({});
    expect(redacted.membersPaid).toBe(20);
  });
});

describe("redactWheelState", () => {
  const num = (over: Partial<Parameters<typeof redactWheelState>[0]["unassigned"][number]>) => ({
    id: "n1",
    number: 7,
    amount: 271500 as number | null,
    owner: NAME,
    eligible: true,
    lock: null as "frozen" | "anchored" | null,
    lockReason: null as string | null,
    ...over,
  });
  // Representative of the REAL getWheelState payload: a drawn number is
  // never pool-eligible, while a committed/anchored number still is — the
  // redactor must erase that difference or it names the planned winners.
  const full = {
    cycleName: "Cycle 1",
    unitAmount: 98700,
    currentWeek: 9,
    slots: [
      {
        id: "s1",
        position: 1,
        drawn: true,
        members: [
          num({ id: "d1", eligible: false, lock: "frozen" as const, lockReason: "already drawn — history" }),
        ],
        total: 271500,
      },
      {
        id: "s2",
        position: 2,
        drawn: false,
        members: [
          num({ id: "c1", eligible: true, lock: "frozen" as const, lockReason: "committed to a winner plan" }),
        ],
        total: 271500,
      },
    ],
    unassigned: [
      num({ id: "a1", lock: "anchored" as const, lockReason: "committed (open partner)" }),
      num({ id: "f1" }),
    ],
    plans: [{ id: "plan1", mode: "TOGETHER", weekNumber: 4, numbers: [5, 13] }],
    weeks: [{ id: "w4", weekNumber: 4, hasDraw: false, planned: true }],
    warnings: [
      { participationId: "p1", name: NAME, finishWeek: 12, weeksLeft: 3, numbers: [7] },
    ],
  };

  it("plans are NOT sent, locks collapse without reasons, money and owners are gone", () => {
    const redacted = redactWheelState(full);
    expect(leaks(redacted)).toEqual([]);
    expect(redacted.plans).toEqual([]);
    // A locked number still shows as locked — never WHY.
    const drawn = redacted.slots[0].members[0];
    expect(drawn.lock).toBe("frozen");
    expect(drawn.lockReason).toBeNull();
    // Anchored (open-partner plan) is indistinguishable from any other lock.
    const anchored = redacted.unassigned.find((n) => n.id === "a1")!;
    expect(anchored.lock).toBe("frozen");
    expect(anchored.lockReason).toBeNull();
    const free = redacted.unassigned.find((n) => n.id === "f1")!;
    expect(free.lock).toBeNull();
    // "planned" week markers are a plan indicator — gone.
    expect(redacted.weeks[0].planned).toBe(false);
    expect(redacted.unitAmount).toBeNull();
    expect(redacted.slots[0].total).toBeNull();
    expect(redacted.warnings[0].name).toBe("#7");
  });

  it("the WHY is underivable: no correlation channel distinguishes lock kinds", () => {
    const redacted = redactWheelState(full);
    // eligible collapses on EVERY locked number — otherwise frozen+eligible
    // would occur only for plan-committed numbers.
    const lockedMembers = [
      ...redacted.slots.flatMap((s) => s.members),
      ...redacted.unassigned,
    ].filter((n) => n.lock !== null);
    expect(lockedMembers.length).toBeGreaterThan(0);
    for (const n of lockedMembers) expect(n.eligible).toBe(false);
    // Free numbers keep real eligibility (the empty-wheel notice needs it).
    expect(redacted.unassigned.find((n) => n.id === "f1")!.eligible).toBe(true);
    // Per-slot drawn is not sent — a frozen number in an UNDRAWN slot could
    // only be plan-committed.
    for (const s of redacted.slots) expect(s.drawn).toBe(false);
    // The drawn-frozen and committed-frozen members are now byte-identical
    // in every distinguishing field.
    const d = redacted.slots[0].members[0];
    const c = redacted.slots[1].members[0];
    expect({ lock: d.lock, lockReason: d.lockReason, eligible: d.eligible }).toEqual({
      lock: c.lock,
      lockReason: c.lockReason,
      eligible: c.eligible,
    });
  });
});

describe("redactProposedSlots — proposals cross the wire by id only", () => {
  it("strips the anchored plan flag, member details, and money", () => {
    const proposal = [
      {
        luckyNumberIds: ["a1", "p1"],
        numbers: [{ id: "a1", number: 7, amount: 271500, participationId: "x" }],
        total: 271500,
        overUnit: true,
        anchored: true,
      },
    ];
    const redacted = redactProposedSlots(proposal);
    expect(redacted).toEqual([
      { luckyNumberIds: ["a1", "p1"], numbers: [], total: 0, overUnit: false },
    ]);
    // The allowlist rebuild must DROP the plan indicator, not carry it.
    expect("anchored" in redacted[0]).toBe(false);
    expect(leaks(redacted)).toEqual([]);
  });
});

describe("redactCycleDetail", () => {
  const full = {
    id: "c1",
    name: "Cycle 1",
    unitAmount: 98700,
    feePercent: 2,
    plannedWeeks: 20,
    weeks: [
      { id: "w3", weekNumber: 3, isSkipped: true, notes: `skipped — ${NAME}'s payout delayed` },
    ],
    participations: [
      {
        id: "p1",
        status: "ACTIVE",
        weeklyAmount: 271500,
        startWeek: 1,
        weeksCommitted: 20,
        person: {
          nameAmharic: AMHARIC,
          nameEnglishFirst: NAME,
          nameEnglishLast: "Bekele",
          phone: PHONE,
          notes: "prefers Zelle",
          authUserId: "auth-uuid",
          pinHash: "$2b$10$hash",
          pinFailedAttempts: 3,
          pinLockedUntil: new Date("2026-08-05"),
          pinLoginAllowed: true,
        },
        luckyNumbers: [{ id: "n1", number: 5, amount: 271500 }],
      },
    ],
  };

  it("identity becomes the numbers label; phones, auth and PIN state are blanked; money zeroed", () => {
    const redacted = redactCycleDetail(full);
    expect(leaks(redacted)).toEqual([]);
    const p = redacted.participations[0];
    expect(p.person.nameAmharic).toBe("#5");
    expect(p.person.nameEnglishFirst).toBe("");
    expect(p.person.phone).toBeNull();
    expect(p.person.pinHash).toBeNull();
    expect(p.person.authUserId).toBeNull();
    expect(p.weeklyAmount).toBe(0);
    expect(p.luckyNumbers[0].amount).toBe(0);
    expect(p.luckyNumbers[0].number).toBe(5);
    expect(redacted.unitAmount).toBe(0);
    expect(redacted.feePercent).toBe(0);
    // Week notes are free organizer text — blanked; the week itself survives.
    expect(redacted.weeks[0].notes).toBeNull();
    expect(redacted.weeks[0].weekNumber).toBe(3);
    // Structure (weeks, status, ids) survives so the page still works.
    expect(p.startWeek).toBe(1);
    expect(p.status).toBe("ACTIVE");
  });

  it("OFF path is the action's default: data passes through only when the mode is on", () => {
    // The redactors are only APPLIED when presentationMode is true — the
    // actions branch on the setting. This pins the pure contract: applying
    // no redactor changes nothing.
    expect(leaks(full).length).toBeGreaterThan(0);
  });
});
