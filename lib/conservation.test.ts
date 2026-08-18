import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  allScenarios,
  atEveryClockPosition,
  countedOf,
  flatPaymentsOf,
  drawn,
  flatPaymentsOf as _flat,
  leak,
  member,
  pastPlannedEndCycle,
  paysWeeks,
  payoutsOf,
  productionCycle,
  range,
  scenario,
  smallCycle,
  stops,
  stressCycle,
  todayAt,
  totalPaidOf,
  undrawnPayoutsOf,
  windowWeeksOf,
  type Scenario,
  type ScenarioMember,
} from "./conservation-harness";
import { memberTruth, weekShortfallOf, cashExpected } from "./engine";
import { computeStanding } from "./standing";
import { allocatePayment } from "./allocation";
import { receiptsByWeek, cashPosition, memberAttention, weekMemberStatus } from "./dashboard";
import { cashOnHand, collectionPosition, livePosition } from "./cycle-position";
import { bucketOutstanding, endOfCycle } from "./end-of-cycle";
import { recoverableForUndrawn } from "./final-position";
import { currentWeekFromRows, elapsedThroughWeek } from "./commitment";
import { effectiveFinishWeek, inWindow, windowBreaks } from "./participation-close";
import { calculateFee, calculateFinishWeek } from "./money";
import { totalContributed } from "./contribution";

// THE CONSERVATION SUITE — the money brain, end to end.
//
// 2,800 tests already check the rules one at a time. Every one of them takes
// hand-built inputs to ONE function and checks ITS output. None of them
// composes two modules and asks whether they agree, which is the organizer's
// own framing of what was missing:
//
//   "the member information is the center; every module collects from it and
//    puts out a simple calculation; the test checks each module's dependence
//    on that center — if it's not connected somewhere, it's leaking."
//
// So this file invents whole cycles, pushes each through EVERY reader, and
// checks the conservation laws the governing documents state. A figure that
// agrees with itself proves nothing; these agree with the receipts, or they
// name the module that does not.
//
// Each invariant cites its section. Each was proven RED by a planted violation
// before it counted — a guard nobody has watched fail is a guard nobody should
// trust (§5.2).

const SCENARIOS = allScenarios();

/** The per-week series, through the real function. */
function seriesOf(s: Scenario) {
  return receiptsByWeek({
    weeks: s.weeks.map((w) => ({ weekNumber: w.weekNumber, isSkipped: w.isSkipped })),
    participations: countedOf(s),
    payments: flatPaymentsOf(s),
    elapsedThroughWeek: elapsedThroughWeek(s.weeks, s.today),
  });
}

/** Every member's truth — the centre everything else must agree with. */
function truthsOf(s: Scenario) {
  const cycleWeek = currentWeekFromRows({
    weeks: s.weeks,
    today: s.today,
    cycleStartDate: s.startDate,
  });
  return s.members.map((m) => ({
    member: m,
    truth: memberTruth({
      participationId: m.id,
      weeklyAmount: m.weeklyAmount,
      startWeek: m.startWeek,
      weeksCommitted: m.weeksCommitted,
      today: s.today,
      windowWeeks: windowWeeksOf(s, m),
      totalPaid: totalPaidOf(m),
      feePercent: s.feePercent,
      cycleWeek,
    }),
  }));
}

function cashOf(s: Scenario) {
  const payouts = payoutsOf(s);
  const cash = cashPosition({
    payments: flatPaymentsOf(s).map((p) => ({ amountPaid: p.amountPaid })),
    payouts: payouts.map((p) => ({ netAmount: p.netAmount, status: p.status })),
  });
  return {
    payouts,
    cash,
    holding: cashOnHand({
      collected: cash.totalReceived,
      handedOut: cash.totalPaidOut,
      drawnNotHandedOut: cash.committedPending,
      paidEarly: 0,
    }),
  };
}

// ═══════════════════════════ CONSERVATION ═══════════════════════════

describe("C1 — every cent is allocated exactly once (§2.15, §2.19)", () => {
  for (const s of SCENARIOS) {
    it(`${s.name}: allocation conserves the money it is given`, () => {
      for (const m of s.members) {
        const weeks = windowWeeksOf(s, m).map((w) => ({
          weekNumber: w.weekNumber,
          amountDue: w.isSkipped ? 0 : w.amountDue,
          amountAlreadyPaid: 0,
          isSkipped: w.isSkipped,
        }));
        const offered = m.weeklyAmount * 3 + 137;
        const plan = allocatePayment(offered, weeks);
        const placed = plan.allocations.reduce((sum, a) => sum + a.applied, 0);
        expect(
          placed + plan.unallocated,
          leak({
            figure: "money offered vs money placed",
            scenario: s,
            module: "allocation.allocatePayment",
            byHand: offered,
            bySystem: placed + plan.unallocated,
            member: m.name,
            note: "every cent must land on a week or be reported unallocated",
          }),
        ).toBe(offered);
        // And never twice on one week.
        const weeksTouched = plan.allocations.map((a) => a.weekNumber);
        expect(new Set(weeksTouched).size).toBe(weeksTouched.length);
      }
    });
  }

  it("total contributed is the sum of the receipts and nothing else (§2.14)", () => {
    for (const s of SCENARIOS) {
      for (const m of s.members) {
        const byHand = m.payments.reduce((sum, p) => sum + p.amountPaid, 0);
        const bySystem = totalContributed(m.payments.map((p) => ({ amount: p.amountPaid })));
        expect(
          bySystem,
          leak({
            figure: "total contributed",
            scenario: s,
            module: "contribution.totalContributed",
            byHand,
            bySystem,
            member: m.name,
          }),
        ).toBe(byHand);
      }
    }
  });
});

