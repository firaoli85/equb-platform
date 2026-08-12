import { describe, expect, it } from "vitest";
import {
  CLOSE_REASONS,
  closeConsequences,
  closePlan,
  closeReasonText,
  closeRefusal,
  effectiveFinishWeek,
  inBreak,
  legacyBreak,
  inWindow,
  isCloseReason,
  reactivateConsequences,
  reactivatePlan,
  reactivateRefusal,
  stoppedSentence,
  weeksLeavingExpectation,
  windowBreaks,
  type WindowBreak,
} from "./participation-close";
import { memberAttention, receiptsByWeek, weekMemberStatus } from "./dashboard";
import { eligibleNumbers, undrawnWindowWarnings } from "./wheel";
import { formatMoney } from "./format";

// TWO MEMBERS STOPPED AND WILL NOT RESUME, and the system went on counting
// their remaining weeks as money that should arrive. Everything below is one
// of the consequences of saying so.
//
// A PRODUCTION-SHAPED FIXTURE, not three toy rows: a 20-week cycle at $1,000
// a week, numbers sequential from 1, a member who stops after being PAID OUT
// (the case that decides the arithmetic), a member who stops without ever
// being drawn, and members who are simply behind and WILL pay.

const WEEKS = Array.from({ length: 20 }, (_, i) => ({
  weekNumber: i + 1,
  isSkipped: false,
}));

/** 20 weeks at $1,000. */
const full = (id: string) => ({
  id,
  weeklyAmount: 100_000,
  startWeek: 1,
  weeksCommitted: 20,
  breaks: [] as WindowBreak[],
});

/** They stopped after week n and have not come back. */
const stoppedAfter = (n: number): WindowBreak[] => [{ fromWeek: n + 1, toWeek: null }];

/** They stopped after week n and resumed at week r. */
const awayBetween = (n: number, r: number): WindowBreak[] => [{ fromWeek: n + 1, toWeek: r - 1 }];

/** Paid in full for weeks 1..n. */
const paidThrough = (id: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({
    participationId: id,
    weekNumber: i + 1,
    amountPaid: 100_000,
    isDeferred: false,
    isSkipped: false,
  }));

describe("inWindow — the one predicate the whole feature rests on", () => {
  it("leaves a contributing member's window exactly as it was", () => {
    expect(effectiveFinishWeek({ startWeek: 1, weeksCommitted: 20 })).toBe(20);
    expect(effectiveFinishWeek({ startWeek: 5, weeksCommitted: 6, breaks: [] })).toBe(10);
    for (const w of [1, 10, 20]) {
      expect(inWindow({ startWeek: 1, weeksCommitted: 20 }, w)).toBe(true);
    }
    expect(inWindow({ startWeek: 1, weeksCommitted: 20 }, 21)).toBe(false);
  });

  it("ends the window at the week they stopped — INCLUSIVE", () => {
    const p = { startWeek: 1, weeksCommitted: 20, breaks: stoppedAfter(12) };
    expect(effectiveFinishWeek(p)).toBe(12);
    // Week 12 is still theirs; week 13 is not.
    expect(inWindow(p, 12)).toBe(true);
    expect(inWindow(p, 13)).toBe(false);
    expect(inWindow(p, 20)).toBe(false);
  });

  // A BREAK IS A HOLE, NOT A TRUNCATION. This is the distinction a single
  // closedAtWeek column could not express, and the live verification is what
  // found it: a reactivated member was ACTIVE again, so the cutoff was
  // ignored and the weeks they were away came back as arrears.
  it("keeps the weeks they were AWAY out, and brings the later ones back", () => {
    const p = { startWeek: 1, weeksCommitted: 20, breaks: awayBetween(5, 9) };
    expect(inWindow(p, 5)).toBe(true); // last week before they stopped
    expect(inWindow(p, 6)).toBe(false); // away
    expect(inWindow(p, 8)).toBe(false); // away
    expect(inWindow(p, 9)).toBe(true); // back
    expect(inWindow(p, 20)).toBe(true); // and their finish is unchanged
    expect(effectiveFinishWeek(p)).toBe(20);
  });

  // A member who stops, resumes, and stops again has TWO holes. One column
  // could hold one of them; the second close would silently hand the first
  // gap back as arrears.
  it("holds more than one break at once", () => {
    const p = {
      startWeek: 1,
      weeksCommitted: 20,
      breaks: [...awayBetween(5, 9), ...stoppedAfter(14)],
    };
    expect([1, 5, 9, 14].every((w) => inWindow(p, w))).toBe(true);
    expect([6, 7, 8, 15, 20].some((w) => inWindow(p, w))).toBe(false);
    expect(effectiveFinishWeek(p)).toBe(14);
  });

  it("an EMPTY break — they resumed immediately — excludes nothing", () => {
    const p = { startWeek: 1, weeksCommitted: 20, breaks: awayBetween(5, 6) };
    expect(inBreak(p.breaks, 5)).toBe(false);
    expect(inBreak(p.breaks, 6)).toBe(false);
    for (const w of [1, 5, 6, 20]) expect(inWindow(p, w)).toBe(true);
  });

  it("never EXTENDS a window — a break past their finish changes nothing", () => {
    expect(effectiveFinishWeek({ startWeek: 1, weeksCommitted: 10, breaks: stoppedAfter(18) })).toBe(10);
  });

  it("counts the weeks that leave", () => {
    expect(
      weeksLeavingExpectation({ startWeek: 1, weeksCommitted: 20, closingAtWeek: 12 }),
    ).toBe(8);
    expect(weeksLeavingExpectation({ startWeek: 1, weeksCommitted: 20, closingAtWeek: 20 })).toBe(0);
    // Never negative, whatever is passed.
    expect(weeksLeavingExpectation({ startWeek: 1, weeksCommitted: 20, closingAtWeek: 99 })).toBe(0);
  });
});

