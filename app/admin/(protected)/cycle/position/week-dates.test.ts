import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatDateLongUTC } from "@/lib/format";
import { receiptsByWeek } from "@/lib/dashboard";
import {
  boundsForWeek,
  describeWeekDateChange,
  membersAffectedByWeekDate,
  outOfSequenceWeeks,
  weekClock,
  weekClockLabel,
  weekWindowClosesOn,
  type WeekDateRow,
} from "./week-dates";

// THE STORED WEEK DATE IS THE ONE FACT ON THIS PAGE THAT CAN BE WRONG.
//
// Everything else the position screen prints is derived (2.14) and therefore
// self-correcting. These dates are stored, they decide who is overdue (rule 7),
// and until this build NOTHING in the platform could show or change one:
// `updateWeek` had zero callers and `weekDateBounds` had zero production
// callers. Both properties are asserted here, because both are exactly the
// kind of gap that reappears the moment a route is deleted.

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const row = (weekNumber: number, date: string, over: Partial<WeekDateRow> = {}): WeekDateRow => ({
  id: `w${weekNumber}`,
  weekNumber,
  date,
  notes: null,
  membersExpected: 27,
  membersShort: 0,
  // Defaults to whatever `membersShort` is unless a test says otherwise: the
  // two coincide only when nobody is marked late and nobody is deferred, which
  // is the ordinary case and the right default for a fixture.
  membersAffectedByDate: 0,
  ...over,
});

// The live cycle's shape: 20 weeks from Sunday 17 May 2026, weekly.
const cycle = Array.from({ length: 20 }, (_, i) =>
  row(i + 1, new Date(Date.UTC(2026, 4, 17) + i * 7 * 86_400_000).toISOString().slice(0, 10)),
);

describe("weekWindowClosesOn — the day the arithmetic turns on", () => {
  // The default window is 5 days (rule 7: opens Sunday, closes Thursday). This
  // is printed beside every week, so it has to be the SAME boundary
  // weekHasElapsed uses rather than a second, drifting copy.
  it("is the week's own date plus the payment window", () => {
    expect(weekWindowClosesOn("2026-08-02")).toBe("2026-08-07");
  });

  it("crosses a month and a year end without a special case", () => {
    expect(weekWindowClosesOn("2026-08-30")).toBe("2026-09-04");
    expect(weekWindowClosesOn("2026-12-28")).toBe("2027-01-02");
  });

  it("respects a different window length", () => {
    expect(weekWindowClosesOn("2026-08-02", 7)).toBe("2026-08-09");
  });

  it("returns null for a date it cannot read, rather than inventing one", () => {
    expect(weekWindowClosesOn("not-a-date")).toBeNull();
    expect(weekWindowClosesOn("2026-02-31")).toBeNull();
  });
});

describe("weekClock — closed, open, or not yet", () => {
  // The exact boundary DOMAIN_RULES rule 7 works: week 5 dated Sunday June 16,
  // still open on the 19th, elapsed on the 21st. This test would have passed on
  // a naive "is the date in the past" check for the third case only — the first
  // two are the ones that matter, because calling an open week closed is what
  // accuses someone before their window shut.
  const date = "2026-06-16";

  it("is OPEN on the week's own day", () => {
    expect(weekClock({ date, today: utc("2026-06-16") })).toBe("open");
  });

  it("is still OPEN on day 4, when nobody may be called overdue", () => {
    expect(weekClock({ date, today: utc("2026-06-19") })).toBe("open");
  });

  it("is CLOSED from day 5, the moment the window shuts", () => {
    expect(weekClock({ date, today: utc("2026-06-21") })).toBe("closed");
  });

  it("is AHEAD before the day arrives", () => {
    expect(weekClock({ date, today: utc("2026-06-15") })).toBe("ahead");
  });

  it("says so in words that are not the money vocabulary", () => {
    // "overdue" is reserved for money whose window closed unpaid
    // (UI_STANDARDS rule 8). A week is not overdue; a payment is.
    expect(weekClockLabel("closed")).toBe("window closed");
    expect(weekClockLabel("open")).toBe("window open");
    expect(weekClockLabel("ahead")).toBe("not yet");
    for (const clock of ["closed", "open", "ahead"] as const) {
      expect(weekClockLabel(clock)).not.toMatch(/overdue|arrears|outstanding/i);
    }
  });

  it("returns null for an unreadable stored date", () => {
    expect(weekClock({ date: "", today: utc("2026-06-21") })).toBeNull();
  });
});

