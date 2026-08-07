import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { emptyDrawCleanup, freedWeekClause } from "./draw-cascade";

// THE BUG THIS PINS. Week 6's only winner was moved to week 7. The payout and
// the slot membership moved; the Draw stayed. Week 6 was then counted as
// drawn, held nothing, showed no amount in any picker, and could never be
// drawn again (Draw.@@unique([weekId])). A live audit found the same shape on
// week 1, left behind by deleting the last payout.
//
// The rule these tests hold in place: a draw records that a slot WON a week.
// With no payout left there is no win, so the draw goes and the week is
// genuinely undrawn — its slot numbers back in the pool.

describe("emptyDrawCleanup — a draw never survives its last payout", () => {
  it("leaves a draw alone while it still holds a payout", () => {
    const cleanup = emptyDrawCleanup({
      weekNumber: 8,
      payoutsRemaining: 1,
      slotNumbers: [19],
    });
    expect(cleanup.deleteDraw).toBe(false);
    expect(cleanup.deleteSlot).toBe(false);
    expect(cleanup.numbersReturning).toEqual([]);
    expect(cleanup.sentence).toBe("");
  });

  it("leaves a draw alone when several payouts remain", () => {
    expect(
      emptyDrawCleanup({ weekNumber: 9, payoutsRemaining: 2, slotNumbers: [3, 44] }).deleteDraw,
    ).toBe(false);
  });

  // THE WEEK 1 SHAPE: the last payout was deleted, but #78 stayed in the slot
  // and so stayed out of the wheel pool.
  it("deletes the draw and returns the stranded numbers when the last payout goes", () => {
    const cleanup = emptyDrawCleanup({
      weekNumber: 1,
      payoutsRemaining: 0,
      slotNumbers: [78],
    });
    expect(cleanup.deleteDraw).toBe(true);
    expect(cleanup.numbersReturning).toEqual([78]);
    expect(cleanup.sentence).toContain("Week 1");
    expect(cleanup.sentence).toContain("UNDRAWN");
    expect(cleanup.sentence).toContain("#78 returns to the wheel pool");
    // The slot still holds #78, so it is NOT released.
    expect(cleanup.deleteSlot).toBe(false);
  });

  // THE WEEK 6 SHAPE: the winner moved out, taking their slot membership with
  // them, so the slot was emptied too and must be released.
  it("releases the slot as well when nobody is left in it", () => {
    const cleanup = emptyDrawCleanup({
      weekNumber: 6,
      payoutsRemaining: 0,
      slotNumbers: [],
    });
    expect(cleanup.deleteDraw).toBe(true);
    expect(cleanup.deleteSlot).toBe(true);
    expect(cleanup.numbersReturning).toEqual([]);
    expect(cleanup.sentence).toContain("Week 6");
    expect(cleanup.sentence).toContain("UNDRAWN");
    // No number moved, so none is claimed to have moved.
    expect(cleanup.sentence).not.toContain("wheel pool");
  });

  it("names every returning number, in order, and pluralises correctly", () => {
    const cleanup = emptyDrawCleanup({
      weekNumber: 4,
      payoutsRemaining: 0,
      slotNumbers: [55, 7, 22],
    });
    expect(cleanup.numbersReturning).toEqual([7, 22, 55]);
    expect(cleanup.sentence).toContain("#7, #22, #55 return to the wheel pool");
  });
});

describe("freedWeekClause — what the organizer's audit entry gains", () => {
  it("is empty when the week keeps its draw, so no summary is padded", () => {
    const cleanup = emptyDrawCleanup({ weekNumber: 8, payoutsRemaining: 1, slotNumbers: [19] });
    expect(freedWeekClause(cleanup, 8)).toBe("");
  });

  it("states the week is undrawn again and which numbers came back", () => {
    const cleanup = emptyDrawCleanup({ weekNumber: 6, payoutsRemaining: 0, slotNumbers: [19] });
    const clause = freedWeekClause(cleanup, 6);
    expect(clause).toContain("Week 6");
    expect(clause).toContain("UNDRAWN again");
    expect(clause).toContain("#19");
  });

  it("omits the number list when no number was stranded", () => {
    const cleanup = emptyDrawCleanup({ weekNumber: 6, payoutsRemaining: 0, slotNumbers: [] });
    expect(freedWeekClause(cleanup, 6)).toContain("UNDRAWN again");
    expect(freedWeekClause(cleanup, 6)).not.toContain("(");
  });
});