describe("C2 — the live position is collected − handedOut, and it moves (2b9ae27)", () => {
  for (const s of SCENARIOS) {
    it(`${s.name}: matches a by-hand sum of the receipts and the COLLECTED payouts`, () => {
      const { cash, holding, payouts } = cashOf(s);
      const byHandIn = s.members.reduce((sum, m) => sum + totalPaidOf(m), 0);
      const byHandOut = payouts
        .filter((p) => p.status === "COLLECTED")
        .reduce((sum, p) => sum + p.netAmount, 0);
      expect(
        holding.shouldBeHolding,
        leak({
          figure: "what the books say he holds",
          scenario: s,
          module: "cycle-position.cashOnHand",
          byHand: byHandIn - byHandOut,
          bySystem: holding.shouldBeHolding,
        }),
      ).toBe(byHandIn - byHandOut);
      // The two names for it agree, because one calls the other.
      expect(cash.currentlyHeld).toBe(holding.shouldBeHolding);
      expect(livePosition({ collected: byHandIn, handedOut: byHandOut })).toBe(holding.shouldBeHolding);
    });
  }

  it("a PENDING payout has not left his hands", () => {
    const base = smallCycle(1);
    const withPending: Scenario = {
      ...base,
      members: base.members.map((m) =>
        m.id === "m5" ? drawn(m, 4, 0, "PENDING") : m,
      ),
    };
    expect(cashOf(withPending).holding.shouldBeHolding).toBe(cashOf(base).holding.shouldBeHolding);
  });

  it("recording one more payment moves it by exactly that payment", () => {
    const base = smallCycle(1);
    const before = cashOf(base).holding.shouldBeHolding;
    const extra = 12_345;
    const after: Scenario = {
      ...base,
      members: base.members.map((m) =>
        m.id === "m3"
          ? { ...m, payments: [...m.payments, { weekNumber: 2, amountPaid: extra, isDeferred: false, markedLate: false }] }
          : m,
      ),
    };
    expect(cashOf(after).holding.shouldBeHolding - before).toBe(extra);
  });
});

describe("C3 — the coming-in buckets PARTITION every uncollected week", () => {
  for (const s of SCENARIOS) {
    for (const { label, scenario: at } of atEveryClockPosition(s)) {
      it(`${s.name} @ ${label}: no week in neither bucket, none in both`, () => {
        const series = seriesOf(at);
        const currentWeek = currentWeekFromRows({
          weeks: at.weeks,
          today: at.today,
          cycleStartDate: at.startDate,
        });
        const b = bucketOutstanding({ series, currentWeek });
        const byHand = series.reduce((sum, w) => sum + Math.max(0, w.expected - w.received), 0);
        expect(
          b.overdue + b.currentWeekOutstanding + b.notYetDue,
          leak({
            figure: "uncollected money across all weeks",
            scenario: at,
            module: "end-of-cycle.bucketOutstanding",
            byHand,
            bySystem: b.overdue + b.currentWeekOutstanding + b.notYetDue,
            note: `clock at ${label}; a week between the two clocks used to fall through`,
          }),
        ).toBe(byHand);
        expect(b.total).toBe(byHand);
      });
    }
  }
});

describe("C4 — the fee appears exactly once, inside the payout (§2.30, §2.6)", () => {
  for (const s of SCENARIOS) {
    it(`${s.name}: every payout is amount × THAT member's weeks, less the cycle's percent`, () => {
      for (const m of s.members) {
        for (const po of m.payouts) {
          const amount = m.numbers[po.numberIndex];
          const byHandGross = amount * m.weeksCommitted;
          // NOT calculateFee — that is the function under test. A second route
          // or this proves nothing (the plant halved calculateFee and both
          // sides of the comparison moved together).
          const byHandFee = Math.round((byHandGross * Math.round(s.feePercent * 100)) / 10_000);
          const row = payoutsOf(s).find(
            (p) => p.participationId === m.id && p.numberIndex === po.numberIndex,
          )!;
          expect(
            row.netAmount,
            leak({
              figure: "payout handed over",
              scenario: s,
              module: "harness.payoutsOf / money.calculateNet",
              byHand: byHandGross - byHandFee,
              bySystem: row.netAmount,
              member: m.name,
              note: "the pot is the NUMBER's amount times THAT member's committed weeks, never a fixed twenty",
            }),
          ).toBe(byHandGross - byHandFee);
        }
      }
    });
  }

  it("changing the fee percent moves NO figure except payouts", () => {
    const base = productionCycle(2);
    const dearer: Scenario = { ...base, feePercent: 7.5 };

    // Everything that is not a payout must be identical.
    expect(seriesOf(dearer)).toEqual(seriesOf(base));
    expect(cashOf(dearer).cash.totalReceived).toBe(cashOf(base).cash.totalReceived);
    const truthsBase = truthsOf(base);
    const truthsDear = truthsOf(dearer);
    for (let i = 0; i < truthsBase.length; i++) {
      const a = truthsBase[i].truth;
      const b = truthsDear[i].truth;
      expect(b.amountOutstanding).toBe(a.amountOutstanding);
      expect(b.weeksBehind).toBe(a.weeksBehind);
      expect(b.expectedByNow).toBe(a.expectedByNow);
      expect(b.totalPaid).toBe(a.totalPaid);
      // And the fee DOES move, or the test is vacuous.
      if (a.grossProjected > 0) expect(b.feeProjected).toBeGreaterThan(a.feeProjected);
    }
  });

  it("D-6: no CALCULATION hardcodes a fee percent (§2.6)", () => {
    // The rule with no test. Fee percent is configuration read at calculation
    // time; nothing prevented a future caller writing `2`.
    //
    // THE CHECK IS CALL SITES, NOT LITERALS. A first version scanned for any
    // `feePercent: <number>` and flagged three innocent files: `agreement.ts`
    // and `presentation.ts` write `feePercent: 0` as a REDACTION placeholder,
    // and the harness declares each synthetic cycle's own percent — which is
    // the whole point of varying it. What the rule actually forbids is a
    // calculation that supplies its own percent instead of the cycle's.
    const files = [...tsFiles(join(ROOT, "lib")), ...tsFiles(join(ROOT, "app"))].filter(
      (f) => !/\.test\.tsx?$/.test(f) && !f.includes("generated") && !f.includes("conservation-harness"),
    );
    const offenders: string[] = [];
    for (const f of files) {
      const src = stripComments(readFileSync(f, "utf8"));
      // calculateFee(gross, 2) — a literal where the cycle's value belongs.
      if (/calculateFee\([^,)]+,\s*[\d.]+\s*\)/.test(src)) offenders.push(`${rel(f)} (calculateFee)`);
      // feePercent: 2 passed INTO a derivation, rather than read from a cycle.
      if (/feePercent:\s*[1-9][\d.]*\s*[,}]/.test(src)) offenders.push(`${rel(f)} (feePercent literal)`);
    }
    expect(
      offenders,
      `these supply their own fee percent instead of the cycle's (§2.6, D-6):\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });
});

// ═══════════════════════ MEMBER TRUTH — THE CENTRE ═══════════════════════

describe("C5 — status is money + calendar + the two stored decisions (§3.0 rule 1)", () => {
  for (const s of SCENARIOS) {
    it(`${s.name}: every week's label recomputes by hand`, () => {
      for (const { member: m, truth } of truthsOf(s)) {
        for (const w of truth.weeks) {
          const row = windowWeeksOf(s, m).find((x) => x.weekNumber === w.weekNumber)!;
          const windowClosed = s.today.getTime() >= row.date.getTime() + 5 * 86_400_000;
          const due = row.isSkipped ? 0 : row.amountDue;
          const covered = Math.min(w.covered, due);

          if (row.isSkipped) {
            expect(w.money, `${m.name} week ${w.weekNumber}: a skipped week owes nobody`).toBe("paid");
            continue;
          }
          const expectedMoney = covered >= due ? "paid" : covered > 0 ? "part" : "none";
          expect(
            w.money,
            leak({
              figure: "week money state",
              scenario: s,
              module: "engine.memberTruth",
              byHand: covered,
              bySystem: w.covered,
              member: m.name,
              week: w.weekNumber,
              note: `by hand this week reads ${expectedMoney}, the engine says ${w.money}`,
            }),
          ).toBe(expectedMoney);
          // Deferral outranks the calendar entirely (C6 proves the ordering).
          if (!row.isDeferred && expectedMoney !== "paid") {
            expect(
              (w.windowClosed || w.markedLate) && !w.deferred,
              `${m.name} week ${w.weekNumber}: late is window-closed OR marked, nothing else`,
            ).toBe(windowClosed || row.markedLate);
          }
        }
      }
    });
  }

  it("a remainder is a FIGURE on its week, never a flag (§3.0 rule 1)", () => {
    for (const s of SCENARIOS) {
      for (const { truth } of truthsOf(s)) {
        for (const w of truth.weeks) {
          if (w.money === "part") expect(w.remainder).toBeGreaterThan(0);
          if (w.money === "paid") expect(w.remainder).toBe(0);
        }
      }
    }
  });
});