// ————————————————— THE CASCADE: expectations really drop —————————————————

describe("closing drops the expectation, and NOTHING else", () => {
  const members = [full("a"), full("b"), full("c")];
  const payments = [...paidThrough("a", 12), ...paidThrough("b", 12), ...paidThrough("c", 12)];

  it("counts all three while everybody is contributing", () => {
    const series = receiptsByWeek({
      weeks: WEEKS,
      participations: members,
      payments,
      elapsedThroughWeek: 12,
    });
    expect(series[12].expected).toBe(300_000); // week 13: three members
    expect(series[19].expected).toBe(300_000); // week 20
  });

  // THE BUG, stated as a test: a member who has stopped must stop being
  // counted as money that should arrive.
  it("stops counting a stopped member from the week AFTER they stopped", () => {
    const series = receiptsByWeek({
      weeks: WEEKS,
      participations: [{ ...members[0], breaks: stoppedAfter(12) }, members[1], members[2]],
      payments,
      elapsedThroughWeek: 12,
    });
    expect(series[11].expected).toBe(300_000); // week 12 — still theirs
    expect(series[12].expected).toBe(200_000); // week 13 — gone
    expect(series[19].expected).toBe(200_000);
    // Eight weeks at $1,000 leave the whole-cycle expectation.
    const total = series.reduce((s, w) => s + w.expected, 0);
    const before = receiptsByWeek({
      weeks: WEEKS,
      participations: members,
      payments,
      elapsedThroughWeek: 12,
    }).reduce((s, w) => s + w.expected, 0);
    expect(before - total).toBe(800_000);
  });

  // "What they paid stays exactly as recorded."
  it("keeps every cent they paid in the received figures", () => {
    const open = receiptsByWeek({
      weeks: WEEKS,
      participations: members,
      payments,
      elapsedThroughWeek: 12,
    });
    const closed = receiptsByWeek({
      weeks: WEEKS,
      participations: [{ ...members[0], breaks: stoppedAfter(12) }, members[1], members[2]],
      payments,
      elapsedThroughWeek: 12,
    });
    for (let i = 0; i < 20; i++) expect(closed[i].received).toBe(open[i].received);
    expect(closed.reduce((s, w) => s + w.received, 0)).toBe(3_600_000);
  });

  it("takes them out of membersExpected too, so the week's count is honest", () => {
    const series = receiptsByWeek({
      weeks: WEEKS,
      participations: [{ ...members[0], breaks: stoppedAfter(12) }, members[1], members[2]],
      payments,
      elapsedThroughWeek: 12,
    });
    expect(series[11].membersExpected).toBe(3);
    expect(series[12].membersExpected).toBe(2);
  });

  it("drops them from the week grid after they stopped, and keeps them before", () => {
    const named = [
      { ...members[0], breaks: stoppedAfter(12), name: "Meheret" },
      { ...members[1], name: "Abebe" },
    ];
    const before = weekMemberStatus({ weekNumber: 12, participations: named, payments });
    const after = weekMemberStatus({ weekNumber: 13, participations: named, payments });
    expect(before.map((r) => r.name)).toEqual(["Abebe", "Meheret"]);
    expect(after.map((r) => r.name)).toEqual(["Abebe"]);
  });

  // BEHIND AND STOPPED ARE NOT THE SAME FACT. This is the conflation the
  // whole build exists to end.
  it("takes a stopped member OUT of the behind list entirely", () => {
    const named = [
      { ...members[0], name: "Meheret" }, // paid 12 of 20
      { ...members[1], name: "Abebe" },
    ];
    // At week 16 they are both four weeks behind.
    const behind = memberAttention({
      participations: named,
      payments,
      elapsedThroughWeek: 16,
    });
    expect(behind.map((m) => m.name).sort()).toEqual(["Abebe", "Meheret"]);

    const afterClose = memberAttention({
      participations: [{ ...named[0], breaks: stoppedAfter(12) }, named[1]],
      payments,
      elapsedThroughWeek: 16,
    });
    // Meheret is not late. She stopped, and her money is not coming.
    expect(afterClose.map((m) => m.name)).toEqual(["Abebe"]);
  });
});

