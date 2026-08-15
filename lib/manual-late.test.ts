import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFERRED_BEATS_MARK,
  manualLateAdvice,
  paymentStatus,
  weekCountsAsDue,
  weekHasElapsed,
} from "./derived";
import { computeStanding, type StandingWeekInput } from "./standing";
import { memberAttention, weekMemberStatus, type DashboardPayment } from "./dashboard";
import { applicableTypes } from "./messages";

// THE ORGANIZER'S OWN LATE MARK (2.2, 2.14).
//
// LATE was purely derived: unpaid AND the payment window closed. That is right
// as a default and wrong as the only rule — a member who says on Monday that
// they cannot pay this week is late on Monday, and the organizer had to wait
// until Thursday for the platform to agree with him.
//
// The mark is STORED (payments.markedLateAt) because it is a DECISION, not a
// derivation. Everything else about it stays derived, and that is what these
// pin: the status, the arithmetic that has to agree with the status, and the
// message that becomes sendable the moment it is made.

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const MONDAY = new Date("2026-08-10T12:00:00Z");
const WEEK_START = new Date("2026-08-09T00:00:00Z"); // the Sunday just gone
const NEXT_MONTH = new Date("2026-09-13T00:00:00Z");
const LONG_PAST = new Date("2026-07-05T00:00:00Z");

describe("what marking THIS week late means today", () => {
  // The ordinary case: he was told on Monday, the window closes Thursday.
  it("is silent for a week that has started and is still open", () => {
    const advice = manualLateAdvice({ weekDate: WEEK_START, today: MONDAY, weekNumber: 14 });
    expect(advice.kind).toBe("current");
    expect(advice.message).toBeNull();
  });

  // Unusual, legitimate, and NEVER blocked — he has reasons the system does
  // not know (2.2).
  it("warns for a week that has not started, and still allows it", () => {
    const advice = manualLateAdvice({ weekDate: NEXT_MONTH, today: MONDAY, weekNumber: 19 });
    expect(advice.kind).toBe("future");
    expect(advice.message).toContain("has not started yet");
    expect(advice.message).toContain("allowed");
  });

  // A control that changes nothing is worse than no control.
  it("refuses a week that is already late by the calendar", () => {
    const advice = manualLateAdvice({ weekDate: LONG_PAST, today: MONDAY, weekNumber: 9 });
    expect(advice.kind).toBe("already-late");
    expect(advice.message).toContain("nothing to mark");
  });

  // DEFERRAL ANSWERS FIRST, above even "already late" — a deferred week whose
  // window has closed is not late at all, so saying it "is already late" would
  // be false as well as unhelpful.
  it("refuses a deferred week, and names the way out", () => {
    for (const day of [WEEK_START, NEXT_MONTH, LONG_PAST]) {
      const advice = manualLateAdvice({
        weekDate: day,
        today: MONDAY,
        weekNumber: 14,
        isDeferred: true,
      });
      expect(advice.kind, day.toISOString()).toBe("deferred");
      expect(advice.message).toBe(DEFERRED_BEATS_MARK);
      expect(advice.message).toContain("remove the deferral first");
    }
  });

  // The boundary itself: day 4 is still open, day 5 is closed.
  it("flips exactly at the end of the payment window", () => {
    const open = new Date(WEEK_START.getTime() + 4 * 86_400_000);
    const closed = new Date(WEEK_START.getTime() + 5 * 86_400_000);
    expect(manualLateAdvice({ weekDate: WEEK_START, today: open }).kind).toBe("current");
    expect(manualLateAdvice({ weekDate: WEEK_START, today: closed }).kind).toBe("already-late");
  });
});