describe("boundsForWeek — weekDateBounds finally has a caller", () => {
  // THIS IS THE GAP. `weekDateBounds` was written, tested and correct, and no
  // production code called it — which is how you could tell from the outside
  // that no screen could edit a week date at all. Nothing here re-implements
  // the rule; it finds the two neighbours, which is the half nobody had.

  it("bounds a middle week strictly BETWEEN its neighbours", () => {
    const bounds = boundsForWeek(cycle, 12);
    // Week 11 is 2026-07-26, week 13 is 2026-08-09.
    expect(bounds.min).toBe("2026-07-27");
    expect(bounds.max).toBe("2026-08-08");
  });

  it("names both weeks and both dates, so the refusal can be acted on", () => {
    expect(boundsForWeek(cycle, 12).reason).toBe(
      "Weeks run in order, so this one must fall after week 11 (2026-07-26) and before week 13 (2026-08-09).",
    );
  });

  it("bounds week 1 on one side only — a cycle can legitimately move earlier", () => {
    const bounds = boundsForWeek(cycle, 1);
    expect(bounds.min).toBeNull();
    expect(bounds.max).toBe("2026-05-23");
  });

  it("bounds the last week on one side only — a cycle can run long (2.7)", () => {
    const bounds = boundsForWeek(cycle, 20);
    expect(bounds.min).toBe("2026-09-21");
    expect(bounds.max).toBeNull();
  });

  it("uses the neighbours by WEEK NUMBER, not by list order", () => {
    // Rows arriving in any order must produce the same bound — the panel sorts
    // for display and a caller elsewhere might not.
    const shuffled = [cycle[12], cycle[10], cycle[11]];
    expect(boundsForWeek(shuffled, 12)).toEqual(boundsForWeek(cycle, 12));
  });

  it("leaves a side unbounded when that neighbour's own date is unreadable", () => {
    // Refusing every edit until the corrupt row is fixed would trap the
    // organizer on the only screen that can fix it.
    const broken = [row(11, "garbage"), row(12, "2026-08-02"), row(13, "2026-08-09")];
    const bounds = boundsForWeek(broken, 12);
    expect(bounds.min).toBeNull();
    expect(bounds.max).toBe("2026-08-08");
  });

  it("bounds nothing for a week that is not in the list", () => {
    expect(boundsForWeek(cycle, 99)).toEqual({ min: null, max: null, reason: null });
  });
});

describe("outOfSequenceWeeks — audit finding 29's shape, made visible", () => {
  it("finds nothing in a cycle that runs in order", () => {
    expect(outOfSequenceWeeks(cycle)).toEqual([]);
  });

  it("catches a week dated BEFORE the one before it", () => {
    // The reported sequence: correcting week 18 and typing a date already past.
    const broken = cycle.map((w) => (w.weekNumber === 18 ? row(18, "2026-05-24") : w));
    expect(outOfSequenceWeeks(broken)).toEqual([18]);
  });

  it("catches two weeks sharing a day — 'which closed first' is unanswerable", () => {
    const broken = cycle.map((w) => (w.weekNumber === 6 ? row(6, cycle[4].date) : w));
    expect(outOfSequenceWeeks(broken)).toEqual([6]);
  });

  it("names the offending week ONLY, not every week after it", () => {
    // A rule that flags everything gets ignored (UI_STANDARDS rule 2 learned
    // this from a probe that reported 589 failures). The anchor stays on the
    // last week that was in sequence.
    const broken = cycle.map((w) => (w.weekNumber === 10 ? row(10, "2026-05-18") : w));
    expect(outOfSequenceWeeks(broken)).toEqual([10]);
  });

  it("treats an unreadable date as a fault of its own", () => {
    expect(outOfSequenceWeeks([row(1, "2026-05-17"), row(2, "")])).toEqual([2]);
  });
});