// ————————————————— The lucky number leaves the pool (2.27) —————————————————

describe("their numbers leave the wheel — they cannot win a week they left", () => {
  const numbers = [
    { id: "n1", number: 1, amount: 100_000, participationId: "a" },
    { id: "n2", number: 2, amount: 100_000, participationId: "b" },
  ];
  const wheelMembers = (aStatus: "ACTIVE" | "CLOSED") => [
    { id: "a", name: "Meheret", startWeek: 1, weeksCommitted: 20, status: aStatus },
    { id: "b", name: "Abebe", startWeek: 1, weeksCommitted: 20, status: "ACTIVE" as const },
  ];

  it("both are drawable while both are contributing", () => {
    const pool = eligibleNumbers({
      luckyNumbers: numbers,
      participations: wheelMembers("ACTIVE"),
      drawnNumberIds: new Set(),
      currentWeek: 13,
    });
    expect(pool.map((n) => n.number)).toEqual([1, 2]);
  });

  it("a stopped member's number is out of the pool", () => {
    const pool = eligibleNumbers({
      luckyNumbers: numbers,
      participations: wheelMembers("CLOSED"),
      drawnNumberIds: new Set(),
      currentWeek: 13,
    });
    expect(pool.map((n) => n.number)).toEqual([2]);
  });

  // The 2.27 safeguard protects people who might be MISSED. Somebody who
  // stopped was not missed, and warning about them teaches the organizer to
  // ignore the warning that protects everyone else.
  it("does not warn that a stopped member is undrawn", () => {
    const warnings = undrawnWindowWarnings({
      luckyNumbers: numbers,
      participations: wheelMembers("CLOSED"),
      drawnNumberIds: new Set(),
      currentWeek: 19,
      weeksAhead: 3,
    });
    expect(warnings.map((w) => w.name)).toEqual(["Abebe"]);
  });
});

// ————————————————— Refusals —————————————————