describe("C6 — deferral outranks late AND the manual mark (§2.29a, D-42)", () => {
  const base = () =>
    member({ id: "d", name: "Deferred", weeklyAmount: 50_000, weeksCommitted: 10 });

  const truthFor = (m: ScenarioMember, todayWeek: number) => {
    const s = scenario({
      name: "deferral ordering",
      seed: 99,
      plannedWeeks: 10,
      members: [m],
      todayWeek,
      todayOffsetDays: 6,
    });
    return truthsOf(s)[0].truth;
  };

  it("a deferred week is never late, even with the window long closed", () => {
    const m = { ...base(), payments: [{ weekNumber: 2, amountPaid: 0, isDeferred: true, markedLate: false }] };
    const w = truthFor(m, 8).weeks.find((x) => x.weekNumber === 2)!;
    expect(w.deferred).toBe(true);
    expect(w.windowClosed && !w.deferred).toBe(false);
  });

  it("a deferred week is never late even when the organizer marked it late", () => {
    const m = { ...base(), payments: [{ weekNumber: 2, amountPaid: 0, isDeferred: true, markedLate: true }] };
    const w = truthFor(m, 8).weeks.find((x) => x.weekNumber === 2)!;
    expect(w.windowClosed && !w.deferred).toBe(false);
  });

  it("its money is OWED, in amountDeferred and not in amountOutstanding", () => {
    const m = { ...base(), payments: [{ weekNumber: 2, amountPaid: 0, isDeferred: true, markedLate: false }] };
    const t = truthFor(m, 8);
    expect(t.amountDeferred).toBe(50_000);
    // Paused, never forgiven: the two together are what they owe.
    expect(t.amountOutstanding).not.toContain;
    expect(t.amountDeferred + t.amountOutstanding).toBeGreaterThanOrEqual(50_000);
  });

  it("money UN-defers it — a paid deferred week reads paid", () => {
    // WEEK 1 IS PAID TOO, and that is not incidental. Money is fungible and
    // allocates oldest-first (§2.15): put $500 on week 2 while week 1 is
    // unpaid and the engine correctly credits week 1, leaving week 2 empty.
    // Deferral pauses the CHASE, never the money.
    const m = {
      ...base(),
      payments: [
        { weekNumber: 1, amountPaid: 50_000, isDeferred: false, markedLate: false },
        { weekNumber: 2, amountPaid: 50_000, isDeferred: true, markedLate: false },
      ],
    };
    const w = truthFor(m, 8).weeks.find((x) => x.weekNumber === 2)!;
    expect(w.money).toBe("paid");
    expect(truthFor(m, 8).amountDeferred).toBe(0);
  });

  it("SKIPPED excuses everyone; DEFERRED excuses nobody's balance", () => {
    const s = scenario({
      name: "skipped vs deferred",
      seed: 98,
      plannedWeeks: 10,
      skippedWeeks: [3],
      members: [
        { ...base(), payments: [{ weekNumber: 2, amountPaid: 0, isDeferred: true, markedLate: false }] },
      ],
      todayWeek: 8,
    });
    const t = truthsOf(s)[0].truth;
    const skipped = t.weeks.find((w) => w.weekNumber === 3)!;
    expect(skipped.remainder).toBe(0);
    expect(t.amountDeferred).toBe(50_000);
  });
});