// ————————————————————————————————————————————————————————————————————————
// TWO DERIVATIONS, TWO QUESTIONS — PINNED WHERE THEY DIVERGE.
//
// `membersShort` answers "who has not covered this week". `membersAffectedByDate`
// answers "whose late-and-behind standing does the DAY decide". Keeping two
// counts of nearly-the-same thing is a real risk: the obvious future edit is to
// notice they usually agree and collapse them into one.
//
// A COMMENT CANNOT STOP THAT. This fixture can. It holds one member of each
// divergent kind and asserts the two counts DIFFER — so anyone who unifies them
// fails the build with this test named, and reads why here.
//
// They agree on live data TODAY (no week is marked late, and every deferred row
// happens to be covered), which is exactly why the divergence needed pinning
// rather than observing.
// ————————————————————————————————————————————————————————————————————————
describe("membersShort and membersAffectedByDate are different questions", () => {
  const WEEK = 12;

  // Five members, all in window for week 12, all committed 20 weeks at $500.
  //
  // TWO marked-late members, not one, and that is deliberate. With one of each
  // the two counts came out EQUAL — 2 and 2 — while describing different
  // people, so the headline assertion passed for the wrong reason and would
  // have kept passing on an implementation that collapsed them. The fixture
  // has to break the tie as well as the membership.
  const participations = ["paid", "plain", "marked", "markedToo", "deferred"].map((id) => ({
    id,
    weeklyAmount: 50_000,
    startWeek: 1,
    weeksCommitted: 20,
  }));

  const payment = (
    participationId: string,
    over: Partial<{ amountPaid: number; isDeferred: boolean; markedLate: boolean }> = {},
  ) => ({
    participationId,
    weekNumber: WEEK,
    amountPaid: 0,
    isDeferred: false,
    isSkipped: false,
    markedLate: false,
    ...over,
  });

  const payments = [
    // Covered. In neither count: money is the truth and no date touches it.
    payment("paid", { amountPaid: 50_000 }),
    // Short, and the date decides it. In BOTH counts.
    payment("plain"),
    // MARKED LATE BY HAND (2.2). In `membersShort` — `weekReceipts` ignores the
    // mark entirely — but the date decides NOTHING for them, because
    // `paymentStatus` returns LATE on the mark before it looks at the window.
    payment("marked", { markedLate: true }),
    payment("markedToo", { markedLate: true }),
    // DEFERRED and unpaid. DROPPED from `membersShort` by `weekReceipts`'s
    // `if (payment?.isDeferred) continue;` — yet an elapsed deferred week still
    // counts toward weeks-behind and still carries its amount (rule 5), so the
    // date moves their standing like anyone else's.
    payment("deferred", { isDeferred: true }),
  ];

  const short = () => {
    const week = receiptsByWeek({
      weeks: [{ weekNumber: WEEK, isSkipped: false }],
      participations,
      payments,
      elapsedThroughWeek: WEEK,
    })[0];
    return Math.max(0, week.membersExpected - week.membersPaid);
  };
  const affected = () =>
    membersAffectedByWeekDate({
      weekNumber: WEEK,
      isSkipped: false,
      participations,
      payments,
    });

  // THE ASSERTION THAT MATTERS. If a future edit makes one of these read the
  // other, this line fails.
  it("DIFFER on a fixture holding a marked-late member and a deferred one", () => {
    expect(short()).not.toBe(affected());
  });

  it("membersShort counts the plain and both marked, and drops the deferred", () => {
    // "plain", "marked" and "markedToo" are short; "deferred" is skipped before
    // counting; "paid" covered it.
    expect(short()).toBe(3);
  });

  it("membersAffectedByDate counts the plain and the deferred, and drops the marked", () => {
    expect(affected()).toBe(2);
  });

  // THE NUMBERS ARE NOT ENOUGH ON THEIR OWN. Two counts can coincide while
  // describing different people — they did at four members — so these assert
  // the MEMBERSHIP: removing a member each count treats differently moves one
  // figure and not the other.
  it("each excludes a member the other includes — the counts alone are not enough", () => {
    const withoutMarked = participations.filter((p) => p.id !== "marked");
    const withoutDeferred = participations.filter((p) => p.id !== "deferred");

    // Remove the marked member: `membersShort` drops by one, `affected` does not.
    const shortNoMarked = (() => {
      const w = receiptsByWeek({
        weeks: [{ weekNumber: WEEK, isSkipped: false }],
        participations: withoutMarked,
        payments,
        elapsedThroughWeek: WEEK,
      })[0];
      return Math.max(0, w.membersExpected - w.membersPaid);
    })();
    expect(shortNoMarked).toBe(short() - 1);
    expect(
      membersAffectedByWeekDate({
        weekNumber: WEEK,
        isSkipped: false,
        participations: withoutMarked,
        payments,
      }),
    ).toBe(affected());

    // Remove the deferred member: `affected` drops by one, `membersShort` does not.
    expect(
      membersAffectedByWeekDate({
        weekNumber: WEEK,
        isSkipped: false,
        participations: withoutDeferred,
        payments,
      }),
    ).toBe(affected() - 1);
    const shortNoDeferred = (() => {
      const w = receiptsByWeek({
        weeks: [{ weekNumber: WEEK, isSkipped: false }],
        participations: withoutDeferred,
        payments,
        elapsedThroughWeek: WEEK,
      })[0];
      return Math.max(0, w.membersExpected - w.membersPaid);
    })();
    expect(shortNoDeferred).toBe(short());
  });

  it("nobody is affected by the date of a week nobody owes", () => {
    expect(
      membersAffectedByWeekDate({
        weekNumber: WEEK,
        isSkipped: true,
        participations,
        payments,
      }),
    ).toBe(0);
  });

  // A member away for that stretch (2.18) is not a member the date decides
  // anything for — the same window rule `receiptsByWeek` applies.
  it("skips a member who was away for the week", () => {
    const away = participations.map((p) =>
      p.id === "plain" ? { ...p, breaks: [{ fromWeek: 10, toWeek: 14 }] } : p,
    );
    expect(
      membersAffectedByWeekDate({
        weekNumber: WEEK,
        isSkipped: false,
        participations: away,
        payments,
      }),
    ).toBe(affected() - 1);
  });
});