describe("closeRefusal — named, never a bare 'cannot'", () => {
  const base = {
    memberName: "Meheret",
    cycleName: "Cycle 1 2026",
    cycleStatus: "ACTIVE" as const,
    participationStatus: "ACTIVE" as const,
    committedPlan: null,
    closingAtWeek: 12,
    startWeek: 1,
    weeksCommitted: 20,
  };

  it("allows the ordinary case", () => {
    expect(closeRefusal(base)).toBeNull();
  });

  // A committed plan is frozen (2.3). Taking the number out of the pool
  // behind its back leaves the draw falling through to chance on a week the
  // organizer had already decided.
  it("REFUSES when they hold a committed winner plan, and NAMES it", () => {
    const r = closeRefusal({
      ...base,
      committedPlan: { weekNumber: 17, numbers: [4, 5] },
    });
    expect(r).toContain("committed winner plan");
    expect(r).toContain("week 17");
    expect(r).toContain("#4, #5");
    expect(r).toContain("Release the plan first");
  });

  it("names an undated planned week rather than saying 'week null'", () => {
    const r = closeRefusal({ ...base, committedPlan: { weekNumber: null, numbers: [4] } });
    expect(r).toContain("a week you have not dated yet");
    expect(r).not.toContain("null");
  });

  it("refuses on a CLOSED cycle — its books are final", () => {
    expect(closeRefusal({ ...base, cycleStatus: "CLOSED" })).toContain("books are final");
  });

  it("refuses a second close", () => {
    expect(closeRefusal({ ...base, participationStatus: "CLOSED" })).toContain("already closed");
  });

  it("refuses a closing week before they even started", () => {
    expect(closeRefusal({ ...base, startWeek: 15, closingAtWeek: 12 })).toContain(
      "no weeks to close",
    );
  });
});

describe("reactivateRefusal", () => {
  const base = {
    memberName: "Meheret",
    cycleName: "Cycle 1 2026",
    cycleStatus: "ACTIVE" as const,
    participationStatus: "CLOSED" as const,
  };
  it("allows it while the cycle is open — 2.23, he is never trapped", () => {
    expect(reactivateRefusal(base)).toBeNull();
  });
  it("is PERMANENT once the cycle closes", () => {
    const r = reactivateRefusal({ ...base, cycleStatus: "CLOSED" });
    expect(r).toContain("permanent");
    expect(r).toContain("carried balance is already on their record");
  });
  it("says so when they never stopped", () => {
    expect(reactivateRefusal({ ...base, participationStatus: "ACTIVE" })).toContain(
      "already contributing",
    );
  });
});

// ————————————————— THE CASE THAT DECIDES THE ARITHMETIC —————————————————

describe("paid out, then stopped — the money is gone, and it is his to cover", () => {
  // The organizer's own example: Meheret, $1,000 a week for 20 weeks, drawn
  // and paid $19,600 net, stops at week 12.
  const meheret = {
    memberName: "Meheret",
    cycleName: "Cycle 1 2026",
    startWeek: 1,
    weeksCommitted: 20,
    weeklyAmount: 100_000,
    closingAtWeek: 12,
    outstandingToDate: 0,
    undrawnNumbers: [] as number[],
    alreadyPaidOut: 1_960_000,
  };

  it("states it exactly as he does", () => {
    const plan = closePlan(meheret);
    expect(plan.amountLeaving).toBe(800_000);
    expect(plan.shortfallToCover).toBe(800_000);
    expect(
      stoppedSentence({
        memberName: "Meheret",
        closedAtWeek: 12,
        amountLeaving: plan.amountLeaving,
        alreadyPaidOut: plan.alreadyPaidOut,
        balanceRecorded: 0,
      }),
    ).toBe(
      "Meheret was paid $19,600 and stopped at week 12. $8,000 of their contributions will " +
        "not arrive — you would need to cover that.",
    );
  });

  // NOT paid out is a different fact and must not read the same. Their number
  // leaves the pool with them, so no pot is handed over against those weeks.
  it("does NOT make it his to cover when they were never paid out", () => {
    const plan = closePlan({ ...meheret, alreadyPaidOut: 0 });
    expect(plan.amountLeaving).toBe(800_000);
    expect(plan.shortfallToCover).toBe(0);
    const s = stoppedSentence({
      memberName: "Meheret",
      closedAtWeek: 12,
      amountLeaving: plan.amountLeaving,
      alreadyPaidOut: 0,
      balanceRecorded: 0,
    });
    expect(s).toContain("$8,000 of their contributions will not arrive");
    expect(s).toContain("never paid out, so there is nothing for you to cover");
  });

  // A PENDING payout has not left his hands. Nothing is gone yet.
  it("counts only money actually handed over, never a pending payout", () => {
    // `alreadyPaidOut` is fed from COLLECTED payouts only — see the action.
    // Here: the same member with a pending payout reports 0 handed over.
    expect(closePlan({ ...meheret, alreadyPaidOut: 0 }).shortfallToCover).toBe(0);
  });

  it("the unpaid weeks up to the closing point become the recorded balance", () => {
    const plan = closePlan({ ...meheret, outstandingToDate: 250_000 });
    expect(plan.balanceToRecord).toBe(250_000);
    // And it is NOT added to what he has to cover: it is on their record.
    expect(plan.shortfallToCover).toBe(800_000);
  });

  it("never reports a negative balance, whatever the standing says", () => {
    expect(closePlan({ ...meheret, outstandingToDate: -5 }).balanceToRecord).toBe(0);
  });
});