describe("the mark overrides the derived status", () => {
  const base = {
    amountPaid: 0,
    amountDue: 50_000,
    isDeferred: false,
    weekDate: WEEK_START,
    today: MONDAY,
  };

  it("an unmarked open week is still UNPAID — the derived rule is untouched", () => {
    expect(paymentStatus(base)).toBe("UNPAID");
  });

  it("a marked open week reads LATE", () => {
    expect(paymentStatus({ ...base, markedLate: true })).toBe("LATE");
  });

  // AMENDED BY R2 (15 Aug 2026). This asserted "LATE" until then, and Pass 3
  // named it as the test that PINNED the defect: it recorded losing the money
  // half as intended behaviour. A marked, part-paid week is now chased AND
  // shown to have money on it.
  it("a marked week with part of the money on it reads PARTIAL_LATE", () => {
    expect(paymentStatus({ ...base, amountPaid: 20_000, markedLate: true })).toBe("PARTIAL_LATE");
    // …and without the mark, its window still being open, it is plain PARTIAL.
    expect(paymentStatus({ ...base, amountPaid: 20_000 })).toBe("PARTIAL");
    // Marked with NOTHING on it is still plain LATE.
    expect(paymentStatus({ ...base, amountPaid: 0, markedLate: true })).toBe("LATE");
  });

  // MONEY IS THE TRUTH (2.14). The payment path clears the mark; this is the
  // belt to that braces, so a mark left behind can never show a covered week
  // as late.
  it("PAID beats the mark", () => {
    expect(paymentStatus({ ...base, amountPaid: 50_000, markedLate: true })).toBe("PAID");
  });

  // DEFERRAL BEATS THE MARK (organizer ruling, Aug 2026).
  //
  // This was built the other way round first, on the reasoning that a mark is
  // a later and narrower decision. The ruling reversed it, and the reason is
  // better: deferral exists precisely to stop a chase reaching someone he has
  // decided not to pursue, so a mark on a deferred week is the platform saying
  // two opposite things about one week. Deferral wins and the screen says how
  // to change it.
  it("DEFERRED beats the mark", () => {
    expect(paymentStatus({ ...base, isDeferred: true })).toBe("DEFERRED");
    expect(paymentStatus({ ...base, isDeferred: true, markedLate: true })).toBe("DEFERRED");
  });

  // Nobody owes a skipped week, so nobody can be late for one.
  it("SKIPPED still beats everything", () => {
    expect(paymentStatus({ ...base, isSkipped: true, markedLate: true })).toBe("SKIPPED");
  });

  it("a future week reads LATE once marked, and UNPAID before", () => {
    const future = { ...base, weekDate: NEXT_MONTH };
    expect(paymentStatus(future)).toBe("UNPAID");
    expect(paymentStatus({ ...future, markedLate: true })).toBe("LATE");
  });
});

describe("counting as due — the calendar's route and the organizer's", () => {
  it("the mark makes an open week count as due", () => {
    expect(weekHasElapsed({ weekDate: WEEK_START, today: MONDAY })).toBe(false);
    expect(weekCountsAsDue({ weekDate: WEEK_START, today: MONDAY })).toBe(false);
    expect(weekCountsAsDue({ weekDate: WEEK_START, today: MONDAY, markedLate: true })).toBe(true);
  });

  it("without a mark it is exactly weekHasElapsed", () => {
    for (const day of [WEEK_START, MONDAY, LONG_PAST, NEXT_MONTH]) {
      expect(weekCountsAsDue({ weekDate: day, today: MONDAY })).toBe(
        weekHasElapsed({ weekDate: day, today: MONDAY }),
      );
    }
  });

  // DEFERRAL BEATS THE MARK here too, or a week showing DEFERRED would be
  // counted as behind by a mark the screen refuses to honour.
  it("a mark on a deferred week does not pull it forward", () => {
    expect(
      weekCountsAsDue({
        weekDate: WEEK_START,
        today: MONDAY,
        markedLate: true,
        isDeferred: true,
      }),
    ).toBe(false);
  });

  // AMENDED BY D-42 (§2.29a, 15 Aug 2026). This asserted the opposite until
  // then — "an elapsed deferred week still counts as due" — which was the
  // pre-D-42 law. A paused week leaves the CURRENT expectation whatever the
  // calendar says; its money is held in `amountDeferred` and resolves at close,
  // so nothing is forgiven by this.
  it("a deferred week never counts as due — elapsed or not, marked or not", () => {
    for (const markedLate of [false, true]) {
      expect(
        weekCountsAsDue({ weekDate: LONG_PAST, today: MONDAY, markedLate, isDeferred: true }),
        `elapsed, markedLate=${markedLate}`,
      ).toBe(false);
      expect(
        weekCountsAsDue({ weekDate: MONDAY, today: MONDAY, markedLate, isDeferred: true }),
        `open, markedLate=${markedLate}`,
      ).toBe(false);
    }
  });
});