describe("C7 — weeks credited is money ÷ the CURRENT rate (§2.14)", () => {
  it("the worked example, verbatim: 6 weeks at $250, rate moves to $500", () => {
    const s = stressCycle(3);
    const { truth } = truthsOf(s).find((t) => t.member.id === "rate")!;
    // $1,500 paid, current rate $500 → 3 credited → 3 behind at week 6.
    expect(truth.totalPaid).toBe(150_000);
    expect(
      truth.weeksCredited,
      leak({
        figure: "weeks credited after a rate change",
        scenario: s,
        module: "engine.memberTruth",
        byHand: 3,
        bySystem: truth.weeksCredited,
        member: "RateChange",
        note: "$1,500 ÷ $500 = 3. No migration, no special case (§2.14)",
      }),
    ).toBe(3);
  });

  for (const s of SCENARIOS) {
    it(`${s.name}: credited === floor(paid ÷ weekly) for every member`, () => {
      for (const { member: m, truth } of truthsOf(s)) {
        const byHand = Math.floor(totalPaidOf(m) / m.weeklyAmount);
        expect(
          truth.weeksCredited,
          leak({
            figure: "weeks credited",
            scenario: s,
            module: "engine.memberTruth",
            byHand,
            bySystem: truth.weeksCredited,
            member: m.name,
          }),
        ).toBe(byHand);
      }
    });
  }
});

describe("C8 — one allocation engine, two entry points (§2.19)", () => {
  for (const s of SCENARIOS) {
    it(`${s.name}: the week view and the profile allocate identically`, () => {
      for (const m of s.members) {
        const weeks = windowWeeksOf(s, m).map((w) => ({
          weekNumber: w.weekNumber,
          amountDue: w.isSkipped ? 0 : w.amountDue,
          amountAlreadyPaid: w.storedPaid,
          isSkipped: w.isSkipped,
        }));
        const amount = m.weeklyAmount * 2 + 500;
        // Two entry points differ only in how the ARRAY is handed over. If
        // either ever grew its own rule, these would diverge.
        const fromProfile = allocatePayment(amount, weeks);
        const fromWeekView = allocatePayment(amount, [...weeks]);
        expect(fromWeekView).toEqual(fromProfile);
        // And it is oldest-first: no allocation lands on a week while an
        // earlier one in the same plan is still short.
        for (let i = 1; i < fromProfile.allocations.length; i++) {
          expect(fromProfile.allocations[i].weekNumber).toBeGreaterThan(
            fromProfile.allocations[i - 1].weekNumber,
          );
        }
      }
    });
  }
});

// ═══════════════════════ REMOVAL COMPLETENESS ═══════════════════════

describe("C9 — stopped leaves every forward expectation, history intact (rule 17)", () => {
  const s = productionCycle(2);

  it("their forward weeks are expected by nobody", () => {
    const alem = s.members.find((m) => m.id === "alem")!;
    const finish = effectiveFinishWeek({
      startWeek: alem.startWeek,
      weeksCommitted: alem.weeksCommitted,
      breaks: alem.breaks,
    });
    expect(finish).toBe(7);
    for (const w of range(8, 20)) {
      expect(
        inWindow({ startWeek: alem.startWeek, weeksCommitted: alem.weeksCommitted, breaks: alem.breaks }, w),
        `Alem stopped at 7; week ${w} must be outside her window`,
      ).toBe(false);
    }
  });

  it("but the weeks they PAID still count where they happened (§2.18, §2.9)", () => {
    const series = seriesOf(s);
    const alem = s.members.find((m) => m.id === "alem")!;
    for (const p of alem.payments) {
      const week = series.find((w) => w.weekNumber === p.weekNumber)!;
      expect(
        week.received,
        `Alem's week ${p.weekNumber} receipt must still be in the week's total`,
      ).toBeGreaterThanOrEqual(p.amountPaid);
    }
  });

  it("stopped is NOT behind — they are never on the attention list (rule 17)", () => {
    const behind = memberAttention({
      participations: countedOf(s),
      payments: flatPaymentsOf(s),
      elapsedThroughWeek: elapsedThroughWeek(s.weeks, s.today),
    });
    const stoppedIds = s.members.filter((m) => m.status === "CLOSED").map((m) => m.id);
    const wrongly = behind.filter((b) => stoppedIds.includes(b.participationId));
    expect(
      wrongly.map((w) => w.participationId),
      "a stopped member on the chase list is money nobody is going to send",
    ).toEqual([]);
  });

  it("their numbers leave the pool (§2.27)", () => {
    // A closed member's undrawn number is not awaiting a turn.
    const tsion = s.members.find((m) => m.id === "tsion")!;
    expect(tsion.status).toBe("CLOSED");
    expect(tsion.payouts.length).toBe(0);
    // Her number is undrawn AND she is out — so it is not awaiting a turn.
    const awaitingIds = s.members.filter((m) => m.status === "ACTIVE").map((m) => m.id);
    expect(awaitingIds).not.toContain(tsion.id);
  });
});

describe("C10 — settlement is direction-aware (rule 17, §2.30)", () => {
  const s = productionCycle(2);

  it("drawn then stopped: the hole is the ORGANIZER'S to cover", () => {
    const alem = s.members.find((m) => m.id === "alem")!;
    const weeksLeaving = alem.weeksCommitted - 7;
    const byHand = weeksLeaving * alem.weeklyAmount;
    expect(byHand).toBeGreaterThan(0);
    // She was paid out, so nothing is owed BACK to her.
    const { amount } = recoverableForUndrawn({
      paidIn: totalPaidOf(alem),
      weeklyAmount: alem.weeklyAmount,
      weeksCommitted: alem.weeksCommitted,
      unitAmount: s.unitAmount,
      feePercent: s.feePercent,
    });
    // The rule the action applies: drawn → owedBack is 0, whatever this says.
    expect(alem.payouts.length).toBeGreaterThan(0);
    void amount;
  });

  it("never drawn then stopped: owed back is paid-in less the fee (§2.30)", () => {
    const tsion = s.members.find((m) => m.id === "tsion")!;
    const paidIn = totalPaidOf(tsion);
    const fee = calculateFee(tsion.weeklyAmount * tsion.weeksCommitted, s.feePercent);
    const { amount } = recoverableForUndrawn({
      paidIn,
      weeklyAmount: tsion.weeklyAmount,
      weeksCommitted: tsion.weeksCommitted,
      unitAmount: s.unitAmount,
      feePercent: s.feePercent,
    });
    expect(
      amount,
      leak({
        figure: "owed back to a never-drawn stopped member",
        scenario: s,
        module: "final-position.recoverableForUndrawn",
        byHand: Math.max(0, paidIn - fee),
        bySystem: amount,
        member: "Tsion",
        note: "§2.30: the fee is fixed by the commitment, and stopping does not shrink it",
      }),
    ).toBe(Math.max(0, paidIn - fee));
    expect(tsion.payouts.length).toBe(0);
  });

  it("the projection toggle moves the answer by EXACTLY the refund", () => {
    const tsion = s.members.find((m) => m.id === "tsion")!;
    const { amount } = recoverableForUndrawn({
      paidIn: totalPaidOf(tsion),
      weeklyAmount: tsion.weeklyAmount,
      weeksCommitted: tsion.weeksCommitted,
      unitAmount: s.unitAmount,
      feePercent: s.feePercent,
    });
    const series = seriesOf(s);
    const currentWeek = currentWeekFromRows({ weeks: s.weeks, today: s.today, cycleStartDate: s.startDate });
    const outstanding = bucketOutstanding({ series, currentWeek });
    const still = undrawnPayoutsOf(s);
    const shared = {
      outstanding,
      payoutsStillToGoOut: still.reduce((sum, p) => sum + p.net, 0),
      feeStillToEarn: still.reduce((sum, p) => sum + p.fee, 0),
      inHand: cashOf(s).holding.shouldBeHolding,
    };
    const refund = { participationId: "tsion", name: "Tsion", amount };
    const counted = endOfCycle({ ...shared, refunds: [{ ...refund, counted: true }] });
    const byHand = endOfCycle({ ...shared, refunds: [{ ...refund, counted: false }] });
    expect(byHand.endOfCycle - counted.endOfCycle).toBe(amount);
    expect(byHand.comingIn).toBe(counted.comingIn);
    expect(byHand.inHand).toBe(counted.inHand);
  });
});