// ————————————————— The confirmation states every consequence —————————————————

describe("closeConsequences — real figures, before he commits (2.23)", () => {
  const plan = closePlan({
    memberName: "Meheret",
    cycleName: "Cycle 1 2026",
    startWeek: 1,
    weeksCommitted: 20,
    weeklyAmount: 100_000,
    closingAtWeek: 12,
    outstandingToDate: 200_000,
    undrawnNumbers: [7, 3],
    alreadyPaidOut: 1_960_000,
  });

  it("names the weeks, the money, the balance, the numbers and the hole", () => {
    const lines = closeConsequences(plan).join(" ");
    expect(lines).toContain("Weeks 13 onward — 8 weeks, $8,000");
    expect(lines).toContain("$2,000 they have not paid up to week 12");
    expect(lines).toContain("goes onto their own record");
    expect(lines).toContain("#3, #7"); // sorted, never input order
    expect(lines).toContain("leave the wheel");
    expect(lines).toContain("$8,000 of contributions against it will not arrive");
    expect(lines).toContain("stays exactly as recorded");
    expect(lines).toContain("Reversible while Cycle 1 2026 is open");
  });

  it("says the hole is not there when they were never paid out", () => {
    const lines = closeConsequences(closePlan({
      memberName: "Meheret",
      cycleName: "Cycle 1 2026",
      startWeek: 1,
      weeksCommitted: 20,
      weeklyAmount: 100_000,
      closingAtWeek: 12,
      outstandingToDate: 0,
      undrawnNumbers: [],
      alreadyPaidOut: 0,
    })).join(" ");
    expect(lines).not.toContain("yours to cover");
    expect(lines).toContain("paid up to week 12, so nothing goes onto their record");
    expect(lines).toContain("no undrawn numbers");
  });

  it("never emits a bare number, NaN, or a negative-looking amount", () => {
    for (const week of [1, 5, 12, 19, 20]) {
      for (const paid of [0, 1_960_000]) {
        const lines = closeConsequences(
          closePlan({
            memberName: "Meheret",
            cycleName: "Cycle 1 2026",
            startWeek: 1,
            weeksCommitted: 20,
            weeklyAmount: 100_000,
            closingAtWeek: week,
            outstandingToDate: 0,
            undrawnNumbers: [],
            alreadyPaidOut: paid,
          }),
        );
        for (const line of lines) {
          expect(line).not.toContain("NaN");
          expect(line).not.toContain("undefined");
          expect(line).not.toContain("$-");
          expect(line.length).toBeGreaterThan(20);
        }
      }
    }
  });
});

// ————————————————— Reactivation is FORWARD ONLY —————————————————