describe("describeWeekDateChange — what MOVING a date actually does", () => {
  // "This may affect member standing" is a warning nobody reads, because it
  // never says anything. These are the real figures, computed before the save.
  const today = utc("2026-08-12");
  // `membersAffectedByDate` defaults to `membersShort`, because that is what
  // they are when nobody is marked late and nobody is deferred. A test that
  // cares about the difference passes it explicitly — see the block on the
  // manual late mark below.
  const say = (over: {
    date: string;
    to: string;
    membersShort?: number;
    membersAffectedByDate?: number;
  }) =>
    describeWeekDateChange({
      row: {
        weekNumber: 12,
        date: over.date,
        membersShort: over.membersShort ?? 0,
        membersAffectedByDate: over.membersAffectedByDate ?? over.membersShort ?? 0,
      },
      to: over.to,
      today,
      formatDay: formatDateLongUTC,
    });

  it("says nothing when the date is unchanged — there is no consequence to state", () => {
    expect(say({ date: "2026-08-02", to: "2026-08-02" })).toBeNull();
  });

  it("says nothing for a date it cannot read", () => {
    expect(say({ date: "2026-08-02", to: "2026-02-31" })).toBeNull();
  });

  it("states the move and BOTH window days, in the same date form as the screen", () => {
    const change = say({ date: "2026-08-02", to: "2026-08-09" })!;
    expect(change.facts[0]).toBe(
      "Week 12 moves from Sunday, August 2, 2026 to Sunday, August 9, 2026.",
    );
    expect(change.facts[1]).toContain("Friday, August 7, 2026");
    expect(change.facts[1]).toContain("Friday, August 14, 2026");
  });

  // THE CASE THE WHOLE FEATURE EXISTS FOR. Week 12's window shut on Aug 7;
  // today is Aug 12, so three members are overdue for it. Moving it to Aug 9
  // reopens the window and they stop being overdue — a real, immediate change
  // to three people's standing that no other screen would have announced.
  it("names the members who STOP being overdue when a week reopens", () => {
    const change = say({ date: "2026-08-02", to: "2026-08-09", membersShort: 3 })!;
    expect(change.wasElapsed).toBe(true);
    expect(change.willBeElapsed).toBe(false);
    expect(change.standing).toContain("3 members count as overdue for week 12 today");
    expect(change.standing).toContain("Friday, August 14, 2026");
  });

  it("names the members who BECOME overdue when a week is moved back", () => {
    const change = say({ date: "2026-08-09", to: "2026-08-02", membersShort: 2 })!;
    expect(change.wasElapsed).toBe(false);
    expect(change.willBeElapsed).toBe(true);
    expect(change.standing).toContain("2 members count as overdue for week 12 the moment you save");
  });

  it("says plainly that nobody moves when the elapsed state does not change", () => {
    const change = say({ date: "2026-07-05", to: "2026-07-12", membersShort: 4 })!;
    expect(change.wasElapsed).toBe(true);
    expect(change.willBeElapsed).toBe(true);
    expect(change.standing).toContain("nobody's overdue standing changes today");
    expect(change.standing).toContain("4 members are short for it either way");
  });

  it("does not claim members move when none are short", () => {
    const change = say({ date: "2026-08-02", to: "2026-08-09", membersShort: 0 })!;
    expect(change.standing).toContain("Nobody is short for week 12");
    expect(change.standing).not.toMatch(/\b0 members\b/);
  });

  it("uses singular English for one member", () => {
    const change = say({ date: "2026-08-02", to: "2026-08-09", membersShort: 1 })!;
    expect(change.standing).toContain("1 member counts as overdue");
    expect(change.standing).not.toContain("1 members");
  });

  it("uses no banned accounting vocabulary anywhere in what it says", () => {
    // UI_STANDARDS 8b: he is not an accountant, and every one of these words
    // made him stop and translate on a cash screen.
    const change = say({ date: "2026-08-02", to: "2026-08-09", membersShort: 3 })!;
    const all = [...change.facts, change.standing, change.whatMoves].join(" ");
    for (const banned of [
      /\bcommitted\b/i,
      /\buncommitted\b/i,
      /\breconcil/i,
      /\bposition\b/i,
      /\bclaimed\b/i,
    ]) {
      expect(all).not.toMatch(banned);
    }
  });

  // ————————————————— The promise it could not keep —————————————————
  //
  // THE STRING THIS REPLACES, verbatim:
  //
  //   "No money moves. Every payment stays on week 12 — only the day the week
  //    happened changes."
  //
  // True of the receipt ROWS: moving a week's date re-allocates nothing and no
  // row changes hands. FALSE of every money figure built on that date. The
  // week's own stored date decides whether it has ELAPSED (rule 7,
  // `weekHasElapsed`), and elapsed is the filter feeding `weeksBehind` and
  // `amountOutstanding` in `lib/standing.ts` and LATE in `paymentStatus`. So
  // the same button that "moves no money" can turn a member who is current into
  // a member who is late, with money reading as overdue that was not overdue a
  // second earlier — and it can take a late notice from sendable to not.
  //
  // EVERY ASSERTION BELOW FAILS ON THAT SENTENCE. It contained none of these
  // words, and — the strongest of them — it was ONE CONSTANT for every case, so
  // it could not distinguish the move that flips who is late from the move that
  // flips nothing. That is the property the last test pins.
  describe("whatMoves — states the change as well as the non-change", () => {
    it("keeps the true half: the receipts stay exactly where they are", () => {
      const change = say({ date: "2026-08-02", to: "2026-08-09", membersShort: 3 })!;
      expect(change.whatMoves).toContain("No receipt moves");
      expect(change.whatMoves).toContain("every payment stays on week 12");
      expect(change.whatMoves).toContain("nothing is re-allocated");
    });

    it("says who STARTS counting as late when a week is dragged back over its window", () => {
      // Week 12 dated Aug 9 is still open today (Aug 12). Dated Aug 2 its
      // window shut on Aug 7, so two members become late the moment he saves.
      const change = say({ date: "2026-08-09", to: "2026-08-02", membersShort: 2 })!;
      expect(change.willBeElapsed).toBe(true);
      expect(change.whatMoves).toContain("starts counting against them");
      expect(change.whatMoves).toContain("it decides this for 2 members");
      // THE SCOPE CLAUSE, and it is the whole correction: the date decides
      // this for everyone EXCEPT the members he marked late by hand.
      expect(change.whatMoves).toContain("For anyone you have NOT already marked late by hand");
    });

    it("says who STOPS counting as late when a week is dragged forward", () => {
      const change = say({ date: "2026-08-02", to: "2026-08-09", membersShort: 3 })!;
      expect(change.willBeElapsed).toBe(false);
      expect(change.whatMoves).toContain("stops counting against them");
      expect(change.whatMoves).toContain("it decides this for 3 members");
    });

    it("names the three figures that actually move, in the organizer's words", () => {
      // behind, overdue, and whether a late notice can be sent — the chain
      // `elapsed` feeds (lib/standing.ts, and LATE_NOTICE's own applicability
      // rule in lib/messages.ts, which keys on money reading as overdue).
      const change = say({ date: "2026-08-02", to: "2026-08-09", membersShort: 3 })!;
      expect(change.whatMoves).toContain("weeks behind");
      expect(change.whatMoves).toContain("overdue");
      expect(change.whatMoves).toContain("late notice");
    });

    it("scopes the no-change claim to the figures that genuinely do not change", () => {
      // Both dates are long past, so week 12 counts as elapsed either side and
      // the behind/overdue arithmetic is untouched. The sentence says THAT,
      // rather than the unscoped "no money moves" that was also printed here.
      const change = say({ date: "2026-07-05", to: "2026-07-12", membersShort: 4 })!;
      expect(change.wasElapsed).toBe(true);
      expect(change.willBeElapsed).toBe(true);
      expect(change.whatMoves).toContain(
        "no member's weeks behind or overdue money moves either",
      );
      expect(change.whatMoves).toContain("counts as elapsed before and after");
    });

    // A FLIP THAT MOVES NOBODY IS NOT A FLIP WORTH CLAIMING. This branch did
    // not exist: the sentence said "who counts as late changes" whenever the
    // window state flipped, even when every in-window member had covered the
    // week — while the SAME dialog's `standing` line said "no member's
    // standing moves". One dialog, two answers.
    it("says nothing moves when the flip decides nothing for anybody", () => {
      const change = say({ date: "2026-08-02", to: "2026-08-09", membersAffectedByDate: 0 })!;
      expect(change.whatMoves).toContain("decides nothing for anybody");
      expect(change.whatMoves).not.toContain("What DOES move");
      expect(change.whatMoves).not.toMatch(/\b0 members\b/);
    });

    // THE POPULATION THE OLD COPY GOT WRONG IN BOTH DIRECTIONS.
    //
    // `membersShort` counts who has not covered the week. The date decides
    // late-and-behind for a DIFFERENT set: it excludes anyone marked late by
    // hand — `paymentStatus` returns LATE on the mark BEFORE it looks at the
    // window, so the day decides nothing for them — and includes anyone
    // deferred, whom `membersShort` drops before counting even though an
    // elapsed deferred week still counts toward weeks-behind (rule 5).
    //
    // NO TEST COULD HAVE CAUGHT THIS BEFORE. `describeWeekDateChange` took
    // only `membersShort`, so the two populations were the same number by
    // construction and the distinction was unexpressible.
    it("quotes the population the DATE decides, not the population who are short", () => {
      // Five are short, but three of them he marked late himself: the date
      // moves nothing for those three.
      const change = say({
        date: "2026-08-02",
        to: "2026-08-09",
        membersShort: 5,
        membersAffectedByDate: 2,
      })!;
      expect(change.whatMoves).toContain("it decides this for 2 members");
      expect(change.whatMoves).not.toContain("5 members");
    });

    it("can quote MORE than are short — a deferred week still counts", () => {
      const change = say({
        date: "2026-08-02",
        to: "2026-08-09",
        membersShort: 1,
        membersAffectedByDate: 4,
      })!;
      expect(change.whatMoves).toContain("it decides this for 4 members");
    });

    it("says something DIFFERENT for a move that flips who is late", () => {
      // THE PROPERTY THE OLD STRING COULD NOT HAVE: it was one constant, so the
      // dangerous move and the harmless one were described identically. Same
      // week, same member count, one crosses the window boundary and one does
      // not — the sentences must not match.
      const flips = say({ date: "2026-08-02", to: "2026-08-09", membersShort: 3 })!;
      const harmless = say({ date: "2026-07-05", to: "2026-07-12", membersShort: 3 })!;
      expect(flips.whatMoves).not.toBe(harmless.whatMoves);
    });

    it("never tells him no money moves, in any branch", () => {
      const moves = [
        ["2026-08-02", "2026-08-09"], // elapsed → open
        ["2026-08-09", "2026-08-02"], // open → elapsed
        ["2026-07-05", "2026-07-12"], // elapsed both sides
        ["2026-09-06", "2026-09-13"], // ahead both sides
      ] as const;
      for (const [date, to] of moves) {
        const change = say({ date, to, membersShort: 3 })!;
        const all = [...change.facts, change.standing, change.whatMoves].join(" ");
        expect(all).not.toMatch(/no money moves/i);
        // …and the half that IS true is never dropped to achieve that.
        expect(change.whatMoves).toContain("No receipt moves");
      }
    });
  });
});