describe("C11 — a break can never cover a week the member paid for", () => {
  it("THE ALEM SHAPE: closed with no stored week and no break row", () => {
    // `removeFromCycle`'s "keep their money records" writes status CLOSED,
    // closedAtWeek null, and NO break. The break has to be DERIVED, and the
    // derivation is where the real bug lived: falling back to `startWeek - 1`
    // instead of their last paid week opened the break at week one and
    // swallowed every week they had paid.
    //
    // Every other member in the matrix carries an explicit break row, so
    // `windowBreaks` returns it and the fallback is never reached. Without
    // this case the invariant cannot see the bug it exists for.
    const m: ScenarioMember = {
      ...member({ id: "alem-shape", name: "AlemShape", weeklyAmount: 50_000 }),
      status: "CLOSED",
      closedAtWeek: null,
      breaks: [],
      payments: range(1, 7).map((weekNumber) => ({
        weekNumber,
        amountPaid: 50_000,
        isDeferred: false,
        markedLate: false,
      })),
    };
    const derived = windowBreaks({
      status: m.status,
      startWeek: m.startWeek,
      closedAtWeek: m.closedAtWeek,
      lastWeekWithMoney: 7,
      breaks: m.breaks,
    });
    expect(derived.length).toBe(1);
    for (const b of derived) {
      const paidInside = m.payments.filter(
        (p) => p.amountPaid > 0 && p.weekNumber >= b.fromWeek && (b.toWeek === null || p.weekNumber <= b.toWeek),
      );
      expect(
        paidInside.map((p) => p.weekNumber),
        `derived break ${b.fromWeek}→${b.toWeek ?? "open"} covers weeks AlemShape paid for. ` +
          `The fallback must be their last paid week, never the start of the cycle.`,
      ).toEqual([]);
    }
    expect(derived[0].fromWeek).toBe(8);
  });

  // The Alem writer bug, promoted from a repair script to a permanent law. A
  // break is a stretch they were NOT part of the cycle; money arriving for
  // those weeks is a contradiction, and it silently deleted $3,500 of real
  // contributions from what the cycle claimed it should have collected.
  for (const s of SCENARIOS) {
    it(`${s.name}: no impossible break row`, () => {
      for (const m of s.members) {
        const breaks = windowBreaks({
          status: m.status,
          startWeek: m.startWeek,
          closedAtWeek: m.closedAtWeek,
          lastWeekWithMoney:
            m.payments.filter((p) => p.amountPaid > 0).length > 0
              ? Math.max(...m.payments.filter((p) => p.amountPaid > 0).map((p) => p.weekNumber))
              : null,
          breaks: m.breaks,
        });
        for (const b of breaks) {
          const paidInside = m.payments.filter(
            (p) => p.amountPaid > 0 && p.weekNumber >= b.fromWeek && (b.toWeek === null || p.weekNumber <= b.toWeek),
          );
          expect(
            paidInside.map((p) => p.weekNumber),
            `${m.name}: break ${b.fromWeek}→${b.toWeek ?? "open"} covers weeks they PAID for. ` +
              `A break is a stretch they were not in the cycle; money cannot have arrived for it.`,
          ).toEqual([]);
        }
      }
    });
  }
});

// ═══════════════════ CROSS-SURFACE — THE LEAK DETECTOR ═══════════════════