describe("reactivatePlan — restores from here, never retroactively", () => {
  const base = {
    memberName: "Meheret",
    startWeek: 1,
    weeksCommitted: 20,
    weeklyAmount: 100_000,
    closedAtWeek: 12,
    undrawnNumbers: [3],
  };

  it("brings back only the weeks from the restart point on", () => {
    const plan = reactivatePlan({ ...base, fromWeek: 16 });
    expect(plan.fromWeek).toBe(16);
    expect(plan.weeksReturning).toBe(5); // 16..20
    expect(plan.amountReturning).toBe(500_000);
    // Weeks 13, 14, 15 passed with them out. Nothing was expected then.
    expect(plan.weeksStayingClosed).toBe(3);
  });

  // THE WHOLE POINT. Restoring the gap would invent arrears that never
  // existed, for weeks nobody ever asked them about.
  it("cannot restart before the week after the close, even if asked to", () => {
    const plan = reactivatePlan({ ...base, fromWeek: 4 });
    expect(plan.fromWeek).toBe(13);
    expect(plan.weeksReturning).toBe(8); // 13..20, not 4..20
    expect(plan.weeksStayingClosed).toBe(0);
  });

  it("never restarts before their own start week", () => {
    const plan = reactivatePlan({
      ...base,
      startWeek: 8,
      weeksCommitted: 13,
      closedAtWeek: 2,
      fromWeek: 1,
    });
    expect(plan.fromWeek).toBe(8);
  });

  it("does not push their finish out — the commitment ends where it always did", () => {
    const late = reactivatePlan({ ...base, fromWeek: 19 });
    expect(late.weeksReturning).toBe(2); // 19, 20
    const past = reactivatePlan({ ...base, fromWeek: 21 });
    expect(past.weeksReturning).toBe(0);
    expect(past.amountReturning).toBe(0);
  });

  it("returns their undrawn numbers to the wheel, sorted", () => {
    const plan = reactivatePlan({ ...base, fromWeek: 16, undrawnNumbers: [9, 3] });
    expect(plan.numbersReturningToPool).toEqual([3, 9]);
  });

  it("says the balance already recorded STAYS — it belongs to the person", () => {
    const lines = reactivateConsequences(reactivatePlan({ ...base, fromWeek: 16 })).join(" ");
    expect(lines).toContain("expected again from week 16");
    expect(lines).toContain("5 weeks, $5,000");
    expect(lines).toContain("3 weeks they were away stay closed");
    expect(lines).toContain("balance already recorded on their own record stays");
  });

  it("says plainly when there is nothing to bring back", () => {
    const lines = reactivateConsequences(reactivatePlan({ ...base, fromWeek: 25 })).join(" ");
    expect(lines).toContain("commitment has already run out");
    expect(lines).not.toContain("NaN");
  });
});

// ————————————————— The legacy back door —————————————————

describe("legacyBreak / windowBreaks — members closed before the table existed", () => {
  // `removeFromCycle`s "keep their money records" has always written CLOSED
  // with a null week. Correct then, because every screen dropped CLOSED
  // members entirely. Now they are back IN the series, so no break at all
  // would restore their full window — this build own bug, arriving through
  // the back door.
  it("leaves a contributing member alone", () => {
    expect(
      legacyBreak({ status: "ACTIVE", startWeek: 1, closedAtWeek: null, lastWeekWithMoney: 9 }),
    ).toBeNull();
  });

  it("uses the recorded stopping week when there is one", () => {
    expect(
      legacyBreak({ status: "CLOSED", startWeek: 1, closedAtWeek: 12, lastWeekWithMoney: 9 }),
    ).toEqual({ fromWeek: 13, toWeek: null });
  });

  it("falls back to their LAST PAYMENT — the fact 2.18 preserves anyway", () => {
    expect(
      legacyBreak({ status: "CLOSED", startWeek: 1, closedAtWeek: null, lastWeekWithMoney: 9 }),
    ).toEqual({ fromWeek: 10, toWeek: null });
  });

  it("expects nothing at all from someone closed who never paid", () => {
    const b = legacyBreak({
      status: "CLOSED",
      startWeek: 1,
      closedAtWeek: null,
      lastWeekWithMoney: null,
    })!;
    expect(b).toEqual({ fromWeek: 1, toWeek: null });
    for (const w of [1, 5, 20]) {
      expect(inWindow({ startWeek: 1, weeksCommitted: 20, breaks: [b] }, w)).toBe(false);
    }
  });

  // REAL ROWS WIN. A backfilled row already carries its break, and deriving a
  // second one would re-open a break the organizer has already ended.
  it("never invents a break for a row that has its own", () => {
    const real = awayBetween(5, 9);
    expect(
      windowBreaks({
        status: "ACTIVE",
        startWeek: 1,
        closedAtWeek: null,
        lastWeekWithMoney: 4,
        breaks: real,
      }),
    ).toEqual(real);
  });

  // The regression this exists to prevent, stated directly.
  it("a legacy closed member is NOT re-expected once they are back in the series", () => {
    const legacy = {
      ...full("legacy"),
      breaks: windowBreaks({
        status: "CLOSED",
        startWeek: 1,
        closedAtWeek: null,
        lastWeekWithMoney: 9,
        breaks: [],
      }),
    };
    const series = receiptsByWeek({
      weeks: WEEKS,
      participations: [legacy, full("b")],
      payments: paidThrough("legacy", 9),
      elapsedThroughWeek: 12,
    });
    expect(series[8].expected).toBe(200_000); // week 9 — still theirs
    expect(series[9].expected).toBe(100_000); // week 10 — gone
    // And their money is still counted.
    expect(series.reduce((s, w) => s + w.received, 0)).toBe(900_000);
  });
});