// A LATE WEEK ON SCREEN AND A BALANCE THAT SAYS NOTHING IS OWED WOULD BE THE
// CONTRADICTION lib/standing.ts EXISTS TO PREVENT. Marking a week late has to
// move the arithmetic with the status, or the message it enables would quote
// $0.00 across 0 weeks.
describe("the standing agrees with what the screen shows", () => {
  const week = (n: number, over: Partial<StandingWeekInput> = {}): StandingWeekInput => ({
    weekNumber: n,
    // Weeks 1 and 2 are long past; week 3 is the current, open one.
    date: new Date(WEEK_START.getTime() - (3 - n) * 7 * 86_400_000),
    amountDue: 50_000,
    storedPaid: 0,
    isDeferred: false,
    markedLate: false,
    ...over,
  });

  const standing = (weeks: StandingWeekInput[], totalPaid: number) =>
    computeStanding({
      weeklyAmount: 50_000,
      startWeek: 1,
      weeksCommitted: 3,
      cycleWeek: 3,
      today: MONDAY,
      windowWeeks: weeks,
      totalPaid,
    });

  it("leaves the open week out when nothing is marked", () => {
    const s = standing([week(1), week(2), week(3)], 100_000);
    expect(s.weeksElapsedInWindow).toBe(2);
    expect(s.weeksBehind).toBe(0);
    expect(s.amountOutstanding).toBe(0);
    // UNPAID, not LATE: the money covers weeks 1 and 2, and week 3's window is
    // still open. Nothing is owed YET, which is the state the mark exists to
    // let the organizer overrule.
    expect(s.weeks[2].status).toBe("UNPAID");
  });

  it("marking the open week makes it count, and says so in every figure", () => {
    const s = standing([week(1), week(2), week(3, { markedLate: true })], 100_000);
    expect(s.weeksElapsedInWindow).toBe(3);
    expect(s.weeksBehind).toBe(1);
    expect(s.amountOutstanding).toBe(50_000);
    expect(s.weeks[2].status).toBe("LATE");
    expect(s.weeks[2].markedLate).toBe(true);
  });

  // The whole point of the "money is the truth" rule, end to end.
  it("paying the marked week settles it, mark or no mark", () => {
    const s = standing([week(1), week(2), week(3, { markedLate: true })], 150_000);
    expect(s.amountOutstanding).toBe(0);
    expect(s.weeksBehind).toBe(0);
    expect(s.weeks[2].status).toBe("PAID");
  });
});

describe("the command centre sees the mark too", () => {
  const participation = {
    id: "p1",
    name: "Henok",
    weeklyAmount: 50_000,
    startWeek: 1,
    weeksCommitted: 10,
  };
  const pay = (weekNumber: number, over: Partial<DashboardPayment> = {}): DashboardPayment => ({
    participationId: "p1",
    weekNumber,
    amountPaid: 0,
    isDeferred: false,
    isSkipped: false,
    markedLate: false,
    ...over,
  });

  // Weeks 1–2 have elapsed and are paid; week 3 is open.
  const paidUp = [pay(1, { amountPaid: 50_000 }), pay(2, { amountPaid: 50_000 })];

  it("nobody is on the attention list while the open week is only open", () => {
    expect(
      memberAttention({
        participations: [participation],
        payments: [...paidUp, pay(3)],
        elapsedThroughWeek: 2,
      }),
    ).toEqual([]);
  });

  it("marking the open week puts them on it, owing that week", () => {
    const list = memberAttention({
      participations: [participation],
      payments: [...paidUp, pay(3, { markedLate: true })],
      elapsedThroughWeek: 2,
    });
    expect(list).toHaveLength(1);
    expect(list[0].weeksBehind).toBe(1);
    expect(list[0].amountOwed).toBe(50_000);
  });

  // A marked week INSIDE the elapsed range must not be counted twice.
  it("a mark on an already-elapsed week changes nothing", () => {
    const list = memberAttention({
      participations: [participation],
      payments: [pay(1, { amountPaid: 50_000 }), pay(2, { markedLate: true })],
      elapsedThroughWeek: 2,
    });
    expect(list).toHaveLength(1);
    expect(list[0].weeksBehind).toBe(1);
    expect(list[0].amountOwed).toBe(50_000);
  });

  // The attention list and computeStanding must not disagree about who is
  // behind, so the ruling has to hold in both.
  it("a mark on a deferred week keeps them off the attention list", () => {
    expect(
      memberAttention({
        participations: [participation],
        payments: [...paidUp, pay(3, { markedLate: true, isDeferred: true })],
        elapsedThroughWeek: 2,
      }),
    ).toEqual([]);
  });

  it("this week's breakdown shows them as LATE, not as merely unpaid", () => {
    // AN OPEN WEEK, so the MARK is the only thing that can make it late —
    // which is what this test is about. Once the window shuts the calendar
    // makes it late on its own, and that case is pinned in dashboard.test.ts.
    const open = { weekDate: WEEK_START, today: MONDAY };
    const rows = weekMemberStatus({
      weekNumber: 3,
      ...open,
      participations: [participation],
      payments: [pay(3, { markedLate: true })],
    });
    expect(rows[0].status).toBe("LATE");
    // The mark rides along as a NOTE, so a screen can say how it became late
    // without making it a category of its own.
    expect(rows[0].markedLate).toBe(true);

    const unmarked = weekMemberStatus({
      weekNumber: 3,
      ...open,
      participations: [participation],
      payments: [pay(3)],
    });
    expect(unmarked[0].status).toBe("UNPAID");
    expect(unmarked[0].markedLate).toBe(false);
  });

  it("the this-week screen has a group for it", () => {
    const src = read("app/admin/(protected)/this-week/page.tsx");
    expect(src).toMatch(/key: "LATE"/);
  });
});