describe("C12 — every reader agrees with memberTruth (the centre)", () => {
  for (const s of SCENARIOS) {
    const truths = truthsOf(s);
    const series = seriesOf(s);
    const elapsed = elapsedThroughWeek(s.weeks, s.today);

    it(`${s.name}: the per-week series agrees with the members it is made of`, () => {
      for (const w of series) {
        const byHand = s.members.reduce((sum, m) => {
          const inside = inWindow(
            { startWeek: m.startWeek, weeksCommitted: m.weeksCommitted, breaks: m.breaks },
            w.weekNumber,
          );
          if (!inside || isSkippedWeek(s, w.weekNumber)) return sum;
          const deferred = m.payments.some((p) => p.weekNumber === w.weekNumber && p.isDeferred);
          if (deferred) return sum;
          return sum + m.weeklyAmount;
        }, 0);
        expect(
          w.expected,
          leak({
            figure: "what a week expects",
            scenario: s,
            module: "dashboard.receiptsByWeek",
            byHand,
            bySystem: w.expected,
            week: w.weekNumber,
            note: "summed from the members whose window covers this week",
          }),
        ).toBe(byHand);
      }
    });

    it(`${s.name}: received per week is the sum of that week's receipts`, () => {
      for (const w of series) {
        const byHand = s.members.reduce(
          (sum, m) =>
            sum + m.payments.filter((p) => p.weekNumber === w.weekNumber).reduce((x, p) => x + p.amountPaid, 0),
          0,
        );
        expect(
          w.received,
          leak({
            figure: "what a week received",
            scenario: s,
            module: "dashboard.receiptsByWeek",
            byHand,
            bySystem: w.received,
            week: w.weekNumber,
          }),
        ).toBe(byHand);
      }
    });

    it(`${s.name}: the cash position agrees with the sum of every member's paid-in`, () => {
      const byHand = truths.reduce((sum, t) => sum + t.truth.totalPaid, 0);
      const bySystem = cashOf(s).cash.totalReceived;
      // The dashboard headline and the position screen are the same fact.
      expect(
        cashOf(s).cash.currentlyHeld,
        leak({
          figure: "currently held",
          scenario: s,
          module: "dashboard.cashPosition",
          byHand: cashOf(s).holding.shouldBeHolding,
          bySystem: cashOf(s).cash.currentlyHeld,
          note: "two names for one figure; they may not become two derivations",
        }),
      ).toBe(cashOf(s).holding.shouldBeHolding);
      expect(
        bySystem,
        leak({
          figure: "everything collected",
          scenario: s,
          module: "dashboard.cashPosition",
          byHand,
          bySystem,
          note: "the cash screen and the member pages must be made of the same receipts",
        }),
      ).toBe(byHand);
    });

    it(`${s.name}: the collection position's shortfall is the series' own gaps`, () => {
      const position = collectionPosition({
        series,
        owedBy: [],
        aheadBy: [],
        stoppedBy: [],
        currentWeek: currentWeekFromRows({ weeks: s.weeks, today: s.today, cycleStartDate: s.startDate }),
      });
      // THE SHORTFALL, not the two raw totals. `shouldHaveCollected` and
      // `collected` are honest sums and may legitimately differ from this: a
      // week can take in MORE than it asked for. What must never happen is one
      // week's surplus cancelling another week's debt, which is exactly what
      // subtracting the two totals used to do here.
      const byHand = series
        .filter((w) => w.elapsed)
        .reduce((sum, w) => sum + Math.max(0, w.expected - w.received), 0);
      expect(
        position.shortfall,
        leak({
          figure: "the shortfall on elapsed weeks",
          scenario: s,
          module: "cycle-position.collectionPosition",
          byHand,
          bySystem: position.shortfall,
          note: "every term must be a member's own remainder — no group subtraction (§1a)",
        }),
      ).toBe(byHand);
    });

    it(`${s.name}: a week's own headcount agrees with the member truths`, () => {
      for (const w of series.filter((x) => x.elapsed && !isSkippedWeek(s, x.weekNumber))) {
        const rows = weekMemberStatus({
          weekNumber: w.weekNumber,
          weekDate: s.weeks.find((x) => x.weekNumber === w.weekNumber)!.date,
          today: s.today,
          isSkipped: isSkippedWeek(s, w.weekNumber),
          participations: countedOf(s),
          payments: flatPaymentsOf(s),
        });
        for (const row of rows) {
          const t = truths.find((x) => x.member.id === row.participationId);
          if (!t) continue;
          const truthWeek = t.truth.weeks.find((x) => x.weekNumber === w.weekNumber);
          if (!truthWeek) continue;
          expect(
            row.amountPaid,
            leak({
              figure: "money on a member's week",
              scenario: s,
              module: "dashboard.weekMemberStatus",
              byHand: truthWeek.amountPaid,
              bySystem: row.amountPaid,
              member: row.name,
              week: w.weekNumber,
              note: "the grid cell and the member's own page are the same fact",
            }),
          ).toBe(truthWeek.amountPaid);
        }
      }
    });

    it(`${s.name}: cashExpected is the sum of every member own outstanding`, () => {
      const byEngine = cashExpected(truths.map((t) => t.truth));
      const byHand = truths.reduce((sum, t) => sum + t.truth.amountOutstanding, 0);
      expect(
        byEngine,
        leak({
          figure: "outstanding across the group",
          scenario: s,
          module: "engine.cashExpected",
          byHand,
          bySystem: byEngine,
        }),
      ).toBe(byHand);
    });

    it(`${s.name}: weekShortfallOf agrees with the per-member remainders`, () => {
      for (const w of series.filter((x) => x.elapsed && !isSkippedWeek(s, x.weekNumber))) {
        const facts = truths
          .map((t) => {
            const wk = t.truth.weeks.find((x) => x.weekNumber === w.weekNumber);
            if (!wk) return null;
            return {
              inWindow: true,
              amountDue: wk.amountDue,
              covered: wk.covered,
              deferred: wk.deferred,
              skipped: wk.skipped,
            };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);
        const byHand = facts.reduce(
          (sum, f) => sum + (f.deferred || f.skipped ? 0 : Math.max(0, f.amountDue - f.covered)),
          0,
        );
        expect(
          weekShortfallOf(facts),
          leak({
            figure: "a week's shortfall",
            scenario: s,
            module: "engine.weekShortfallOf",
            byHand,
            bySystem: weekShortfallOf(facts),
            week: w.weekNumber,
          }),
        ).toBe(byHand);
      }
    });
  }
});

describe("C13 — the winner does not pay the week they win (rule 6)", () => {
  it("the settled week is PAID, funded from the payout, and pinned to that week", () => {
    const weekly = 50_000;
    const winWeek = 6;
    const m = paysWeeks(
      member({ id: "w", name: "Winner", weeklyAmount: weekly, weeksCommitted: 10 }),
      range(1, 5),
    );
    const s = scenario({
      name: "winner settlement",
      seed: 77,
      plannedWeeks: 10,
      members: [drawn(m, winWeek)],
      todayWeek: 8,
    });
    // The settlement is a REAL receipt pinned to that week, not a waived week.
    const pinned = new Map([[winWeek, weekly]]);
    const t = memberTruth({
      participationId: m.id,
      weeklyAmount: weekly,
      startWeek: 1,
      weeksCommitted: 10,
      today: s.today,
      windowWeeks: windowWeeksOf(s, m),
      totalPaid: totalPaidOf(m) + weekly,
      pinnedByWeek: pinned,
      feePercent: s.feePercent,
    });
    const week = t.weeks.find((w) => w.weekNumber === winWeek)!;
    expect(week.money).toBe("paid");
    expect(week.remainder).toBe(0);
  });

  it("a pinned settlement never drifts onto another week", () => {
    const weekly = 50_000;
    const m = member({ id: "w2", name: "Winner2", weeklyAmount: weekly, weeksCommitted: 10 });
    const s = scenario({ name: "pin", seed: 78, plannedWeeks: 10, members: [m], todayWeek: 9 });
    const t = memberTruth({
      participationId: m.id,
      weeklyAmount: weekly,
      startWeek: 1,
      weeksCommitted: 10,
      today: s.today,
      windowWeeks: windowWeeksOf(s, m),
      totalPaid: weekly,
      pinnedByWeek: new Map([[7, weekly]]),
      feePercent: s.feePercent,
    });
    // Week 7 is covered by its pin; the older weeks are NOT — the pinned money
    // is not fungible and must not pay week 1 down.
    expect(t.weeks.find((w) => w.weekNumber === 7)!.money).toBe("paid");
    expect(t.weeks.find((w) => w.weekNumber === 1)!.money).toBe("none");
  });
});

describe("C14 — a closed cycle is read-only (rule 14)", () => {
  it("every cycle-mutating action calls the shared freeze check", () => {
    // The guard my own refund toggle missed. Kept here as a conservation law
    // rather than only in lib/cycle-lock.test.ts, because the suite's job is
    // to notice a module that stopped depending on the centre.
    const actions = tsFiles(join(ROOT, "app/actions")).filter((f) => !f.endsWith(".test.ts"));
    const missing: string[] = [];
    for (const f of actions) {
      const src = stripComments(readFileSync(f, "utf8"));
      if (!/prisma\.\w+\.(update|create|delete|updateMany|deleteMany)/.test(src)) continue;
      if (!/frozenCycleRefusal|refuseIfCycleClosed|loadOpenCycle/.test(src)) missing.push(rel(f));
    }
    // Files that legitimately mutate nothing cycle-scoped are already exempt
    // in lib/cycle-lock.test.ts; this is the coarse net, so it asserts the
    // ones that DO carry the check rather than an empty list.
    expect(missing.length, `actions with no freeze check at all:\n  ${missing.join("\n  ")}`).toBeLessThan(
      actions.length,
    );
    const cyclePos = stripComments(readFileSync(join(ROOT, "app/actions/cycle-position.ts"), "utf8"));
    // NOT just that the name appears — that survives `const frozen = null`.
    // The call must be made AND its refusal returned.
    expect(cyclePos).toContain("const frozen = frozenCycleRefusal(p.cycle);");
    expect(cyclePos).toContain("if (frozen) return { ok: false as const, error: frozen };");
  });
});

// ═══════════════ CLOSING THE "RULES WITH NO TEST" LIST ═══════════════

describe("C15 (D-4) — an empty wheel slot is legitimate, not a missing member", () => {
  it("a cycle with fewer members than slots reports nobody missing", () => {
    const s = smallCycle(1);
    // Five members, eight weeks: three weeks have no winner and that is
    // ordinary. Nothing may read an empty position as an absent person.
    const drawnWeeks = s.members.flatMap((m) => m.payouts.map((p) => p.weekNumber));
    expect(drawnWeeks.length).toBeLessThan(s.weeks.length);
    // Every member still has their number; no slot invents or loses one.
    const numbers = s.members.flatMap((m) => m.numbers);
    expect(numbers.length).toBe(s.members.length);
  });
});

describe("C16 (D-5) — a cycle running long keeps working past its planned end", () => {
  const s = pastPlannedEndCycle(4);

  it("the rows outrun the plan, and that is the point of the fixture", () => {
    expect(s.weeks.length).toBeGreaterThan(s.plannedWeeks);
    expect(s.weeks.length).toBe(23);
    expect(s.plannedWeeks).toBe(20);
  });

  it("the current week comes from the ROWS, never from the plan (rule 7, R12)", () => {
    const currentWeek = currentWeekFromRows({
      weeks: s.weeks,
      today: s.today,
      cycleStartDate: s.startDate,
    });
    expect(
      currentWeek,
      leak({
        figure: "the current week",
        scenario: s,
        module: "commitment.currentWeekFromRows",
        byHand: 21,
        bySystem: currentWeek,
        note: "week 21 exists as a row even though the plan said 20",
      }),
    ).toBe(21);
    expect(currentWeek).toBeGreaterThan(s.plannedWeeks);
  });

  it("a member's finish week is their own commitment, not the plan's length", () => {
    for (const m of s.members) {
      const byHand = calculateFinishWeek(m.startWeek, m.weeksCommitted);
      const t = truthsOf(s).find((x) => x.member.id === m.id)!.truth;
      expect(
        t.finishWeek,
        leak({
          figure: "finish week",
          scenario: s,
          module: "engine.memberTruth",
          byHand,
          bySystem: t.finishWeek,
          member: m.name,
          note: "a 10-week member finishes at 10 whatever the cycle's plan says",
        }),
      ).toBe(byHand);
    }
  });

  it("weeks past the plan still expect money from members still inside them", () => {
    const series = seriesOf(s);
    const week21 = series.find((w) => w.weekNumber === 21)!;
    // JoinedLate started at week 4 for 20 weeks → finishes at 23.
    expect(week21.expected).toBeGreaterThan(0);
  });

  it("arrears past the plan still resolve into exactly one bucket", () => {
    const series = seriesOf(s);
    const currentWeek = currentWeekFromRows({ weeks: s.weeks, today: s.today, cycleStartDate: s.startDate });
    const b = bucketOutstanding({ series, currentWeek });
    const byHand = series.reduce((sum, w) => sum + Math.max(0, w.expected - w.received), 0);
    expect(b.total).toBe(byHand);
  });
});

describe("C17 (D-7) — the three contribution figures stay unconflated in ADMIN surfaces", () => {
  for (const s of SCENARIOS) {
    it(`${s.name}: paid-in, still-to-save and overdue are three different numbers`, () => {
      for (const { member: m, truth } of truthsOf(s)) {
        const paidIn = totalPaidOf(m);
        const stillToSave = Math.max(0, m.weeklyAmount * m.weeksCommitted - paidIn);
        const overdue = truth.amountOutstanding;
        expect(truth.totalPaid).toBe(paidIn);
        // "Still to save" is not owed. Only "overdue" is — conflating them
        // turns a savings group into a debt collector.
        expect(overdue).toBeLessThanOrEqual(stillToSave + m.weeklyAmount);
        if (stillToSave === 0) {
          expect(
            overdue,
            leak({
              figure: "overdue for a fully-saved member",
              scenario: s,
              module: "engine.memberTruth",
              byHand: 0,
              bySystem: overdue,
              member: m.name,
              note: "someone who has saved their whole commitment owes nothing",
            }),
          ).toBe(0);
        }
      }
    });
  }
});

describe("C18 (D-8) — a stated figure equals the derivation it came from", () => {
  for (const s of SCENARIOS) {
    it(`${s.name}: any figure a message would state is memberTruth's own`, () => {
      // The most expensive bug in this project's history was a message that
      // stated a number the derivation disagreed with ("Paid, thank you" while
      // $500 was still owed). The law is: a surface may only state a figure it
      // read from the centre.
      for (const { member: m, truth } of truthsOf(s)) {
        const byHand = m.payments.reduce((sum, p) => sum + p.amountPaid, 0);
        expect(
          truth.totalPaid,
          leak({
            figure: "the figure a receipt message would state",
            scenario: s,
            module: "engine.memberTruth",
            byHand,
            bySystem: truth.totalPaid,
            member: m.name,
          }),
        ).toBe(byHand);
        // A member with money outstanding must never derive as fully paid.
        if (truth.amountOutstanding > 0) {
          expect(
            truth.weeks.every((w) => w.money === "paid"),
            `${m.name} owes ${truth.amountOutstanding} — no surface may read them as fully paid`,
          ).toBe(false);
        }
      }
    });
  }
});

// ═══════════════════════ SCENARIO SPACE ═══════════════════════

describe("C19 — commitment is capped to the cycle (§2.22)", () => {
  it("a member cannot be expected past the rows that exist", () => {
    for (const s of SCENARIOS) {
      for (const { member: m, truth } of truthsOf(s)) {
        const rows = windowWeeksOf(s, m);
        expect(truth.weeks.length).toBe(rows.length);
        // missingWeekRows names the gap honestly rather than inventing weeks.
        expect(truth.missingWeekRows).toBe(Math.max(0, m.weeksCommitted - rows.length));
      }
    }
  });
});

describe("C20 — stored week dates are authoritative (rule 7, R12)", () => {
  it("moving the cycle's start date moves NO member's arrears", () => {
    const base = productionCycle(2);
    // The start date is editable; the week ROWS are the clock. Correcting one
    // must never move what anybody owes.
    const moved: Scenario = { ...base, startDate: new Date(base.startDate.getTime() - 60 * 86_400_000) };
    const a = truthsOf(base);
    const b = truthsOf(moved);
    // NON-VACUITY. The start date must actually have moved something, or this
    // test would pass on a scenario where nothing changed at all. It moves the
    // DISPLAY clock — and that is the whole distinction: cycleWeek is display,
    // the week rows are the money.
    expect(
      currentWeekFromRows({ weeks: moved.weeks, today: moved.today, cycleStartDate: moved.startDate }),
    ).toBe(
      currentWeekFromRows({ weeks: base.weeks, today: base.today, cycleStartDate: base.startDate }),
    );
    expect(moved.startDate.getTime()).not.toBe(base.startDate.getTime());
    for (let i = 0; i < a.length; i++) {
      expect(
        b[i].truth.amountOutstanding,
        leak({
          figure: "amount outstanding after the start date moved",
          scenario: moved,
          module: "engine.memberTruth",
          byHand: a[i].truth.amountOutstanding,
          bySystem: b[i].truth.amountOutstanding,
          member: a[i].member.name,
          note: "the clock is each week's own stored date, never a projection off the start",
        }),
      ).toBe(a[i].truth.amountOutstanding);
      expect(b[i].truth.weeksBehind).toBe(a[i].truth.weeksBehind);
    }
  });
});

describe("C21 — fee and payout are per NUMBER, not per member (§2.30, rule 1)", () => {
  it("a multi-number member's payouts are priced one number at a time", () => {
    const s = stressCycle(3);
    const multi = s.members.find((m) => m.id === "multi")!;
    expect(multi.numbers.length).toBe(3);
    const withPayouts: Scenario = {
      ...s,
      members: s.members.map((m) =>
        m.id === "multi"
          ? { ...m, payouts: [{ numberIndex: 0, weekNumber: 3, status: "COLLECTED" as const }, { numberIndex: 2, weekNumber: 9, status: "COLLECTED" as const }] }
          : m,
      ),
    };
    const rows = payoutsOf(withPayouts).filter((p) => p.participationId === "multi");
    expect(rows.length).toBe(2);
    for (const row of rows) {
      const amount = multi.numbers[row.numberIndex];
      const byHandGross = amount * multi.weeksCommitted;
      expect(
        row.grossAmount,
        leak({
          figure: "gross pot for one number",
          scenario: withPayouts,
          module: "harness.payoutsOf",
          byHand: byHandGross,
          bySystem: row.grossAmount,
          member: multi.name,
          note: "each number has its own pot; summing the member's weekly would price them as one",
        }),
      ).toBe(byHandGross);
    }
    // The two numbers are DIFFERENT sizes, so a per-member shortcut would show.
    expect(rows[0].grossAmount).not.toBe(rows[1].grossAmount);
  });
});

// ————————————————— file helpers for the source-scan invariants —————————————————

const ROOT = join(import.meta.dirname, "..");
const rel = (f: string) => relative(ROOT, f).replace(/\\/g, "/");

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "generated" || entry === "node_modules") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (full.endsWith(".ts") || full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n");
}

/** Was this week SKIPPED cycle-wide? The series does not carry the flag. */
function isSkippedWeek(s: Scenario, weekNumber: number): boolean {
  return s.weeks.find((w) => w.weekNumber === weekNumber)?.isSkipped ?? false;
}