// ————————————————————————————————————————————————————————————————
// GUARD — no path resurrects a winner plan without checking it has numbers.
//
// This is where the zero-number plan found on live week 11 was born. Four
// paths put a FULFILLED plan back to PLANNED so the organizer's locked intent
// survives an undo (2.3), and every one of them did it unconditionally.
//
// WinnerPlanNumber cascades when a LuckyNumber is deleted, so a plan can be
// hollowed out without the organizer touching it — remove two members who
// shared a TOGETHER plan and it sits FULFILLED with zero rows. Click Undo and
// it comes back PLANNED with nothing in it. selectWinningSlot matches with
// `plan.luckyNumberIds.every(...)`, and [].every(...) is VACUOUSLY TRUE, so it
// matches the FIRST eligible slot and decides that week's draw while the audit
// log records it as an intentional "planned" win.
//
// purgeEmptyWinnerPlans could never catch it: it matches status PLANNED, and
// an emptied plan sits at FULFILLED until the instant it is resurrected. The
// check has to be AT the resurrection.
// ————————————————————————————————————————————————————————————————

const GUARD_ROOT = join(import.meta.dirname, "..");

describe("GUARD — a plan is never resurrected empty", () => {
  const FILES = [
    "app/actions/wheel.ts",
    "app/actions/manual-payout.ts",
    "lib/draw-cascade.ts",
    "app/actions/week-winners.ts",
    "app/actions/edits.ts",
  ];

  it("nothing writes status PLANNED on a winnerPlan by hand", () => {
    const offenders: string[] = [];
    // The one legitimate writer is restoreFulfilledPlan itself.
    // No /s flag (the tsconfig target predates it) and no [\s\S] either: a
    // lazy any-character scan runs past the closing paren and matches a
    // "PLANNED" hundreds of lines later, flagging files that set CANCELLED.
    // `[^)]` already spans newlines and stops at the end of the call.
    const byHand = /winnerPlan\.update\([^)]*status:\s*"PLANNED"/;
    for (const file of FILES) {
      const source = readFileSync(join(GUARD_ROOT, file), "utf8");
      if (file === "lib/draw-cascade.ts") continue;
      if (byHand.test(source)) offenders.push(file);
    }
    expect(
      offenders,
      "These files resurrect a winner plan directly instead of through " +
        "restoreFulfilledPlan, so they cannot tell an emptied plan from a real " +
        "one. An empty plan matches the first eligible slot and decides the " +
        "next draw by itself.\n" + offenders.join("\n"),
    ).toEqual([]);
  });

  it("restoreFulfilledPlan really counts the numbers before restoring", () => {
    // Accepting it above is only safe while it actually checks. If this is
    // ever gutted, the test notices rather than a rigged draw.
    const source = readFileSync(join(GUARD_ROOT, "lib/draw-cascade.ts"), "utf8");
    expect(source).toMatch(/numbers\.length === 0/);
    expect(source).toMatch(/winnerPlan\.delete/);
    // And it must say WHY in the audit, not just delete quietly.
    expect(source).toContain("empty .every()");
  });

  it("every path that touches a plan's status goes through the shared module", () => {
    // TWO resolvers, because there are two genuinely different cases:
    //
    //   restoreFulfilledPlan   the draw is undone and the week is left OPEN,
    //                          so the intent can still fire — restore it,
    //                          unless it has been hollowed out.
    //   resolvePlanForNewDraw  a NEW draw lands on the week in the same
    //                          transaction. Draw.@@unique([weekId]) means a
    //                          plan left PLANNED there can never fire, so it
    //                          is fulfilled or cancelled against what actually
    //                          happened — never left dangling.
    //
    // Using the wrong one is what stranded a plan on a drawn week, with its
    // numbers frozen out of every reshuffle forever, while the audit entry
    // claimed "the fulfilled winner plan is PLANNED again".
    for (const file of ["app/actions/wheel.ts", "app/actions/manual-payout.ts"]) {
      const source = readFileSync(join(GUARD_ROOT, file), "utf8");
      expect(source, file).toMatch(/restoreFulfilledPlan\(|resolvePlanForNewDraw\(/);
    }
  });

  it("resolvePlanForNewDraw never leaves a plan PLANNED on a drawn week", () => {
    const source = readFileSync(join(GUARD_ROOT, "lib/draw-cascade.ts"), "utf8");
    // It writes exactly one of FULFILLED or CANCELLED, chosen by whether the
    // draw matched what the plan committed.
    expect(source).toMatch(/met \? "FULFILLED" : "CANCELLED"/);
    // And it says which, and why — 2.3: never silently.
    expect(source).toContain("could never fire");
  });
});