// ————————————————— Source guards —————————————————

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("GUARD — updateWeek is reachable from a screen (2.23)", () => {
  // THE PROPERTY THAT WAS ABSENT, and the only one that would have caught this.
  //
  // `updateWeek` was correct, guarded, audited — and orphaned. The editor that
  // called it died with the `/admin/cycle/weeks` route, and nothing said so:
  // the action still compiled, still had its refusals, still passed every test
  // of its own behaviour. Meanwhile the one stored fact every late/behind
  // figure derives from could only be corrected with raw SQL, which 2.23
  // forbids in those words.
  //
  // An action with no caller is not a feature. This asserts the wiring, which
  // is the part that rotted.
  const slash = (f: string) => f.split("\\").join("/");
  const files = [...walk("app"), ...walk("components")]
    .map(slash)
    // The definition itself is not a caller.
    .filter((f) => !f.endsWith("app/actions/edits.ts"));

  it("finds the source tree (guards against a silently empty scan)", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("at least one screen calls updateWeek", () => {
    const callers = files.filter((f) => /\bupdateWeek\s*\(/.test(readFileSync(f, "utf8")));
    expect(callers).not.toEqual([]);
  });

  it("the caller IMPORTS it from the actions module rather than redefining it", () => {
    // Proven non-vacuous by the shape of the check: a bare `updateWeek`
    // identifier is not enough — an import line alone would satisfy a
    // word-boundary match, which is exactly how an earlier guard in this
    // codebase was vacuous (§5.2). The call parenthesis is required above, and
    // the import is required here.
    const importers = files.filter((f) =>
      /import\s*\{[^}]*\bupdateWeek\b[^}]*\}\s*from\s*"@\/app\/actions\/edits"/.test(
        readFileSync(f, "utf8"),
      ),
    );
    expect(importers).not.toEqual([]);
  });
});