// ————————————————— The reason is neutral, and it is a list —————————————————

describe("the reason — neutral, from a fixed list, never personal", () => {
  it("offers exactly the four the organizer named", () => {
    expect(CLOSE_REASONS.map((r) => r.label)).toEqual([
      "Stopped contributing",
      "Could not continue",
      "Left the group",
      "Other",
    ]);
  });

  it("refuses anything not on the list", () => {
    expect(isCloseReason("STOPPED_CONTRIBUTING")).toBe(true);
    expect(isCloseReason("DEADBEAT")).toBe(false);
    expect(isCloseReason("")).toBe(false);
    expect(isCloseReason(undefined)).toBe(false);
  });

  it("reads as the label alone, or the label plus the note", () => {
    expect(closeReasonText("LEFT_THE_GROUP", null)).toBe("Left the group");
    expect(closeReasonText("OTHER", "  moved states  ")).toBe("Other — moved states");
    expect(closeReasonText("OTHER", "   ")).toBe("Other");
  });

  it("says nothing about the person in any label or hint", () => {
    const judgemental = /\b(lazy|unreliable|refused|bad|delinquent|deadbeat|irresponsible)\b/i;
    for (const r of CLOSE_REASONS) {
      expect(r.label).not.toMatch(judgemental);
      expect(r.hint).not.toMatch(judgemental);
    }
  });
});

describe("stoppedSentence — plain English, the same register as the rest", () => {
  const cases = [
    { alreadyPaidOut: 1_960_000, amountLeaving: 800_000, balanceRecorded: 0 },
    { alreadyPaidOut: 0, amountLeaving: 800_000, balanceRecorded: 200_000 },
    { alreadyPaidOut: 0, amountLeaving: 0, balanceRecorded: 200_000 },
    { alreadyPaidOut: 0, amountLeaving: 0, balanceRecorded: 0 },
  ];

  it("uses no accounting vocabulary, ever (UI_STANDARDS 8b)", () => {
    const banned = /\b(uncommitted|committed|owed forward|claimed|net|arrears|delinquent)\b/i;
    for (const c of cases) {
      const s = stoppedSentence({ memberName: "Meheret", closedAtWeek: 12, ...c });
      expect(s).not.toMatch(banned);
      expect(s).not.toContain("NaN");
      expect(s).not.toContain("$-");
      expect(s.length).toBeGreaterThan(30);
    }
  });

  it("always says where they stopped", () => {
    for (const c of cases) {
      expect(stoppedSentence({ memberName: "Meheret", closedAtWeek: 12, ...c })).toContain(
        "stopped at week 12",
      );
    }
  });

  it("formats every figure through formatMoney, never a raw cent count", () => {
    const s = stoppedSentence({
      memberName: "Meheret",
      closedAtWeek: 12,
      amountLeaving: 800_000,
      alreadyPaidOut: 1_960_000,
      balanceRecorded: 0,
    });
    expect(s).toContain(formatMoney(1_960_000));
    expect(s).toContain(formatMoney(800_000));
    expect(s).not.toContain("800000");
  });
});