// #5: the mark has to reach MESSAGING, not just the screen he marked it on.
describe("a late notice becomes sendable the moment the week is marked", () => {
  const state = {
    name: "Henok",
    drawnWeek: null,
    cycleClosed: false,
    // A LIVE participation in the running cycle — the only state in which a
    // late notice is offered at all (rule 17: stopped is not behind). Added
    // when applicableTypes stopped inferring the cycle's status from the
    // absence of a participation; see lib/messaging-subject.ts.
    participation: "live" as const,
    noMessages: false,
    hasPhone: true,
    welcomeSentAt: null,
    hasEverPaid: true,
  };
  const lateNotice = (over: { weeksBehind: number; amountOutstanding: number }) =>
    applicableTypes({ ...state, ...over }).find((t) => t.key === "LATE_NOTICE")!;

  it("is not offered while nothing is owed", () => {
    const t = lateNotice({ weeksBehind: 0, amountOutstanding: 0 });
    expect(t.applicable).toBe(false);
    expect(t.reason).toContain("owes nothing");
  });

  // The mark drives this through `amountOutstanding`, which is exactly why
  // the standing arithmetic had to move with the status rather than beside it.
  it("is offered once the marked week has made money outstanding", () => {
    expect(lateNotice({ weeksBehind: 1, amountOutstanding: 50_000 }).applicable).toBe(true);
  });

  // The message names the CHASED weeks off the per-week statuses, so a marked
  // week reaches the wording by the same route a calendar-late one does.
  //
  // AMENDED BY R2 (15 Aug 2026): the filter was `w.status === "LATE"`. It now
  // asks the shared predicate, so a part-paid chased week is named too and a
  // real debt cannot drop off the notice.
  it("the notice names its weeks from the derived statuses, not a second rule", () => {
    const src = read("lib/messages.ts");
    expect(src).toMatch(/\.filter\(\(w\) => isChasedStatus\(w\.status\)\)/);
  });
});

describe("the stored decision and the paths that clear it", () => {
  it("the mark is a timestamp, not a boolean — when he decided is part of it", () => {
    const schema = read("prisma/schema.prisma");
    expect(schema).toMatch(/markedLateAt\s+DateTime\?/);
    expect(schema).toMatch(/markedLateNote\s+String\?/);
  });

  // Recording a payment clears it — in the ONE rebuild every money path runs
  // through, not in the record action, so an edited or deleted receipt and a
  // settlement all behave the same way.
  it("money clears the mark inside rebuildParticipationPayments", () => {
    const src = read("lib/rebuild.ts");
    expect(src).toMatch(/markedLateAt: null/);
    expect(src).toMatch(/s\.paid >= participation\.weeklyAmount/);
  });

  // Deferring is a decision NOT to chase, so it takes the mark with it —
  // leaving one underneath would spring it back weeks later, when the deferral
  // came off, with nobody expecting it.
  it("deferring a week clears any mark on it", () => {
    const src = read("app/actions/edits.ts");
    expect(src).toMatch(
      /input\.deferred\s*\n?\s*\?\s*\{ isDeferred: true, markedLateAt: null, markedLateNote: null \}/,
    );
  });

  it("the action refuses a week that is already late, deferred, or already paid", () => {
    const src = read("app/actions/edits.ts");
    expect(src).toMatch(/advice\.kind === "already-late" \|\| advice\.kind === "deferred"/);
    expect(src).toMatch(/already paid in full/);
    // The advice the action asks for must KNOW about the deferral, or the
    // refusal above can never fire.
    expect(src).toMatch(/isDeferred: before\?\.isDeferred \?\? false/);
    // Reversible: `late: false` clears both columns.
    expect(src).toMatch(/const markedLateAt = input\.late \? new Date\(\) : null;/);
    // And it is audited, from what to what.
    expect(src).toMatch(/marked LATE by hand/);
  });

  it("the panel offers the control, and hides it when it would do nothing", () => {
    const src = read("components/admin/week-action-panel.tsx");
    expect(src).toContain("setWeekLate");
    expect(src).toMatch(/data-testid="mark-late"/);
    expect(src).toMatch(/detail\.markedLate \|\| detail\.lateAdvice\.kind !== "already-late"/);
    // The future-week warning goes in the dialog's consequence slot, and the
    // dialog still CONFIRMS rather than refusing.
    expect(src).toMatch(/advice\.kind === "future" \? advice\.message : undefined/);
  });

  // DISABLED, NOT HIDDEN, and the reason is on screen rather than in a hover.
  // A control that vanishes leaves him hunting for something he used
  // yesterday; one that is dead and explains itself does not.
  it("a deferred week disables the control and shows why, in words", () => {
    const src = read("components/admin/week-action-panel.tsx");
    expect(src).toMatch(/detail\.lateAdvice\.kind === "deferred"/);
    expect(src).toMatch(/data-testid="deferred-beats-mark"/);
  });
});