describe("GUARD — the week date is bounded on the SERVER, not only in the picker", () => {
  // Rule 11: "a bound that lives in the UI is a hint." Audit finding 29 was
  // exactly that — the picker bounded the date, the action did not, and a
  // direct call could date a week before its predecessor, moving who counts as
  // overdue and mis-dating every week generated afterwards.
  const source = readFileSync(join("app", "actions", "edits.ts"), "utf8");
  const updateWeek = source.slice(
    source.indexOf("export async function updateWeek"),
    source.indexOf("// ————————————————— Draws —————————————————"),
  );

  it("finds the function (guards against a silently empty slice)", () => {
    expect(updateWeek.length).toBeGreaterThan(500);
    expect(updateWeek).toContain("tx.week.update");
  });

  it("checks the proposed date against weekDateBounds before writing", () => {
    expect(updateWeek).toMatch(/weekDateBounds\(\{/);
    expect(updateWeek).toMatch(/isWithinBounds\(toIsoDay\(date\), bounds\)/);
  });

  it("refuses a closed cycle before it touches anything (rule 14)", () => {
    expect(updateWeek).toMatch(/frozenCycleRefusal\(before\.cycle\)/);
    expect(updateWeek.indexOf("frozenCycleRefusal")).toBeLessThan(
      updateWeek.indexOf("tx.week.update"),
    );
  });

  it("writes an audit entry naming the date it moved (rule 15)", () => {
    expect(updateWeek).toContain("logAudit");
    expect(updateWeek).toMatch(/toIsoDay\(before\.date\)\} -> \$\{toIsoDay\(after\.date\)\}/);
  });

  it("keeps the stored note when the caller does not send one", () => {
    // Audit finding 7 — "notes erased by omission" — in a fresh location. It
    // was `input.notes?.trim() || null`, which nulls the column for any caller
    // that simply did not mention notes.
    expect(updateWeek).toContain("input.notes === undefined ? before.notes");
    expect(updateWeek).not.toMatch(/notes: input\.notes\?\.trim\(\) \|\| null/);
  });

  it("keeps the stored skip flag when the caller does not send one", () => {
    // There is no skip control anywhere and there must not be one. A REQUIRED
    // flag forces the screen to send a value it does not own, and the wrong
    // value silently replays every participation in the cycle.
    expect(updateWeek).toContain("input.isSkipped ?? before.isSkipped");
  });
});
